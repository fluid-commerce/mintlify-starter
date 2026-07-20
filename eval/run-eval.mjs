#!/usr/bin/env node
// Agent-eval harness for CURRENT-2424 (Categories/Collections pilot on Mintlify).
//
// Success metric (from the bet): on a natural-language eval set, an agent using
// ONLY the published docs surface (hosted search MCP, or llms.txt) must select
// the correct canonical API call — target >=90% correct with ZERO legacy-endpoint
// answers. This runner exercises that surface against a deployed Mintlify site.
//
// Node >=20, zero npm dependencies (built-in fetch only).
//
// Config (env):
//   ANTHROPIC_API_KEY   (required)
//   EVAL_DOCS_BASE_URL  (required, e.g. https://<site>.mintlify.app — no trailing slash)
//   EVAL_MODE           mcp (default) | llms
//   EVAL_MODEL          default claude-sonnet-5
//   EVAL_CONCURRENCY    default 2
//
// Usage:
//   ANTHROPIC_API_KEY=... EVAL_DOCS_BASE_URL=https://site.mintlify.app node eval/run-eval.mjs
//   EVAL_MODE=llms ANTHROPIC_API_KEY=... EVAL_DOCS_BASE_URL=... node eval/run-eval.mjs

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONFIG = {
  apiKey: process.env.ANTHROPIC_API_KEY || "",
  baseUrl: (process.env.EVAL_DOCS_BASE_URL || "").replace(/\/+$/, ""),
  mode: (process.env.EVAL_MODE || "mcp").toLowerCase(),
  model: process.env.EVAL_MODEL || "claude-sonnet-5",
  concurrency: Math.max(1, Number.parseInt(process.env.EVAL_CONCURRENCY || "2", 10) || 2),
};

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// MCP connector beta: exposes the docs MCP search tools server-side; the connector
// runs the tool-use loop for us and we read the final text block.
const MCP_BETA_HEADER = "mcp-client-2025-04-04";
const MAX_TOKENS = 2048;
const LLMS_CHAR_BUDGET = 150_000;
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 2;

// Legacy-endpoint patterns. Any hit anywhere in the raw response is a legacy
// answer — a hard fail, counted separately from correctness.
const LEGACY_PATTERNS = [
  /company\/v1\//,
  /\/api\/v1\//,
  /v2025[-_]?06/i,
  /v202506/,
  /\bper_page\b/,
];

// The agent-under-test is instructed to answer ONLY from the docs surface and to
// reply with strict JSON. Shared across both modes.
const SYSTEM_PROMPT = [
  "You are a coding agent helping a developer call the Fluid Storefront API.",
  "",
  "You must answer using ONLY information you find in the provided Fluid",
  "documentation. Do not rely on prior knowledge, memory, or guesses about the",
  "API. Before answering, search the documentation for the relevant endpoint and",
  "confirm the exact method, path, query parameters, request-body fields, and",
  "authentication requirement from what you find.",
  "",
  "Reply with STRICT JSON and nothing else — no prose, no explanation, no",
  "markdown code fences. The JSON MUST have exactly these keys:",
  "",
  '  {"method": "GET|POST|PATCH|PUT|DELETE",',
  '   "path": "/api/.../{id}",',
  '   "query_params": { },',
  '   "body": { },',
  '   "auth": "none" | "bearer"}',
  "",
  "Rules for the JSON:",
  '- "path" is the templated URL path only (host omitted). Keep path parameters',
  '  as {placeholder} tokens, e.g. /api/v202604/company/categories/{id}.',
  '- "query_params" uses the EXACT query-parameter names from the docs as keys',
  '  (e.g. "filter[country]", "page[limit]"). Use {} if none are needed.',
  '- "body" contains the request body as documented. Use {} for requests with no body.',
  '- "auth" is "none" for public/unauthenticated endpoints, or "bearer" for',
  "  endpoints that require a bearer token.",
  "- Output the JSON object by itself as your entire final message.",
].join("\n");

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

// Runs fn() with retries on 429/5xx/network errors, exponential backoff + jitter.
async function withRetry(fn, label) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = err && (err.retryable === true || err.name === "AbortError");
      if (!retryable || attempt === MAX_RETRIES) break;
      const backoff = 1000 * 2 ** attempt + Math.floor(Math.random() * 500);
      process.stderr.write(
        `  [retry] ${label}: ${err.message} — waiting ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})\n`,
      );
      await sleep(backoff);
    }
  }
  throw lastErr;
}

// POSTs to the Anthropic Messages API. Throws with .retryable set appropriately.
async function anthropicRequest(body, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": CONFIG.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    // Network / abort error — retryable.
    err.retryable = true;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Anthropic API ${res.status}: ${text.slice(0, 500)}`);
    err.status = res.status;
    err.retryable = isRetryableStatus(res.status);
    throw err;
  }
  return res.json();
}

// Concatenates every top-level text block from an Anthropic response.
function extractFinalText(response) {
  if (!response || !Array.isArray(response.content)) return "";
  return response.content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

// Pulls a JSON object out of model text (tolerating code fences and surrounding prose).
function extractJson(text) {
  if (!text || typeof text !== "string") return null;

  const candidates = [];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1]);
  candidates.push(text);

  for (const candidate of candidates) {
    const obj = parseAnyObject(candidate);
    if (obj) return obj;
  }
  return null;
}

function parseAnyObject(s) {
  const trimmed = s.trim();
  try {
    const o = JSON.parse(trimmed);
    if (o && typeof o === "object" && !Array.isArray(o)) return o;
  } catch {
    // fall through to brace scan
  }

  // Scan for balanced { ... } substrings; return the first that parses and
  // looks like an answer object (carries method or path).
  for (let start = 0; start < s.length; start++) {
    if (s[start] !== "{") continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = start; j < s.length; j++) {
      const ch = s[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const sub = s.slice(start, j + 1);
          try {
            const o = JSON.parse(sub);
            if (o && typeof o === "object" && !Array.isArray(o) && ("method" in o || "path" in o)) {
              return o;
            }
          } catch {
            // keep scanning
          }
          break;
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Grading helpers (pure code — no LLM judge)
// ---------------------------------------------------------------------------

function normalizePath(p) {
  if (typeof p !== "string") return null;
  let s = p.trim();
  s = s.replace(/^https?:\/\/[^/]+/i, ""); // strip host
  s = s.split("?")[0].split("#")[0]; // strip query/fragment
  s = s.replace(/\/+$/, ""); // strip trailing slash
  if (!s.startsWith("/")) s = `/${s}`;
  return s;
}

function isParamSegment(seg) {
  return /^\{.*\}$/.test(seg) || /^:/.test(seg);
}

// Path template match: static segments must match exactly; a {placeholder}
// segment in the expected path accepts any non-empty segment in the answer
// (a concrete value like "summer-sale"/"4821", or the placeholder echoed back).
function pathMatches(expected, got) {
  const e = normalizePath(expected);
  const g = normalizePath(got);
  if (!e || !g) return false;
  const es = e.split("/");
  const gs = g.split("/");
  if (es.length !== gs.length) return false;
  for (let i = 0; i < es.length; i++) {
    if (isParamSegment(es[i])) {
      if (gs[i].length === 0) return false;
      continue;
    }
    if (es[i] !== gs[i]) return false;
  }
  return true;
}

// Recursively collects candidate names from a params/body object: every key at
// every level (bare), plus the bracket-reconstructed path for nested objects.
// So {filter:{country:"GB"}} yields {"filter","country","filter[country]"} and
// {"filter[country]":"GB"} yields {"filter[country]"} — either matches a required
// "filter[country]".
function flattenNames(obj, prefix = "") {
  const names = new Set();
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return names;
  for (const [k, v] of Object.entries(obj)) {
    names.add(k);
    const bracket = prefix ? `${prefix}[${k}]` : k;
    names.add(bracket);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const n of flattenNames(v, bracket)) names.add(n);
    }
  }
  return names;
}

function normalizeAuth(a) {
  if (typeof a !== "string") return "";
  const s = a.trim().toLowerCase();
  if (s.includes("bearer") || s.includes("token")) return "bearer";
  if (s === "" || s.includes("none") || s.includes("no auth") || s.includes("unauth") || s.includes("public")) {
    return "none";
  }
  return s;
}

function scanLegacy(rawText) {
  const hits = [];
  for (const pattern of LEGACY_PATTERNS) {
    const m = rawText.match(pattern);
    if (m) hits.push(m[0]);
  }
  return hits;
}

function gradeOne(expected, got) {
  const reasons = [];
  if (!got) return { pass: false, reasons: ["no parseable JSON in response"] };

  const methodOk =
    typeof got.method === "string" &&
    got.method.toUpperCase() === expected.method.toUpperCase();
  if (!methodOk) reasons.push(`method: got ${JSON.stringify(got.method)}, want ${expected.method}`);

  const pathOk = pathMatches(expected.path, got.path);
  if (!pathOk) reasons.push(`path: got ${JSON.stringify(got.path)}, want ${expected.path}`);

  const authOk = normalizeAuth(got.auth) === expected.auth;
  if (!authOk) reasons.push(`auth: got ${JSON.stringify(got.auth)}, want ${expected.auth}`);

  const qpNames = flattenNames(got.query_params || {});
  const missingQp = (expected.required_query_params || []).filter((n) => !qpNames.has(n));
  if (missingQp.length) reasons.push(`missing query params: ${missingQp.join(", ")}`);

  const bodyNames = flattenNames(got.body || {});
  const missingBody = (expected.required_body_fields || []).filter((n) => !bodyNames.has(n));
  if (missingBody.length) reasons.push(`missing body fields: ${missingBody.join(", ")}`);

  const pass =
    methodOk && pathOk && authOk && missingQp.length === 0 && missingBody.length === 0;
  return { pass, reasons };
}

// ---------------------------------------------------------------------------
// Mode implementations
// ---------------------------------------------------------------------------

async function callMcpMode(prompt) {
  const body = {
    model: CONFIG.model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
    mcp_servers: [
      { type: "url", url: `${CONFIG.baseUrl}/mcp`, name: "fluid-docs" },
    ],
  };
  const response = await withRetry(
    () => anthropicRequest(body, { "anthropic-beta": MCP_BETA_HEADER }),
    "messages(mcp)",
  );
  return { response, rawText: JSON.stringify(response), finalText: extractFinalText(response) };
}

async function callLlmsMode(prompt, docs) {
  const userMessage = [
    "Fluid documentation (your ONLY source — search it to answer):",
    "<docs>",
    docs,
    "</docs>",
    "",
    "Developer question:",
    prompt,
    "",
    "Answer with strict JSON only, per the system instructions.",
  ].join("\n");

  const body = {
    model: CONFIG.model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  };
  const response = await withRetry(() => anthropicRequest(body), "messages(llms)");
  return { response, rawText: JSON.stringify(response), finalText: extractFinalText(response) };
}

// Fetches llms-full.txt (fallback llms.txt) and truncates to the char budget.
async function loadLlmsDocs() {
  const urls = [`${CONFIG.baseUrl}/llms-full.txt`, `${CONFIG.baseUrl}/llms.txt`];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        process.stderr.write(`  [llms] ${url} -> ${res.status}, trying next\n`);
        continue;
      }
      let text = await res.text();
      if (text.length > LLMS_CHAR_BUDGET) {
        text = `${text.slice(0, LLMS_CHAR_BUDGET)}\n\n[...truncated at ${LLMS_CHAR_BUDGET} chars...]`;
      }
      process.stderr.write(`  [llms] loaded ${url} (${text.length} chars)\n`);
      return text;
    } catch (err) {
      process.stderr.write(`  [llms] ${url} failed: ${err.message}, trying next\n`);
    }
  }
  throw new Error(`could not fetch ${urls.join(" or ")}`);
}

// ---------------------------------------------------------------------------
// Concurrency pool
// ---------------------------------------------------------------------------

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function fail(message) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}

async function main() {
  if (!CONFIG.apiKey) fail("ANTHROPIC_API_KEY is required.");
  if (!CONFIG.baseUrl) fail("EVAL_DOCS_BASE_URL is required (e.g. https://<site>.mintlify.app).");
  if (CONFIG.mode !== "mcp" && CONFIG.mode !== "llms") {
    fail(`EVAL_MODE must be "mcp" or "llms" (got "${CONFIG.mode}").`);
  }

  const promptsPath = join(HERE, "prompts.json");
  let prompts;
  try {
    const parsed = JSON.parse(await readFile(promptsPath, "utf8"));
    prompts = parsed.prompts;
  } catch (err) {
    fail(`could not read/parse ${promptsPath}: ${err.message}`);
  }
  if (!Array.isArray(prompts) || prompts.length === 0) {
    fail("prompts.json has no prompts array.");
  }

  process.stderr.write(
    `Running ${prompts.length} prompts | mode=${CONFIG.mode} | model=${CONFIG.model} | ` +
      `base=${CONFIG.baseUrl} | concurrency=${CONFIG.concurrency}\n\n`,
  );

  const docs = CONFIG.mode === "llms" ? await loadLlmsDocs() : null;

  const perPrompt = await runPool(prompts, CONFIG.concurrency, async (p) => {
    try {
      const { response, rawText, finalText } =
        CONFIG.mode === "mcp" ? await callMcpMode(p.prompt) : await callLlmsMode(p.prompt, docs);

      const got = extractJson(finalText);
      const grade = gradeOne(p.expected, got);
      const legacyHits = scanLegacy(rawText);

      return {
        id: p.id,
        status: grade.pass ? "PASS" : "FAIL",
        legacy: legacyHits.length > 0,
        legacyHits,
        expected: p.expected,
        got,
        reasons: grade.reasons,
        finalText,
        stopReason: response.stop_reason,
      };
    } catch (err) {
      return {
        id: p.id,
        status: "ERROR",
        legacy: false,
        legacyHits: [],
        expected: p.expected,
        got: null,
        reasons: [err.message],
        finalText: "",
        error: err.message,
      };
    }
  });

  // Per-prompt output.
  for (const r of perPrompt) {
    const tag = r.legacy ? `${r.status} +LEGACY` : r.status;
    process.stdout.write(`[${tag}] ${r.id}\n`);
    if (r.status === "ERROR") {
      process.stdout.write(`    error: ${r.reasons.join("; ")}\n`);
    } else {
      const gotStr = r.got
        ? `${r.got.method} ${r.got.path} (auth=${r.got.auth})`
        : "<no JSON>";
      const wantStr = `${r.expected.method} ${r.expected.path} (auth=${r.expected.auth})`;
      process.stdout.write(`    want: ${wantStr}\n`);
      process.stdout.write(`    got:  ${gotStr}\n`);
      if (r.reasons.length) process.stdout.write(`    why:  ${r.reasons.join("; ")}\n`);
      if (r.legacy) process.stdout.write(`    LEGACY hits: ${r.legacyHits.join(", ")}\n`);
    }
  }

  // Summary.
  const total = perPrompt.length;
  const errored = perPrompt.filter((r) => r.status === "ERROR").length;
  const passed = perPrompt.filter((r) => r.status === "PASS").length;
  const legacyCount = perPrompt.filter((r) => r.legacy).length;
  const graded = total - errored;
  const passRate = graded > 0 ? passed / graded : 0;

  const passRateOk = passRate >= 0.9;
  const legacyOk = legacyCount === 0;
  const noErrors = errored === 0;

  process.stdout.write("\n=== SUMMARY ===\n");
  process.stdout.write(`mode:            ${CONFIG.mode}\n`);
  process.stdout.write(`model:           ${CONFIG.model}\n`);
  process.stdout.write(`total prompts:   ${total}\n`);
  process.stdout.write(`passed:          ${passed}\n`);
  process.stdout.write(`failed:          ${total - passed - errored}\n`);
  process.stdout.write(`errored:         ${errored}\n`);
  process.stdout.write(
    `pass rate:       ${(passRate * 100).toFixed(1)}% (${passed}/${graded} graded)\n`,
  );
  process.stdout.write(`legacy answers:  ${legacyCount}\n`);
  process.stdout.write("\n--- Acceptance criteria ---\n");
  process.stdout.write(`pass rate >= 90%:   ${passRateOk ? "yes" : "no"}\n`);
  process.stdout.write(`legacy answers == 0: ${legacyOk ? "yes" : "no"}\n`);
  if (!noErrors) {
    process.stdout.write(`(note: ${errored} prompt(s) ERRORED — verdict is not conclusive)\n`);
  }

  // Persist full details.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resultsDir = join(HERE, "results");
  await mkdir(resultsDir, { recursive: true });
  const outPath = join(resultsDir, `${stamp}-${CONFIG.mode}.json`);
  const report = {
    timestamp: new Date().toISOString(),
    config: {
      mode: CONFIG.mode,
      model: CONFIG.model,
      baseUrl: CONFIG.baseUrl,
      concurrency: CONFIG.concurrency,
    },
    summary: {
      total,
      passed,
      failed: total - passed - errored,
      errored,
      passRate,
      legacyCount,
      passRateOk,
      legacyOk,
      noErrors,
    },
    prompts: perPrompt,
  };
  await writeFile(outPath, JSON.stringify(report, null, 2));
  process.stdout.write(`\nWrote ${outPath}\n`);

  // Exit 0 only if both criteria met AND no prompt errored.
  const success = passRateOk && legacyOk && noErrors;
  process.exit(success ? 0 : 1);
}

// Only run the harness when executed directly (`node eval/run-eval.mjs`), not when
// imported — e.g. by eval/run-eval.test.mjs, which exercises the pure functions below.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`FATAL: ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

// Pure grading/parsing helpers — exported for unit testing (see run-eval.test.mjs).
export {
  isRetryableStatus,
  extractFinalText,
  extractJson,
  parseAnyObject,
  normalizePath,
  isParamSegment,
  pathMatches,
  flattenNames,
  normalizeAuth,
  scanLegacy,
  gradeOne,
};
