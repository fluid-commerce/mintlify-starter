#!/usr/bin/env node
// Deterministic checker for the Fluid docs agent surface on Mintlify.
//
// Asks the hosted docs the eval set's own questions through the unauthenticated
// `/mcp` search endpoint, then checks each answer in two separable stages:
//
//   Stage 1 — retrieval:  did search surface the page that documents the answer?
//   Stage 2 — contract:   does that page's full markdown carry the right contract?
//
// The split matters. `search_fluid` returns a truncated slice of each page, so
// asserting the full contract against the slice tests snippet luck rather than
// discoverability — and a failure could not be read as either a ranking problem or
// a docs problem. Stage 2 therefore fetches `<base>/<page>.md`, which inlines the
// operation's OpenAPI fragment and so carries the method, path, security
// requirement, parameter names, and schema properties as text.
//
// The stages are gated differently, because they are not equally stable: stage 2
// must be 100% (it is deterministic, so any failure is real), while stage 1 is gated
// as a rate — >= 90%, the project's own documented metric — because it measures a
// live search engine's ranking. Every stage-1 miss is named either way.
//
// Also checked per run: no legacy-endpoint leakage anywhere it looks, and a healthy
// `llms.txt` / `llms-full.txt` pair.
//
// No model, no credentials, no API key — ever. If a change here would need one,
// the change belongs somewhere else.
//
// What this proves: the answer is published, correct, and discoverable.
// What this does NOT prove: that an agent reading it answers correctly.
// See README.md ("What this harness does not prove").
//
// Node >=20, zero npm dependencies (built-in fetch only).
//
// Config:
//   --base <url> | EVAL_DOCS_BASE_URL   deploy base URL (required)
//   --only <substring>                  run only prompts whose id contains this
//   --repeat <n>                        query each prompt n times and report ranking
//                                       variance; DIAGNOSTIC ONLY, never gated
//   EVAL_CONCURRENCY                    parallel searches, default 4
//   EVAL_LLMS_MIN_CHARS                 llms-full.txt size floor, default 100000
//
// Usage:
//   node eval/check-hosted-docs.mjs --base https://docs.fluid.app
//   node eval/check-hosted-docs.mjs --base https://docs.fluid.app --only bundle
//   node eval/check-hosted-docs.mjs --base https://docs.fluid.app --only bundle --repeat 5

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Parses `--base <url>` / `--only <substring>` out of argv, falling back to env
// for the base URL. Trailing slashes are stripped so `${base}/mcp` is always right.
function parseArgs(argv, env = {}) {
  const args = { base: (env.EVAL_DOCS_BASE_URL || "").replace(/\/+$/, ""), only: "", repeat: 1 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base" && argv[i + 1]) args.base = argv[++i].replace(/\/+$/, "");
    else if (argv[i] === "--only" && argv[i + 1]) args.only = argv[++i];
    else if (argv[i] === "--repeat" && argv[i + 1]) {
      args.repeat = Math.max(1, Number.parseInt(argv[++i], 10) || 1);
    }
  }
  return args;
}

const CLI = parseArgs(process.argv.slice(2), process.env);

const CONFIG = {
  baseUrl: CLI.base,
  only: CLI.only,
  repeat: CLI.repeat,
  concurrency: Math.max(1, Number.parseInt(process.env.EVAL_CONCURRENCY || "4", 10) || 4),
  // The leakage scan is only as good as the document it reads. A short
  // llms-full.txt means the agent surface regressed, so it fails rather than
  // quietly scanning less than the whole corpus.
  llmsMinChars: Math.max(0, Number.parseInt(process.env.EVAL_LLMS_MIN_CHARS || "100000", 10) || 0),
};

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 2;
const SEARCH_TOOL = "search_fluid";

// The two stages are gated differently because they are not equally stable.
//
// Stage 2 reads a fetched page with fixed assertions, so it is deterministic: any
// failure is a real docs gap or a wrong expectation. It must be perfect.
//
// Stage 1 measures a live search engine's ranking, which varies run to run. Gating
// it per prompt would make the build a coin flip on borderline queries, so it is
// gated as a rate — the project's own documented metric, ≥ 90% with zero legacy
// answers. Individual misses are always named, so a real regression is still
// visible rather than absorbed by the tolerance.
const RETRIEVAL_RATE_FLOOR = 0.9;

// Legacy-endpoint patterns. A hit anywhere in retrieved content or in
// llms-full.txt is a failure unless it lands in a sanctioned section (below).
const LEGACY_PATTERNS = [
  /company\/v1\//,
  /\/api\/v1\//,
  /v2025[-_]?06/i,
  /v202506/,
  /\bper_page\b/,
];

// AGENTS.md carves out two places where a legacy marker is correct, and both show
// up in the published agent surface. Sanctioning them by section keeps the scan
// strict everywhere else instead of retiring the check.
const BANNER_LABEL = "(agent-instructions banner)";
const OFFSET_PAGINATED_SECTIONS =
  /^(?:api-reference\/)?(?:webhooks|callback-registrations|company-events|webhook-schemas)\b/;

// The seven `checkout-v2026-04` list operations that are genuinely offset-paginated
// in the implementation, verified against the Rails actions rather than the spec.
// Listed page by page rather than by tag, because `directory`, `store`, and
// `subscriptions` also contain operations that paginate by cursor or not at all — a
// tag-wide carve-out would forgive a real leak on a neighbouring page.
//
// `customer-orders/list-customer-orders` is here for a different reason and is NOT an
// offset endpoint: it takes `page[cursor]`/`page[limit]`, but its response meta also
// emits `per_page`, `current_page`, and `total_pages` alongside the cursors, so the
// generated page carries the marker. Its `current_page` is hardcoded to 1 upstream.
const OFFSET_PAGINATED_PAGES = new Set([
  "customer-addresses/list-customer-addresses",
  "customer-payment-methods/list-customer-payment-methods",
  "customer-points/list-customer-points-ledger",
  "directory/list-reps",
  "directory/list-users",
  "store/list-drop-zones",
  "subscriptions/list-subscriptions",
  "customer-orders/list-customer-orders",
]);

// The 69 generated reference pages of `public-v2025-06` — the Public SDK surface the
// `@fluid-app` SDK actually calls, adopted in Phase 9.6f. Its paths are genuinely
// `/api/public/v2025-06/...` and `/api/v202506/carts/...`, so every one of these pages
// carries a version marker the legacy scan otherwise treats as a leak.
//
// Enumerated page by page, never by tag or by a `v2025-06` pattern class, for two
// reasons. A blanket version sanction would re-legitimise the legacy admin/partner
// surface (`admin-v2025-06`, `/api/v2025-06/*`) that earlier phases removed — a
// different API that must keep failing. And three of these tags are SHARED with the
// v2026-04 surfaces: `carts` also holds 12 `checkout-v2026-04` pages, `orders` one, and
// `paypal` four, where a version marker would be a real leak. Prefix-sanctioning
// `carts/` would forgive all 17.
//
// This list is the `mint export` path inventory, not a hand-derived guess:
//   npx mint@latest export --output /tmp/e.zip && unzip -Z1 /tmp/e.zip \
//     | grep 'index.html$' | sed 's|^api-reference/||; s|/index.html$||'
// filtered to the pages the `public-v2025-06` nav group adds. A page path is
// `<tag>/<summary>` case-folded with spaces hyphenated, so an upstream summary edit
// renames its page and drops it out of this set. That fails loudly — the run reports an
// unsanctioned hit naming the new page — which is the right direction: regenerate the
// list from the export rather than loosening the key.
const PUBLIC_SDK_V2025_06_PAGES = new Set([
  "affiliate/retrieve-affiliate-information",
  "carts/add-enrollment-to-existing-cart",
  "carts/adds-items-to-cart",
  "carts/applies-a-discount-to-the-cart",
  "carts/check-order-status-check-order-status",
  "carts/client-token-client-token",
  "carts/completes-cart-checkout",
  "carts/confirm-magic-link-for-cart",
  "carts/create-dlocal",
  "carts/create-magic-link-for-cart",
  "carts/create-payment-create-payment",
  "carts/create-ppro",
  "carts/creates-a-cart",
  "carts/ipn-ipn",
  "carts/removes-item-from-cart",
  "carts/removes-rep_buyer-and-customer-for-the-cart",
  "carts/retrieves-a-cart",
  "carts/retrieves-cart-company-information",
  "carts/retrieves-enroll-for-cart",
  "carts/sets-cart-payment-method",
  "carts/sets-cart-shipping-method",
  "carts/shipping-address-change-shipping-address-change",
  "carts/shipping-method-change-shipping-method-change",
  "carts/subscribes-a-cart-item",
  "carts/syncs-cart-with-authenticated-customer",
  "carts/updates-a-cart",
  "carts/updates-a-cart-items-variant",
  "carts/updates-cart-address",
  "carts/updates-subscribe:false-to-cart-item",
  "carts/updates-the-country-of-a-cart-also-updates-the-currency-code",
  "carts/updates-the-language-of-a-cart",
  "checkout/record-a-checkout-starting",
  "commerce/update-cart-items-prices",
  "enrollment-packs/get-enrollment-pack-by-slug",
  "events/save-a-new-lead-capture",
  "events/save-a-new-page-visit",
  "events/save-a-new-url-visit",
  "fingerprint/start-a-new-fingerprint",
  "forms/get-form-by-public-token",
  "forms/submit-a-form-response",
  "forms/verify-form-password",
  "media/create-video-analytics-event",
  "media/get-media-by-slug",
  "media/get-media-by-slug-deprecated",
  "orders/retrieves-an-order-with-points-redemption",
  "payment/creates-a-klarna-payment-session",
  "payment/updates-a-klarna-session",
  "paypal/authorize-order-in-paypal",
  "paypal/create-order-in-paypal",
  "playlist/get-playlist-by-slug",
  "playlist/get-playlist-by-slug-deprecated",
  "product/get-product-by-slug-in-a-foreign-local-includes-the-correct-variants",
  "public-drop-zones/an-array-of-available-checkout-and-order-confirmation-drop-zones-public",
  "public/auth-auth",
  "public/countries-countries",
  "public/db-port-db-port",
  "public/get-apple-pay-domain",
  "public/health-health",
  "public/homepage-render-homepage-render",
  "public/realtime-realtime",
  "public/update-volumes-update-volumes",
  "root-themes/get-root-theme-by-id",
  "root-themes/list-root-themes",
  "session/start-a-new-session",
  "settings/retrieve-page-settings",
  "widgets/retrieve-banner-widget",
  "widgets/retrieve-cart-widget",
  "widgets/retrieve-chat-widget",
  "widgets/retrieve-popup-widget",
]);

// AGENTS.md also permits the Public SDK surface's version label on these exact
// hand-written pages. Keep this list narrow: the exception applies to prose that
// differentiates the SDK contract, not to every SDK or API page.
const PUBLIC_SDK_V2025_06_PROSE_PAGES = new Set([
  "api/choosing-a-cart-surface",
  "sdk/cart-api",
]);

// Matches only a bare version token — what `scanLegacy` captures for the two
// version patterns. Deliberately anchored so the Public SDK sanction can never
// forgive `per_page`, `company/v1/`, or `/api/v1/` on the same page.
const V2025_06_MARKER = /^v2025[-_]?06$/i;

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

// Appends a cache-busting query parameter, preserving any existing query string.
function cacheBustedUrl(url, nonce) {
  return `${url}${url.includes("?") ? "&" : "?"}cb=${nonce}`;
}

// Hosted llms files are served with a 24-hour cache directive, so an edge can
// return a copy generated before the most recent deploy. Checking that copy
// reports failures against content that is already published, so bypass the
// cache and log which revision was actually checked.
const NO_CACHE_HEADERS = { "cache-control": "no-cache", pragma: "no-cache" };

// ---------------------------------------------------------------------------
// MCP transport
// ---------------------------------------------------------------------------

// The `/mcp` endpoint answers a plain unauthenticated JSON-RPC POST with an SSE
// body: `data: ` lines each carrying one JSON message. Concatenate every text
// entry in `result.content[]`.
function parseSseText(raw) {
  if (typeof raw !== "string") return "";
  const parts = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data: ")) continue;
    let message;
    try {
      message = JSON.parse(line.slice(6));
    } catch {
      continue; // a keep-alive or partial frame, not a JSON-RPC message
    }
    const content = message?.result?.content;
    if (!Array.isArray(content)) continue;
    for (const entry of content) {
      if (entry && entry.type === "text" && typeof entry.text === "string") parts.push(entry.text);
    }
  }
  return parts.join("\n");
}

// Retrieved content arrives as repeated `Title:/Link:/Page:/Content:` blocks.
// Splitting them lets a legacy hit be attributed to the page that carries it.
function splitChunks(text) {
  if (typeof text !== "string" || text.trim() === "") return [];
  const starts = [...text.matchAll(/^Title: /gm)].map((m) => m.index);
  if (starts.length === 0) return [{ label: "(unlabeled)", text }];
  return starts.map((start, i) => {
    const body = text.slice(start, i + 1 < starts.length ? starts[i + 1] : text.length);
    const page = body.match(/^Page: (.*)$/m);
    return { label: page ? page[1].trim() : "(unlabeled)", text: body };
  });
}

async function searchDocs(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${CONFIG.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: SEARCH_TOOL, arguments: { query } },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    err.retryable = true;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`/mcp ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    err.retryable = isRetryableStatus(res.status);
    throw err;
  }

  const content = parseSseText(await res.text());
  if (content.trim() === "") {
    const err = new Error("/mcp returned no text content");
    err.retryable = true;
    throw err;
  }
  return content;
}

// ---------------------------------------------------------------------------
// Retrieval checks (pure)
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

// Path template match between two paths: static segments must match exactly; a
// {placeholder} segment in the expected path accepts any non-empty segment.
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

// Same rule as pathMatches, compiled to search free text: each {placeholder}
// segment becomes a one-segment wildcard, so the expected path is found whether
// the docs print `/categories/{slug}` or `/categories/wellness-essentials`.
//
// The trailing lookahead stops a shorter path from being satisfied by a longer one
// (`/api/v202604/categories` must not pass on the strength of
// `/api/v202604/categories/{slug}`) while still allowing a following `?query`,
// backtick, or newline. Wildcards use the `(?=(x+))\1` atomic idiom — lookaheads
// are atomic in JavaScript, so the wildcard cannot backtrack into the middle of a
// segment and defeat that lookahead.
function pathTemplateRegex(expectedPath) {
  const normalized = normalizePath(expectedPath);
  if (!normalized) return null;
  let group = 0;
  const source = normalized
    .split("/")
    .map((seg) =>
      isParamSegment(seg)
        ? `(?=([^/\\s]+))\\${++group}`
        : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(`${source}(?!/[^/\\s])`);
}

function contentHasPath(content, expectedPath) {
  const re = pathTemplateRegex(expectedPath);
  return Boolean(re && typeof content === "string" && re.test(content));
}

// Accepts the two ways the published surface names a method: the uppercase form
// used in prose and examples (`GET /api/...`), and the lowercase form on the
// generated reference's contract line (`storefront-v2026-04.yaml get /api/...`).
// Deliberately NOT a case-insensitive bare word — `\bget\b` would match English
// prose and pass every prompt.
function contentHasMethod(content, method) {
  if (typeof content !== "string" || typeof method !== "string" || method === "") return false;
  const upper = method.toUpperCase();
  if (new RegExp(`\\b${upper}\\b`).test(content)) return true;
  return new RegExp(`\\b${upper.toLowerCase()}\\s+/`).test(content);
}

// ---------------------------------------------------------------------------
// Stage 1 — retrieval (the discoverability claim)
// ---------------------------------------------------------------------------

// Every generated reference page carries its operation on one contract line:
//   /api-reference/payment-v2026-04.yaml post /api/payment/v2026-04/gateways
// Matching lowercase-method + path against that line names the page that owns an
// operation, which is what makes the two stages separable. The method matters:
// `get` and `post` on the same path are different pages.
function operationLineRegex(method, path) {
  const pathSource = pathTemplateRegex(path)?.source;
  if (!pathSource || typeof method !== "string" || method === "") return null;
  return new RegExp(`\\b${method.toLowerCase()}\\s+${pathSource}`);
}

// The page(s) that document what a prompt asks for. API prompts resolve against
// llms-full.txt by operation, so no hand-maintained mapping is needed. Workflow
// prompts declare `target_page` because a workflow is not one operation — nothing
// in the corpus identifies its owning page mechanically.
function resolveTargetPages(sections, expected) {
  if (expected?.type === "workflow") {
    const declared = expected.target_page;
    return Array.isArray(declared) ? declared : declared ? [declared] : [];
  }
  const re = operationLineRegex(expected.method, expected.path);
  if (!re) return [];
  return (sections || []).filter((s) => re.test(s.text)).map((s) => s.label);
}

// The stage-1 verdict for a whole run: a rate against the floor, not a per-prompt
// gate. Returns the rate so the report can print it next to the floor.
function retrievalRateVerdict(passCount, total, floor = RETRIEVAL_RATE_FLOOR) {
  if (total <= 0) return { rate: 0, ok: false };
  const rate = passCount / total;
  return { rate, ok: rate >= floor };
}

// The whole-run gate, in one place so it is testable and so no single check can
// quietly stop counting. All four must hold; stage 1 contributes only its rate
// verdict, every other input is zero-tolerance.
function runVerdict({ contractFailures, retrievalOk, surfaceFailures, unsanctionedLegacy }) {
  return (
    contractFailures === 0 && retrievalOk === true && surfaceFailures === 0 && unsanctionedLegacy === 0
  );
}

// Retrieval succeeded when search surfaced a page that documents the answer. What
// the returned snippet happened to include is stage 2's business, not this check's:
// `search_fluid` returns a truncated slice per page, so asserting on the slice
// tests snippet luck rather than discoverability.
function checkRetrievalStage(targetPages, retrievedLabels) {
  if (targetPages.length === 0) {
    return {
      pass: false,
      reasons: ["no page in llms-full.txt documents this operation — docs gap"],
      hit: null,
    };
  }
  const hit = targetPages.find((label) => (retrievedLabels || []).includes(label));
  if (hit) return { pass: true, reasons: [], hit };
  return {
    pass: false,
    reasons: [
      `retrieval did not return ${targetPages.slice(0, 3).join(" or ")} ` +
        `(returned: ${(retrievedLabels || []).slice(0, 5).join(", ") || "nothing"})`,
    ],
    hit: null,
  };
}

// ---------------------------------------------------------------------------
// Stage 2 — contract (the correctness claim), against a page's full markdown
// ---------------------------------------------------------------------------

// A generated page inlines the operation's OpenAPI fragment, so parameters render
// as `- name: page[limit]` and schema properties as `country_isos:`. Matching those
// shapes rather than the bare word keeps the check from passing on prose that merely
// mentions the word.
function hasQueryParamName(pageText, name) {
  return typeof pageText === "string" && pageText.includes(`name: ${name}`);
}

function hasBodyField(pageText, field) {
  if (typeof pageText !== "string" || typeof field !== "string" || field === "") return false;
  return new RegExp(`\\b${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`).test(pageText);
}

// Auth comes from the inlined spec's security requirement, not from prose. Every
// page opens with an agent-instructions banner that says "Authorization: Bearer
// <token>", so any prose-based check would report bearer for all 57 prompts. A
// requirement renders as `- bearer_auth: []`; the `securitySchemes` definition
// renders as `bearer_auth:` with no dash, so the dash is what distinguishes them.
function authFromPage(pageText) {
  return typeof pageText === "string" && /-\s+bearer_auth\b/.test(pageText) ? "bearer" : "none";
}

function checkApiContract(expected, pageText) {
  const reasons = [];
  if (!contentHasMethod(pageText, expected.method)) {
    reasons.push(`method ${expected.method} not on the page`);
  }
  if (!contentHasPath(pageText, expected.path)) {
    reasons.push(`path ${expected.path} not on the page`);
  }
  if (expected.auth) {
    const got = authFromPage(pageText);
    if (got !== expected.auth) {
      reasons.push(`auth: page declares ${got}, prompt expects ${expected.auth}`);
    }
  }
  const missingQp = (expected.required_query_params || []).filter((n) => !hasQueryParamName(pageText, n));
  if (missingQp.length) reasons.push(`query params not on the page: ${missingQp.join(", ")}`);

  const missingBody = (expected.required_body_fields || []).filter((n) => !hasBodyField(pageText, n));
  if (missingBody.length) reasons.push(`body fields not on the page: ${missingBody.join(", ")}`);

  return { pass: reasons.length === 0, reasons };
}

// Case-insensitive literal substring checks, scoped to the declared target page(s).
// Page scoping is what makes forbidden terms meaningful again: a name being absent
// from the page that owns the workflow is a real assertion, where its absence from
// a ten-page retrieval dump never was.
function checkWorkflowContract(expected, pageText) {
  const haystack = (typeof pageText === "string" ? pageText : "").toLowerCase();
  const reasons = [];

  const missing = (expected.required_terms || []).filter(
    (term) => !haystack.includes(String(term).toLowerCase()),
  );
  if (missing.length) reasons.push(`required terms not on the target page(s): ${missing.join(", ")}`);

  const present = (expected.forbidden_terms || []).filter((term) =>
    haystack.includes(String(term).toLowerCase()),
  );
  if (present.length) reasons.push(`forbidden terms on the target page(s): ${present.join(", ")}`);

  return { pass: missing.length === 0 && present.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Legacy leakage (pure)
// ---------------------------------------------------------------------------

function scanLegacy(rawText) {
  const hits = [];
  for (const pattern of LEGACY_PATTERNS) {
    const m = rawText.match(pattern);
    if (m) hits.push(m[0]);
  }
  return hits;
}

// llms-full.txt is an agent-instructions banner followed by one `# Title` /
// `Source: <url>` section per page. `# ` at line start is the section delimiter —
// page bodies use `##` and deeper, so it does not collide. Each section carries
// the label needed to sanction a hit.
function splitLlmsSections(text) {
  if (typeof text !== "string" || text === "") return [];
  const starts = [...text.matchAll(/^# /gm)].map((m) => m.index);
  const bannerEnd = starts.length ? starts[0] : text.length;
  const sections = [{ label: BANNER_LABEL, text: text.slice(0, bannerEnd) }];
  for (let i = 0; i < starts.length; i++) {
    const body = text.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : text.length);
    const source = body.match(/^Source: (.*)$/m);
    const label = source ? source[1].trim().replace(/^https?:\/\/[^/]+\//, "") : "(unlabeled)";
    sections.push({ label, text: body });
  }
  return sections;
}

// The AGENTS.md exceptions, and only those:
//   1. The agent-instructions banner names legacy markers in order to forbid them.
//   2. `webhooks-v0` list endpoints genuinely use offset `page`/`per_page`, and the
//      generated reference reflects the spec. Prose pages get no such licence.
//   3. The named `checkout-v2026-04` pages whose offset pagination is real — see
//      OFFSET_PAGINATED_PAGES. Exact pages only, never a whole tag.
//   4. The named `public-v2025-06` reference pages, whose paths genuinely carry the
//      version, plus the exact prose pages that explain this surface — see the two
//      PUBLIC_SDK_V2025_06 sets. The version marker only: `per_page` and the v1
//      markers still fail on those same pages.
function isSanctionedLegacyHit(marker, label, sectionText = "") {
  if (label === BANNER_LABEL) return true;
  const page = label.replace(/^api-reference\//, "");
  if (/\bper_page\b/.test(marker)) {
    if (OFFSET_PAGINATED_SECTIONS.test(label)) return true;
    if (OFFSET_PAGINATED_PAGES.has(page)) return true;
    if (sectionText.includes("webhooks-v0.yaml")) return true;
  }
  if (
    V2025_06_MARKER.test(marker) &&
    (PUBLIC_SDK_V2025_06_PAGES.has(page) || PUBLIC_SDK_V2025_06_PROSE_PAGES.has(page))
  ) {
    return true;
  }
  return false;
}

// Finds every legacy marker in `text`, attributing each to the section that holds
// it and splitting sanctioned from unsanctioned.
function scanLegacyAttributed(sections) {
  const sanctioned = [];
  const unsanctioned = [];
  for (const section of sections) {
    for (const marker of scanLegacy(section.text)) {
      const hit = { marker, label: section.label };
      if (isSanctionedLegacyHit(marker, section.label, section.text)) sanctioned.push(hit);
      else unsanctioned.push(hit);
    }
  }
  return { sanctioned, unsanctioned };
}

// Every hosted `.md` page opens with the same block-quoted documentation-index and
// agent-instructions banner. It says "Never use ... page/per_page params" and lists
// every spec filename, so leaving it in makes the legacy scan report a hit on all 57
// pages AND makes the webhooks-v0 sanction match all 57 — a check that fires
// everywhere and forgives everywhere. Strip it and scan the page's own content.
function stripAgentBanner(pageText) {
  if (typeof pageText !== "string") return "";
  const lines = pageText.split("\n");
  let i = 0;
  while (i < lines.length && (lines[i].trim() === "" || lines[i].startsWith(">"))) i++;
  return lines.slice(i).join("\n");
}

// llms.txt is a markdown link list; the entry count is the cheapest signal that
// the index is populated rather than a stub.
function countLlmsEntries(text) {
  if (typeof text !== "string") return 0;
  return (text.match(/^\s*-\s*\[[^\]]+\]\([^)]+\)/gm) || []).length;
}

// ---------------------------------------------------------------------------
// Agent-surface fetches
// ---------------------------------------------------------------------------

// One fetch per distinct page, shared across prompts. The promise is cached rather
// than the result so concurrent prompts wanting the same page do not each fetch it.
const pageCache = new Map();

function fetchTargetPage(label) {
  if (!pageCache.has(label)) {
    pageCache.set(
      label,
      (async () => {
        const file = await fetchAgentFile(`${label}.md`);
        return { label, status: file.status, text: file.text, lastModified: file.lastModified };
      })(),
    );
  }
  return pageCache.get(label);
}

async function fetchAgentFile(name) {
  const url = `${CONFIG.baseUrl}/${name}`;
  const res = await withRetry(async () => {
    let r;
    try {
      r = await fetch(cacheBustedUrl(url, Date.now()), { headers: NO_CACHE_HEADERS });
    } catch (err) {
      err.retryable = true;
      throw err;
    }
    if (!r.ok && isRetryableStatus(r.status)) {
      const err = new Error(`${name} ${r.status}`);
      err.retryable = true;
      throw err;
    }
    return r;
  }, name);
  return {
    url,
    status: res.status,
    lastModified: res.headers.get("last-modified") || "unknown",
    text: res.ok ? await res.text() : "",
  };
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
  if (!CONFIG.baseUrl) {
    fail(
      "a deploy base URL is required: --base https://docs.fluid.app (or EVAL_DOCS_BASE_URL).\n" +
        "  The /mcp, llms.txt, and llms-full.txt surfaces exist only on the hosted deploy.",
    );
  }

  const promptsPath = join(HERE, "prompts.json");
  let prompts;
  try {
    prompts = JSON.parse(await readFile(promptsPath, "utf8")).prompts;
  } catch (err) {
    fail(`could not read/parse ${promptsPath}: ${err.message}`);
  }
  if (!Array.isArray(prompts) || prompts.length === 0) fail("prompts.json has no prompts array.");

  const selected = CONFIG.only ? prompts.filter((p) => p.id.includes(CONFIG.only)) : prompts;
  if (selected.length === 0) fail(`--only "${CONFIG.only}" matched none of ${prompts.length} prompts.`);

  process.stderr.write(
    `Checking ${selected.length}/${prompts.length} prompts | base=${CONFIG.baseUrl} | ` +
      `concurrency=${CONFIG.concurrency}\n\n`,
  );

  // --- Agent-surface checks -------------------------------------------------
  const surface = [];
  const llmsIndex = await fetchAgentFile("llms.txt");
  const indexEntries = countLlmsEntries(llmsIndex.text);
  surface.push({
    name: "llms.txt",
    pass: llmsIndex.status === 200 && indexEntries > 0,
    detail:
      `${llmsIndex.status}, ${llmsIndex.text.length} chars, ${indexEntries} page entries, ` +
      `last-modified ${llmsIndex.lastModified}`,
    reason:
      llmsIndex.status !== 200
        ? `expected 200, got ${llmsIndex.status}`
        : indexEntries === 0
          ? "no markdown page entries — the index is a stub"
          : "",
  });

  const llmsFull = await fetchAgentFile("llms-full.txt");
  const fullShort = llmsFull.text.length < CONFIG.llmsMinChars;
  if (fullShort) {
    process.stderr.write(
      `  [llms-full] WARNING: ${llmsFull.text.length} chars is below the ${CONFIG.llmsMinChars} ` +
        `floor. The leakage scan below covers less than the published corpus — treat this run as ` +
        `failed, not as a caveat. Adjust EVAL_LLMS_MIN_CHARS only if the corpus really shrank.\n`,
    );
  }
  surface.push({
    name: "llms-full.txt",
    pass: llmsFull.status === 200 && !fullShort,
    detail: `${llmsFull.status}, ${llmsFull.text.length} chars, last-modified ${llmsFull.lastModified}`,
    reason:
      llmsFull.status !== 200
        ? `expected 200, got ${llmsFull.status}`
        : fullShort
          ? `only ${llmsFull.text.length} chars, below the ${CONFIG.llmsMinChars} floor`
          : "",
  });

  // --- Corpus legacy scan ---------------------------------------------------
  const llmsSections = splitLlmsSections(llmsFull.text);
  const corpusLegacy = scanLegacyAttributed(llmsSections);

  // --- Per-prompt: stage 1 retrieval, then stage 2 contract -----------------
  const perPrompt = await runPool(selected, CONFIG.concurrency, async (p) => {
    const workflow = p.expected?.type === "workflow";
    const base = { id: p.id, kind: workflow ? "workflow" : "api" };
    try {
      // Exactly one query decides the verdict, the way a real agent would ask once.
      // Retrying until a page ranks would launder a discoverability weakness into a
      // pass, so extra queries under --repeat are diagnostic only and never revisited
      // by the gate.
      const content = await withRetry(() => searchDocs(p.prompt), `search(${p.id})`);
      const chunks = splitChunks(content);
      const labels = chunks.map((c) => c.label);
      const targetPages = resolveTargetPages(llmsSections, p.expected);
      const retrieval = checkRetrievalStage(targetPages, labels);

      let repeatHits = null;
      if (CONFIG.repeat > 1) {
        repeatHits = [retrieval.pass];
        for (let i = 1; i < CONFIG.repeat; i++) {
          const again = await withRetry(() => searchDocs(p.prompt), `search(${p.id} #${i + 1})`);
          const againLabels = splitChunks(again).map((c) => c.label);
          repeatHits.push(checkRetrievalStage(targetPages, againLabels).pass);
        }
      }

      // Stage 2 runs even when stage 1 failed, on the first candidate page, so a
      // ranking problem and a contract problem are never conflated: a run can say
      // "search missed it, and the contract it would have found is correct".
      const checkedLabel = retrieval.hit || targetPages[0] || null;
      let contract = { pass: false, reasons: ["no target page to check"] };
      let pageInfo = null;
      if (checkedLabel) {
        pageInfo = await Promise.all(targetPages.map((l) => fetchTargetPage(l)));
        const primary = pageInfo.find((pg) => pg.label === checkedLabel) || pageInfo[0];
        const bad = pageInfo.filter((pg) => pg.status !== 200);
        if (bad.length === pageInfo.length) {
          contract = { pass: false, reasons: [`target page fetch failed: ${bad.map((pg) => `${pg.label} -> ${pg.status}`).join(", ")}`] };
        } else if (workflow) {
          // A workflow may legitimately span more than one declared page (a theme
          // guide plus the generated reference it points at), so terms are checked
          // against the union of the declared pages.
          contract = checkWorkflowContract(p.expected, pageInfo.map((pg) => pg.text).join("\n"));
        } else {
          contract = checkApiContract(p.expected, primary.text);
        }
      }

      // On a stage-1 failure only, look at the pages that DID rank: if one of them
      // documents the same operation, the answer was reachable and the miss is about
      // which page is canonical, not about content. Fetching is confined to failures
      // so a green run costs nothing extra.
      let alternates = null;
      if (!retrieval.pass && !workflow && targetPages.length > 0) {
        const fetched = await Promise.all(labels.map((l) => fetchTargetPage(l)));
        alternates = fetched
          .filter(
            (pg) =>
              pg.status === 200 &&
              contentHasMethod(pg.text, p.expected.method) &&
              contentHasPath(pg.text, p.expected.path),
          )
          .map((pg) => pg.label);
      }

      // Leakage is a property of the corpus, not of this prompt: a prompt whose
      // search happens to surface an offending page would otherwise fail for
      // something it does not test. Hits are collected and reported once, and
      // they still fail the run.
      const legacy = scanLegacyAttributed([
        ...chunks,
        ...(pageInfo || []).map((pg) => ({ label: pg.label, text: stripAgentBanner(pg.text) })),
      ]);

      return {
        ...base,
        retrieval: { pass: retrieval.pass, reasons: retrieval.reasons },
        contract: { pass: contract.pass, reasons: contract.reasons },
        // A stage-2 failure is a hard FAIL. A stage-1-only failure is a MISS: it
        // counts against the retrieval rate but does not by itself fail the run.
        status: !contract.pass ? "FAIL" : retrieval.pass ? "PASS" : "MISS",
        targetPages,
        checkedPage: checkedLabel,
        alternates,
        repeatHits,
        chars: content.length,
        pages: labels,
        legacy,
      };
    } catch (err) {
      return {
        ...base,
        retrieval: { pass: false, reasons: [err.message] },
        contract: { pass: false, reasons: ["not checked — retrieval errored"] },
        status: "ERROR",
        targetPages: [],
        checkedPage: null,
        alternates: null,
        repeatHits: null,
        chars: 0,
        pages: [],
        legacy: { sanctioned: [], unsanctioned: [] },
      };
    }
  });

  // --- Report ---------------------------------------------------------------
  const contractFailures = perPrompt.filter((r) => r.status === "FAIL" || r.status === "ERROR");
  const retrievalMisses = perPrompt.filter((r) => !r.retrieval.pass);
  const reported = perPrompt.filter((r) => r.status !== "PASS");
  const surfaceFailures = surface.filter((s) => !s.pass);
  const apiResults = perPrompt.filter((r) => r.kind === "api");
  const workflowResults = perPrompt.filter((r) => r.kind === "workflow");
  const passed = (rs) => rs.filter((r) => r.status === "PASS").length;

  process.stdout.write("=== AGENT SURFACE ===\n");
  for (const s of surface) {
    process.stdout.write(`[${s.pass ? "PASS" : "FAIL"}] ${s.name}: ${s.detail}\n`);
    if (!s.pass) process.stdout.write(`    why: ${s.reason}\n`);
  }

  // Union the corpus scan with every prompt's retrieved chunks. Both surfaces see
  // different material: llms-full.txt gives one terse section per reference page,
  // while /mcp returns the spec-derived parameter detail underneath it.
  const legacyHits = { sanctioned: new Map(), unsanctioned: new Map() };
  const collect = (bucket, hits, source) => {
    for (const h of hits) {
      const key = `${h.marker} ${h.label}`;
      if (!bucket.has(key)) bucket.set(key, { ...h, sources: new Set() });
      bucket.get(key).sources.add(source);
    }
  };
  collect(legacyHits.sanctioned, corpusLegacy.sanctioned, "llms-full.txt");
  collect(legacyHits.unsanctioned, corpusLegacy.unsanctioned, "llms-full.txt");
  for (const r of perPrompt) {
    collect(legacyHits.sanctioned, r.legacy.sanctioned, "/mcp + target pages");
    collect(legacyHits.unsanctioned, r.legacy.unsanctioned, "/mcp + target pages");
  }
  const unsanctionedLegacy = [...legacyHits.unsanctioned.values()];

  process.stdout.write("\n=== LEGACY LEAKAGE (llms-full.txt + retrieved content + target pages) ===\n");
  process.stdout.write(
    `[${unsanctionedLegacy.length === 0 ? "PASS" : "FAIL"}] ` +
      `${unsanctionedLegacy.length} unsanctioned marker/page pair(s), ` +
      `${legacyHits.sanctioned.size} sanctioned\n`,
  );
  for (const h of unsanctionedLegacy) {
    process.stdout.write(`    LEAK ${h.marker} in ${h.label} (seen via ${[...h.sources].join(", ")})\n`);
  }
  for (const h of legacyHits.sanctioned.values()) {
    process.stdout.write(`    ok   ${h.marker} in ${h.label} (seen via ${[...h.sources].join(", ")})\n`);
  }

  // The two stages answer different questions, so they are counted separately: a
  // stage-1 failure is a discoverability problem, a stage-2 failure is a
  // correctness problem, and conflating them hides which one you have.
  const stage = (rs, key) => `${rs.filter((r) => r[key].pass).length}/${rs.length}`;
  const retrievalVerdict = retrievalRateVerdict(
    perPrompt.filter((r) => r.retrieval.pass).length,
    perPrompt.length,
  );
  process.stdout.write("\n=== STAGE 1 — RETRIEVAL (is the documenting page discoverable?) ===\n");
  process.stdout.write(
    `[${retrievalVerdict.ok ? "PASS" : "FAIL"}] rate ${(retrievalVerdict.rate * 100).toFixed(1)}% ` +
      `(${stage(perPrompt, "retrieval")}), floor ${(RETRIEVAL_RATE_FLOOR * 100).toFixed(0)}%\n` +
      `api:      ${stage(apiResults, "retrieval")}\n` +
      `workflow: ${stage(workflowResults, "retrieval")}\n`,
  );
  process.stdout.write(
    "Gated as a rate, not per prompt: hosted search ranking varies run to run. Every\n" +
      "miss is named below regardless, so a real regression stays visible.\n",
  );
  if (retrievalMisses.length) {
    process.stdout.write(`missed: ${retrievalMisses.map((r) => r.id).join(", ")}\n`);
  }
  process.stdout.write("\n=== STAGE 2 — CONTRACT (is the documented contract correct?) ===\n");
  process.stdout.write(
    `[${contractFailures.length === 0 ? "PASS" : "FAIL"}] ` +
      `all: ${stage(perPrompt, "contract")} — must be 100%, no tolerance\n` +
      `api:      ${stage(apiResults, "contract")}\n` +
      `workflow: ${stage(workflowResults, "contract")}\n`,
  );
  process.stdout.write(`pages fetched: ${pageCache.size}\n`);

  if (CONFIG.repeat > 1) {
    process.stdout.write(
      `\n=== RETRIEVAL VARIANCE (--repeat ${CONFIG.repeat}, diagnostic only — not gated) ===\n`,
    );
    const unstable = perPrompt.filter(
      (r) => Array.isArray(r.repeatHits) && new Set(r.repeatHits).size > 1,
    );
    process.stdout.write(`${unstable.length}/${perPrompt.length} prompt(s) ranked inconsistently\n`);
    for (const r of unstable) {
      const hits = r.repeatHits.filter(Boolean).length;
      process.stdout.write(`    ${r.id}: hit ${hits}/${r.repeatHits.length}\n`);
    }
  }

  if (reported.length) {
    process.stdout.write("\n--- FAILURES AND MISSES ---\n");
    for (const r of reported) {
      const which = [!r.retrieval.pass && "stage1", !r.contract.pass && "stage2"]
        .filter(Boolean)
        .join("+");
      process.stdout.write(`[${r.status} ${which}] ${r.id}\n`);
      for (const reason of r.retrieval.reasons) process.stdout.write(`    stage1: ${reason}\n`);
      for (const reason of r.contract.reasons) process.stdout.write(`    stage2: ${reason}\n`);
      if (r.checkedPage) process.stdout.write(`    checked page: ${r.checkedPage}\n`);
      if (r.alternates) {
        process.stdout.write(
          r.alternates.length
            ? `    but a page that DID rank documents it: ${r.alternates.join(", ")}\n`
            : "    no page that ranked documents this operation\n",
        );
      }
      if (r.pages.length) process.stdout.write(`    retrieved pages: ${r.pages.join(", ")}\n`);
    }
  }

  process.stdout.write("\n=== SUMMARY ===\n");
  process.stdout.write(`base:                  ${CONFIG.baseUrl}\n`);
  process.stdout.write(`prompts checked:       ${perPrompt.length}\n`);
  process.stdout.write(`passed both stages:    ${passed(perPrompt)}\n`);
  process.stdout.write(
    `stage 1 retrieval:     ${stage(perPrompt, "retrieval")} = ${(retrievalVerdict.rate * 100).toFixed(1)}% ` +
      `(floor ${(RETRIEVAL_RATE_FLOOR * 100).toFixed(0)}%) ${retrievalVerdict.ok ? "OK" : "BELOW FLOOR"}\n`,
  );
  process.stdout.write(`stage 2 contract:      ${stage(perPrompt, "contract")} (must be 100%)\n`);
  process.stdout.write(`retrieval misses:      ${retrievalMisses.length}\n`);
  process.stdout.write(`contract failures:     ${perPrompt.filter((r) => r.status === "FAIL").length}\n`);
  process.stdout.write(`errored:               ${perPrompt.filter((r) => r.status === "ERROR").length}\n`);
  process.stdout.write(`surface checks failed: ${surfaceFailures.length}\n`);
  process.stdout.write(`unsanctioned legacy:   ${unsanctionedLegacy.length}\n`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resultsDir = join(HERE, "results");
  await mkdir(resultsDir, { recursive: true });
  const outPath = join(resultsDir, `${stamp}-hosted.json`);
  await writeFile(
    outPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        config: {
          baseUrl: CONFIG.baseUrl,
          only: CONFIG.only,
          repeat: CONFIG.repeat,
          concurrency: CONFIG.concurrency,
          retrievalRateFloor: RETRIEVAL_RATE_FLOOR,
        },
        verdict: { retrieval: retrievalVerdict, contractFailures: contractFailures.length },
        surface,
        legacy: {
          unsanctioned: unsanctionedLegacy.map((h) => ({ ...h, sources: [...h.sources] })),
          sanctioned: [...legacyHits.sanctioned.values()].map((h) => ({ ...h, sources: [...h.sources] })),
        },
        prompts: perPrompt,
      },
      null,
      2,
    ),
  );
  process.stdout.write(`\nWrote ${outPath}\n`);

  const ok = runVerdict({
    contractFailures: contractFailures.length,
    retrievalOk: retrievalVerdict.ok,
    surfaceFailures: surfaceFailures.length,
    unsanctionedLegacy: unsanctionedLegacy.length,
  });
  process.stdout.write(`\nVERDICT: ${ok ? "PASS" : "FAIL"} (exit ${ok ? 0 : 1})\n`);
  process.exit(ok ? 0 : 1);
}

// Only run when executed directly (`node eval/check-hosted-docs.mjs`), not when
// imported by check-hosted-docs.test.mjs, which exercises the pure functions below.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`FATAL: ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

// Pure parsing/checking helpers — exported for unit testing (see check-hosted-docs.test.mjs).
export {
  parseArgs,
  cacheBustedUrl,
  isRetryableStatus,
  parseSseText,
  splitChunks,
  normalizePath,
  isParamSegment,
  pathMatches,
  pathTemplateRegex,
  contentHasPath,
  contentHasMethod,
  operationLineRegex,
  resolveTargetPages,
  checkRetrievalStage,
  retrievalRateVerdict,
  runVerdict,
  hasQueryParamName,
  hasBodyField,
  authFromPage,
  checkApiContract,
  checkWorkflowContract,
  scanLegacy,
  splitLlmsSections,
  stripAgentBanner,
  isSanctionedLegacyHit,
  scanLegacyAttributed,
  countLlmsEntries,
};
