#!/usr/bin/env node
// Mechanical claims checker for the guide truth gate (CURRENT-2587, Phase 3.5).
//
// Reads eval/guide-claims.json and validates every claim against the OpenAPI
// spec deterministically — NO LLM. It enforces registry hygiene, quote presence
// in the source guide, and (for mechanical claims) the structural facts the spec
// YAML can settle: endpoint/param/field/status existence, enums, required lists,
// types, defaults, maxima, absence, and example-payload validity.
//
// The contract lives in eval/guide-truth.md — this script implements it exactly.
//
// Node >=20, zero repo dependencies. YAML is parsed by shelling out once to a
// version-pinned js-yaml CLI via npx (`npx -y js-yaml@4.1.0 <spec>` prints the
// doc as JSON on stdout). --self-test uses in-memory fixtures and never shells out.
//
// Usage:
//   node eval/check-guide-claims.mjs
//   node eval/check-guide-claims.mjs --spec path/to/spec.yaml --claims path/to/claims.json
//   node eval/check-guide-claims.mjs --self-test
//
// Exit code: 0 only when there are zero failures. Warnings never affect it.

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

const DEFAULT_SPEC = "api-reference/storefront-v2026-04.yaml";
const DEFAULT_CLAIMS = "eval/guide-claims.json";
const JS_YAML_PIN = "js-yaml@4.1.0";

const CLAIM_TYPES = new Set([
  "endpoint",
  "auth",
  "parameter",
  "request-field",
  "response-field",
  "status-code",
  "example",
  "behavior",
  "negative",
]);
// Structural types the checker validates against the spec (check must be "mechanical").
const MECHANICAL_TYPES = new Set([
  "endpoint",
  "auth",
  "parameter",
  "request-field",
  "response-field",
  "status-code",
  "example",
]);
// Purely semantic types (check must be "semantic"; skipped by mechanical validation).
const SEMANTIC_TYPES = new Set(["behavior", "negative"]);
const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
// Request-body schema keywords the mini-validator does not model; encountering one
// yields a warning naming the claim + keyword rather than a silent pass/fail.
const UNSUPPORTED_KEYWORDS = ["oneOf", "anyOf", "not", "patternProperties"];

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function resolveFromRoot(p) {
  return isAbsolute(p) ? p : join(REPO_ROOT, p);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      return a.every((x, i) => deepEqual(x, b[i]));
    }
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function sameSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const bs = new Set(b);
  return a.every((x) => bs.has(x)) && b.every((x) => new Set(a).has(x));
}

function jsType(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

// ---------------------------------------------------------------------------
// Spec loading (YAML -> JSON via a pinned js-yaml one-shot)
// ---------------------------------------------------------------------------

function loadSpec(specPath) {
  const abs = resolveFromRoot(specPath);
  if (!existsSync(abs)) {
    throw new Error(`spec not found: ${abs}`);
  }
  let out;
  try {
    // js-yaml's CLI prints JSON.stringify(yaml.load(file)) to stdout.
    out = execFileSync("npx", ["-y", JS_YAML_PIN, abs], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const stderr = err.stderr ? String(err.stderr) : "";
    throw new Error(`failed to parse YAML via ${JS_YAML_PIN}: ${err.message}\n${stderr}`);
  }
  try {
    return JSON.parse(out);
  } catch (err) {
    throw new Error(`js-yaml output was not valid JSON: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// $ref resolution + allOf merging
// ---------------------------------------------------------------------------

function resolvePointer(spec, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return undefined;
  const parts = ref
    .slice(2)
    .split("/")
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let node = spec;
  for (const part of parts) {
    if (node == null || typeof node !== "object") return undefined;
    node = node[part];
  }
  return node;
}

// Follows top-level $ref chains (with a depth guard against cycles).
function deref(spec, node, depth = 0) {
  let cur = node;
  let d = depth;
  while (cur && typeof cur === "object" && typeof cur.$ref === "string" && d < 50) {
    cur = resolvePointer(spec, cur.$ref);
    d += 1;
  }
  return cur;
}

// Deep-merges an allOf schema into a single object schema. Properties are merged,
// required lists unioned, additionalProperties takes the most restrictive value.
// Schemas without allOf are returned deref'd as-is (nested refs resolved lazily on
// navigation). Idempotent and cycle-safe via a depth guard.
function mergeAllOf(spec, node, depth = 0) {
  const schema = deref(spec, node, depth);
  if (!schema || typeof schema !== "object" || !Array.isArray(schema.allOf)) {
    return schema;
  }
  if (depth > 50) return schema;

  const base = { ...schema };
  delete base.allOf;
  const parts = [base, ...schema.allOf];

  const merged = {};
  const props = {};
  const required = [];
  const apVals = [];
  let hasProps = false;
  let hasReq = false;

  for (const partRaw of parts) {
    const part = mergeAllOf(spec, partRaw, depth + 1);
    if (!part || typeof part !== "object") continue;
    for (const [k, v] of Object.entries(part)) {
      if (k === "allOf") continue;
      if (k === "properties") {
        Object.assign(props, v || {});
        hasProps = true;
      } else if (k === "required") {
        for (const r of v || []) if (!required.includes(r)) required.push(r);
        hasReq = true;
      } else if (k === "additionalProperties") {
        apVals.push(v);
      } else {
        merged[k] = v;
      }
    }
  }
  if (hasProps) merged.properties = props;
  if (hasReq) merged.required = required;
  if (apVals.length) {
    if (apVals.includes(false)) merged.additionalProperties = false;
    else {
      const obj = apVals.find((x) => x && typeof x === "object");
      merged.additionalProperties = obj ?? (apVals.includes(true) ? true : apVals[apVals.length - 1]);
    }
  }
  return merged;
}

// Normalizes an OpenAPI type declaration into {types:[non-null names], nullable}.
// Handles 3.1 type arrays (["string","null"]) and the 3.0 `nullable: true` keyword.
function schemaTypes(schema) {
  let types = [];
  let nullable = false;
  if (schema && schema.type !== undefined) {
    if (Array.isArray(schema.type)) {
      types = schema.type.filter((t) => t !== "null");
      nullable = schema.type.includes("null");
    } else if (typeof schema.type === "string") {
      types = [schema.type];
    }
  }
  if (schema && schema.nullable === true) nullable = true;
  return { types, nullable };
}

// ---------------------------------------------------------------------------
// Spec navigation helpers
// ---------------------------------------------------------------------------

function getPathItem(spec, path) {
  const paths = spec.paths || {};
  return paths[path] ? deref(spec, paths[path]) : undefined;
}

function getOperation(spec, path, method) {
  const item = getPathItem(spec, path);
  if (!item || typeof method !== "string") return undefined;
  const op = item[method.toLowerCase()];
  return op ? deref(spec, op) : undefined;
}

// Effective parameter set for an op: path-level params merged with op-level params
// (op-level wins on matching name+in), each $ref resolved.
function effectiveParameters(spec, path, method) {
  const item = getPathItem(spec, path) || {};
  const op = getOperation(spec, path, method) || {};
  const byKey = new Map();
  const add = (list) => {
    for (const raw of list || []) {
      const p = deref(spec, raw);
      if (!p || typeof p.name !== "string") continue;
      byKey.set(`${p.name} ${p.in}`, p);
    }
  };
  add(item.parameters);
  add(op.parameters);
  return [...byKey.values()];
}

function effectiveSecurity(spec, op) {
  if (op && op.security !== undefined) return op.security;
  if (spec.security !== undefined) return spec.security;
  return undefined;
}

function isNoneSecurity(sec) {
  if (sec === undefined) return true;
  if (Array.isArray(sec) && sec.length === 0) return true;
  if (Array.isArray(sec) && sec.every((req) => req && typeof req === "object" && Object.keys(req).length === 0)) {
    return true;
  }
  return false;
}

function requiresBearer(spec, sec) {
  if (!Array.isArray(sec) || sec.length === 0) return false;
  const schemes = (spec.components && spec.components.securitySchemes) || {};
  for (const req of sec) {
    if (!req || typeof req !== "object") continue;
    for (const name of Object.keys(req)) {
      const s = deref(spec, schemes[name]);
      if (!s) continue;
      if (s.type === "http" && typeof s.scheme === "string" && s.scheme.toLowerCase() === "bearer") return true;
      if (s.type === "apiKey" && s.in === "header" && typeof s.name === "string" && /bearer|authorization/i.test(s.name)) {
        return true;
      }
      if (s.type === "oauth2") return true;
    }
  }
  return false;
}

function requestBodyJsonSchema(spec, op) {
  const rb = op && deref(spec, op.requestBody);
  if (!rb || !rb.content) return undefined;
  const media = rb.content["application/json"];
  if (!media || !media.schema) return undefined;
  return media.schema;
}

function responseJsonSchema(spec, op, status) {
  const responses = op && op.responses;
  if (!responses) return undefined;
  const resp = deref(spec, responses[status]);
  if (!resp || !resp.content) return undefined;
  const media = resp.content["application/json"];
  if (!media || !media.schema) return undefined;
  return media.schema;
}

// Walks a dot path through a schema. `[]` steps into array items. Returns
// {found, schema (merged), parentObj (object schema holding the last named prop),
// leafName, reason}.
function navigatePath(spec, rootSchema, dotPath) {
  const tokens = String(dotPath).split(".");
  let current = rootSchema;
  let parentObj = null;
  let leafName = null;

  for (const tok of tokens) {
    const m = tok.match(/^([^[\]]*)((?:\[\])*)$/);
    if (!m) return { found: false, reason: `malformed path token '${tok}'` };
    const name = m[1];
    const brackets = m[2].length / 2;

    if (name !== "") {
      const merged = mergeAllOf(spec, current);
      if (!merged || typeof merged !== "object" || !merged.properties || !(name in merged.properties)) {
        return { found: false, reason: `no field '${name}'`, parentObj: merged, leafName: name };
      }
      parentObj = merged;
      leafName = name;
      current = merged.properties[name];
    }

    for (let b = 0; b < brackets; b++) {
      const merged = mergeAllOf(spec, current);
      if (!merged || !merged.items) {
        return { found: false, reason: `'${name || tok}' is not an array` };
      }
      current = merged.items;
      parentObj = null;
      leafName = null;
    }
  }
  return { found: true, schema: mergeAllOf(spec, current), parentObj, leafName };
}

// ---------------------------------------------------------------------------
// Quote-presence: whitespace-normalize both sides, map matches back to a line.
// ---------------------------------------------------------------------------

function normalizeNeedle(s) {
  return String(s).replace(/\s+/g, " ").trim();
}

// Builds a whitespace-collapsed copy of `text` plus a parallel array mapping each
// output character index to its 1-based source line.
function normalizeWithMap(text) {
  const chars = [];
  const lineMap = [];
  let line = 1;
  let inWs = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") line += 1;
    if (/\s/.test(ch)) {
      if (!inWs) {
        chars.push(" ");
        lineMap.push(line);
        inWs = true;
      }
    } else {
      chars.push(ch);
      lineMap.push(line);
      inWs = false;
    }
  }
  return { norm: chars.join(""), lineMap };
}

// Returns { present, lines: [1-based start lines of every occurrence] }.
function findQuote(guideText, quote) {
  const needle = normalizeNeedle(quote);
  if (needle === "") return { present: false, lines: [] };
  const { norm, lineMap } = normalizeWithMap(guideText);
  const lines = [];
  let from = 0;
  while (true) {
    const idx = norm.indexOf(needle, from);
    if (idx === -1) break;
    lines.push(lineMap[idx]);
    from = idx + 1;
  }
  return { present: lines.length > 0, lines };
}

// ---------------------------------------------------------------------------
// Result collector
// ---------------------------------------------------------------------------

function makeReport() {
  const failures = [];
  const warnings = [];
  return {
    failures,
    warnings,
    fail(claim, reason) {
      failures.push({ id: claim && claim.id, guide: claim && claim.guide, line: claim && claim.line, reason });
    },
    warn(claim, reason) {
      warnings.push({ id: claim && claim.id, guide: claim && claim.guide, line: claim && claim.line, reason });
    },
  };
}

// ---------------------------------------------------------------------------
// Registry hygiene
// ---------------------------------------------------------------------------

function checkHygiene(registry, report) {
  if (!registry || typeof registry !== "object" || !Array.isArray(registry.claims)) {
    report.failures.push({ id: "<registry>", guide: null, line: null, reason: "registry has no `claims` array" });
    return [];
  }

  const claims = registry.claims;
  const seenIds = new Map();
  const wellFormed = new Set(); // claim indices whose anchor is structurally usable

  claims.forEach((claim, idx) => {
    const where = { id: (claim && claim.id) || `<index ${idx}>`, guide: claim && claim.guide, line: claim && claim.line };

    if (!claim || typeof claim !== "object") {
      report.failures.push({ ...where, reason: "claim is not an object" });
      return;
    }

    // Required fields.
    for (const field of ["id", "guide", "line", "quote", "type", "check", "claim", "anchor"]) {
      if (claim[field] === undefined || claim[field] === null) {
        report.fail(claim, `missing required field '${field}'`);
      }
    }
    if (typeof claim.line !== "number") report.fail(claim, `'line' must be a number`);
    if (claim.quote !== undefined && typeof claim.quote !== "string") report.fail(claim, `'quote' must be a string`);

    // Unique id.
    if (typeof claim.id === "string") {
      if (seenIds.has(claim.id)) report.fail(claim, `duplicate id (also at index ${seenIds.get(claim.id)})`);
      else seenIds.set(claim.id, idx);
    }

    // Enum validity.
    if (!CLAIM_TYPES.has(claim.type)) {
      report.fail(claim, `invalid type '${claim.type}'`);
    }
    if (claim.check !== "mechanical" && claim.check !== "semantic") {
      report.fail(claim, `invalid check '${claim.check}' (want 'mechanical' | 'semantic')`);
    }

    // type <-> check consistency.
    if (SEMANTIC_TYPES.has(claim.type) && claim.check !== "semantic") {
      report.fail(claim, `type '${claim.type}' must have check 'semantic'`);
    }
    if (MECHANICAL_TYPES.has(claim.type) && claim.check !== "mechanical") {
      report.fail(claim, `type '${claim.type}' must have check 'mechanical'`);
    }

    // example must carry a payload.
    if (claim.type === "example" && (claim.payload === undefined || typeof claim.payload !== "object")) {
      report.fail(claim, `type 'example' must carry a 'payload' object`);
    }

    // Anchor well-formedness for the claim's type.
    const a = claim.anchor;
    const anchorOk = validateAnchorShape(claim, a, report);
    if (anchorOk) wellFormed.add(idx);
  });

  return wellFormed;
}

function validateAnchorShape(claim, anchor, report) {
  if (!anchor || typeof anchor !== "object") {
    report.fail(claim, "anchor missing or not an object");
    return false;
  }
  const type = claim.type;

  const needsOp = ["endpoint", "auth", "parameter", "request-field", "response-field", "status-code", "example"];
  if (needsOp.includes(type)) {
    let ok = true;
    if (typeof anchor.path !== "string" || !anchor.path.startsWith("/")) {
      report.fail(claim, `anchor.path must be a '/'-rooted string`);
      ok = false;
    }
    if (typeof anchor.method !== "string" || !HTTP_METHODS.has(anchor.method)) {
      report.fail(claim, `anchor.method must be a lowercase HTTP verb (got ${JSON.stringify(anchor.method)})`);
      ok = false;
    }
    if (type === "auth" && anchor.auth !== "none" && anchor.auth !== "bearer") {
      report.fail(claim, `anchor.auth must be 'none' | 'bearer'`);
      ok = false;
    }
    if (type === "parameter") {
      if (typeof anchor.param !== "string") {
        report.fail(claim, `anchor.param must be a string`);
        ok = false;
      }
      if (anchor.in !== "query" && anchor.in !== "path") {
        report.fail(claim, `anchor.in must be 'query' | 'path'`);
        ok = false;
      }
    }
    if ((type === "request-field" || type === "response-field") && typeof anchor.field !== "string") {
      report.fail(claim, `anchor.field must be a string`);
      ok = false;
    }
    if ((type === "response-field" || type === "status-code") && typeof anchor.status !== "string") {
      report.fail(claim, `anchor.status must be a string (e.g. "200")`);
      ok = false;
    }
    return ok;
  }

  if (type === "behavior" || type === "negative") {
    if (typeof anchor.topic !== "string") {
      report.fail(claim, `anchor.topic must be a string`);
      return false;
    }
    return true;
  }
  return false; // unknown type — already reported above
}

// ---------------------------------------------------------------------------
// Quote-presence check (all claims)
// ---------------------------------------------------------------------------

function checkQuote(claim, getGuide, report) {
  if (typeof claim.quote !== "string" || typeof claim.guide !== "string") return;
  const text = getGuide(claim.guide);
  if (text == null) {
    report.fail(claim, `guide file not found or unreadable: ${claim.guide}`);
    return;
  }
  const { present, lines } = findQuote(text, claim.quote);
  if (!present) {
    report.fail(claim, `quote not found in ${claim.guide} (whitespace-normalized): "${truncate(claim.quote)}"`);
    return;
  }
  if (typeof claim.line === "number" && !lines.includes(claim.line)) {
    report.warn(claim, `quote is at line ${lines[0]} but registry says line ${claim.line} (update 'line')`);
  }
}

function truncate(s, n = 70) {
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

// ---------------------------------------------------------------------------
// Mechanical validators (per anchor type)
// ---------------------------------------------------------------------------

function checkEndpoint(spec, claim, report) {
  const { path, method, absent } = claim.anchor;
  const op = getOperation(spec, path, method);
  if (absent) {
    if (op) report.fail(claim, `endpoint ${method.toUpperCase()} ${path} exists but is asserted absent`);
    return;
  }
  if (!op) report.fail(claim, `endpoint ${method.toUpperCase()} ${path} not found in spec`);
}

function checkAuth(spec, claim, report) {
  const { path, method, auth } = claim.anchor;
  const op = getOperation(spec, path, method);
  if (!op) {
    report.fail(claim, `operation ${method.toUpperCase()} ${path} not found (auth claim)`);
    return;
  }
  const sec = effectiveSecurity(spec, op);
  if (auth === "none") {
    if (!isNoneSecurity(sec)) {
      report.fail(claim, `${method.toUpperCase()} ${path} requires auth but claim says 'none' (security=${JSON.stringify(sec)})`);
    }
  } else if (auth === "bearer") {
    if (isNoneSecurity(sec) || !requiresBearer(spec, sec)) {
      report.fail(claim, `${method.toUpperCase()} ${path} does not require a bearer scheme but claim says 'bearer' (security=${JSON.stringify(sec)})`);
    }
  }
}

function checkParameter(spec, claim, report) {
  const a = claim.anchor;
  const op = getOperation(spec, a.path, a.method);
  if (!op) {
    report.fail(claim, `operation ${a.method.toUpperCase()} ${a.path} not found (parameter claim)`);
    return;
  }
  const params = effectiveParameters(spec, a.path, a.method);
  const param = params.find((p) => p.name === a.param && p.in === a.in);

  if (a.absent === true) {
    if (param) report.fail(claim, `param '${a.param}' (in ${a.in}) exists but is asserted absent`);
    return;
  }
  if (!param) {
    report.fail(claim, `param '${a.param}' (in ${a.in}) not found on ${a.method.toUpperCase()} ${a.path}`);
    return;
  }

  const schema = deref(spec, param.schema) || {};

  if (a.enum !== undefined) {
    const specEnum = schema.enum;
    if (!Array.isArray(specEnum)) {
      report.fail(claim, `param '${a.param}' has no enum in spec but claim asserts one`);
    } else if (a.enum_exact) {
      if (!sameSet(a.enum, specEnum)) {
        report.fail(claim, `param '${a.param}' enum ${JSON.stringify(specEnum)} != asserted exact ${JSON.stringify(a.enum)}`);
      }
    } else {
      const missing = a.enum.filter((v) => !specEnum.some((s) => deepEqual(s, v)));
      if (missing.length) report.fail(claim, `param '${a.param}' enum missing asserted values ${JSON.stringify(missing)} (spec has ${JSON.stringify(specEnum)})`);
    }
  }

  if (a.required !== undefined) {
    const isRequired = param.required === true;
    if (isRequired !== a.required) {
      report.fail(claim, `param '${a.param}' required=${isRequired} but claim asserts required=${a.required}`);
    }
  }

  if (a.default !== undefined) {
    if (!("default" in schema)) report.fail(claim, `param '${a.param}' has no default but claim asserts ${JSON.stringify(a.default)}`);
    else if (!deepEqual(schema.default, a.default)) {
      report.fail(claim, `param '${a.param}' default ${JSON.stringify(schema.default)} != asserted ${JSON.stringify(a.default)}`);
    }
  }

  if (a.maximum !== undefined) {
    if (schema.maximum === undefined) report.fail(claim, `param '${a.param}' has no maximum but claim asserts ${a.maximum}`);
    else if (schema.maximum !== a.maximum) report.fail(claim, `param '${a.param}' maximum ${schema.maximum} != asserted ${a.maximum}`);
  }
}

function checkRequestField(spec, claim, report) {
  const a = claim.anchor;
  const op = getOperation(spec, a.path, a.method);
  if (!op) {
    report.fail(claim, `operation ${a.method.toUpperCase()} ${a.path} not found (request-field claim)`);
    return;
  }
  const root = requestBodyJsonSchema(spec, op);
  if (!root) {
    report.fail(claim, `${a.method.toUpperCase()} ${a.path} has no application/json request body (request-field claim)`);
    return;
  }

  const res = navigatePath(spec, root, a.field);

  if (a.absent === true) {
    if (res.found) report.fail(claim, `request field '${a.field}' exists but is asserted absent`);
    return;
  }
  if (!res.found) {
    report.fail(claim, `request field '${a.field}' not found (${res.reason})`);
    return;
  }

  const schema = res.schema || {};
  const { types, nullable } = schemaTypes(schema);

  if (a.type !== undefined && !types.includes(a.type)) {
    report.fail(claim, `request field '${a.field}' type ${JSON.stringify(schema.type)} does not include '${a.type}'`);
  }
  if (a.nullable !== undefined && nullable !== a.nullable) {
    report.fail(claim, `request field '${a.field}' nullable=${nullable} but claim asserts ${a.nullable}`);
  }
  if (a.enum !== undefined) {
    if (!Array.isArray(schema.enum)) report.fail(claim, `request field '${a.field}' has no enum but claim asserts one`);
    else if (a.enum_exact ? !sameSet(a.enum, schema.enum) : a.enum.some((v) => !schema.enum.some((s) => deepEqual(s, v)))) {
      report.fail(claim, `request field '${a.field}' enum ${JSON.stringify(schema.enum)} does not satisfy asserted ${JSON.stringify(a.enum)}${a.enum_exact ? " (exact)" : ""}`);
    }
  }
  if (a.required !== undefined) {
    const parentRequired = (res.parentObj && res.parentObj.required) || [];
    const isReq = parentRequired.includes(res.leafName);
    if (isReq !== a.required) {
      report.fail(claim, `request field '${a.field}' required=${isReq} in its parent but claim asserts ${a.required}`);
    }
  }
  if (a.required_exact !== undefined) {
    const actual = schema.required || [];
    if (!sameSet(a.required_exact, actual)) {
      report.fail(claim, `request field '${a.field}' required list ${JSON.stringify(actual)} != asserted exact ${JSON.stringify(a.required_exact)}`);
    }
  }
}

function checkResponseField(spec, claim, report) {
  const a = claim.anchor;
  const op = getOperation(spec, a.path, a.method);
  if (!op) {
    report.fail(claim, `operation ${a.method.toUpperCase()} ${a.path} not found (response-field claim)`);
    return;
  }
  const root = responseJsonSchema(spec, op, a.status);
  if (!root) {
    report.fail(claim, `${a.method.toUpperCase()} ${a.path} has no application/json schema for status ${a.status}`);
    return;
  }
  const res = navigatePath(spec, root, a.field);
  if (a.absent === true) {
    if (res.found) report.fail(claim, `response field '${a.field}' (status ${a.status}) exists but is asserted absent`);
    return;
  }
  if (!res.found) {
    report.fail(claim, `response field '${a.field}' not found for status ${a.status} (${res.reason})`);
  }
}

function checkStatusCode(spec, claim, report) {
  const a = claim.anchor;
  const op = getOperation(spec, a.path, a.method);
  if (!op) {
    report.fail(claim, `operation ${a.method.toUpperCase()} ${a.path} not found (status-code claim)`);
    return;
  }
  const documented = op.responses && Object.prototype.hasOwnProperty.call(op.responses, a.status);
  if (a.absent === true) {
    if (documented) report.fail(claim, `status ${a.status} is documented on ${a.method.toUpperCase()} ${a.path} but asserted absent`);
    return;
  }
  if (!documented) report.fail(claim, `status ${a.status} not documented on ${a.method.toUpperCase()} ${a.path}`);
}

// ---------------------------------------------------------------------------
// Example payload validation (mini structural validator)
// ---------------------------------------------------------------------------

function matchesType(t, value) {
  switch (t) {
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true; // unknown declared type — do not reject
  }
}

function checkExample(spec, claim, report) {
  const a = claim.anchor;
  const op = getOperation(spec, a.path, a.method);
  if (!op) {
    report.fail(claim, `operation ${a.method.toUpperCase()} ${a.path} not found (example claim)`);
    return;
  }
  const root = requestBodyJsonSchema(spec, op);
  if (!root) {
    report.fail(claim, `${a.method.toUpperCase()} ${a.path} has no application/json request body (example claim)`);
    return;
  }
  const allowUnknown = a.allow_unknown === true;
  validateValue(spec, root, claim.payload, "payload", claim, report, allowUnknown);
}

function validateValue(spec, schemaNode, value, path, claim, report, allowUnknown) {
  const schema = mergeAllOf(spec, schemaNode);
  if (!schema || typeof schema !== "object") return;

  for (const kw of UNSUPPORTED_KEYWORDS) {
    if (schema[kw] !== undefined) {
      report.warn(claim, `unsupported schema keyword '${kw}' at ${path} — not validated`);
      return;
    }
  }

  const { types, nullable } = schemaTypes(schema);

  if (value === null) {
    if (!nullable) report.fail(claim, `${path}: null not allowed (type ${JSON.stringify(schema.type)})`);
    return;
  }

  if (types.length > 0 && !types.some((t) => matchesType(t, value))) {
    report.fail(claim, `${path}: expected type ${types.join("|")} but got ${jsType(value)}`);
    return;
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((e) => deepEqual(e, value))) {
    report.fail(claim, `${path}: value ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
    return;
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const props = schema.properties || {};
    const ap = schema.additionalProperties;
    for (const req of schema.required || []) {
      if (!(req in value)) report.fail(claim, `${path}.${req}: required property missing`);
    }
    for (const [k, v] of Object.entries(value)) {
      if (k in props) {
        validateValue(spec, props[k], v, `${path}.${k}`, claim, report, allowUnknown);
      } else if (ap === true || allowUnknown) {
        // permitted, unconstrained
      } else if (ap && typeof ap === "object") {
        validateValue(spec, ap, v, `${path}.${k}`, claim, report, allowUnknown);
      } else {
        report.fail(claim, `${path}.${k}: unknown property (not in schema; phantom-field trap)`);
      }
    }
  } else if (Array.isArray(value)) {
    if (schema.items) {
      value.forEach((el, i) => validateValue(spec, schema.items, el, `${path}[${i}]`, claim, report, allowUnknown));
    }
  }
}

// ---------------------------------------------------------------------------
// Dispatch + orchestration
// ---------------------------------------------------------------------------

const MECHANICAL_DISPATCH = {
  endpoint: checkEndpoint,
  auth: checkAuth,
  parameter: checkParameter,
  "request-field": checkRequestField,
  "response-field": checkResponseField,
  "status-code": checkStatusCode,
  example: checkExample,
};

// Runs every check against an already-parsed spec + registry. getGuide(path)
// returns the guide's text or null. Returns { report, stats }.
function checkAll(spec, registry, getGuide) {
  const report = makeReport();
  const wellFormed = checkHygiene(registry, report);
  const claims = Array.isArray(registry && registry.claims) ? registry.claims : [];

  let mechanicalValidated = 0;
  let semanticQuoteOnly = 0;

  claims.forEach((claim, idx) => {
    if (!claim || typeof claim !== "object") return;

    checkQuote(claim, getGuide, report);

    if (claim.check === "mechanical" && MECHANICAL_TYPES.has(claim.type)) {
      if (wellFormed.has(idx)) {
        const fn = MECHANICAL_DISPATCH[claim.type];
        if (fn) {
          try {
            fn(spec, claim, report);
          } catch (err) {
            report.fail(claim, `checker error: ${err.message}`);
          }
          mechanicalValidated += 1;
        }
      }
    } else if (claim.check === "semantic") {
      semanticQuoteOnly += 1;
    }
  });

  return {
    report,
    stats: {
      claimsChecked: claims.length,
      mechanicalValidated,
      semanticQuoteOnly,
      failures: report.failures.length,
      warnings: report.warnings.length,
    },
  };
}

function printReport(report, stats, out = process.stdout) {
  for (const w of report.warnings) {
    const loc = w.guide ? `${w.guide}:${w.line}` : "<registry>";
    out.write(`[WARN] ${w.id ?? "?"} ${loc} — ${w.reason}\n`);
  }
  for (const f of report.failures) {
    const loc = f.guide ? `${f.guide}:${f.line}` : "<registry>";
    out.write(`[FAIL] ${f.id ?? "?"} ${loc} — ${f.reason}\n`);
  }
  out.write("\n=== SUMMARY ===\n");
  out.write(`claims checked:            ${stats.claimsChecked}\n`);
  out.write(`mechanical validated:      ${stats.mechanicalValidated}\n`);
  out.write(`semantic (quote-only):     ${stats.semanticQuoteOnly}\n`);
  out.write(`warnings:                  ${stats.warnings}\n`);
  out.write(`failures:                  ${stats.failures}\n`);
  out.write(`\nVERDICT: ${stats.failures === 0 ? "PASS — every claim holds against the spec" : "FAIL — see failures above"}\n`);
}

// ---------------------------------------------------------------------------
// Self-test (embedded fixtures; no YAML step)
// ---------------------------------------------------------------------------

const SELFTEST_SPEC = {
  openapi: "3.1.0",
  components: {
    securitySchemes: { bearer_auth: { type: "http", scheme: "bearer" } },
    parameters: {
      PageLimit: { name: "page[limit]", in: "query", required: false, schema: { type: "integer", maximum: 100, default: 25 } },
    },
    schemas: {
      Widget: {
        type: "object",
        additionalProperties: false,
        required: ["title"],
        properties: {
          title: { type: "string" },
          status: { type: "string", enum: ["draft", "published"] },
          count: { type: "integer" },
          note: { type: ["string", "null"] },
          nested: { type: "object", additionalProperties: false, required: ["a"], properties: { a: { type: "string" }, b: { type: "integer" } } },
        },
      },
      WidgetCreate: {
        type: "object",
        required: ["widget"],
        additionalProperties: false,
        properties: { widget: { allOf: [{ $ref: "#/components/schemas/Widget" }, { required: ["title"] }] } },
      },
      WidgetListResponse: {
        allOf: [
          { type: "object", required: ["status"], properties: { status: { type: "integer" } } },
          { type: "object", required: ["widgets"], properties: { widgets: { type: "array", items: { $ref: "#/components/schemas/Widget" } } } },
        ],
      },
    },
  },
  paths: {
    "/api/v1/widgets": {
      get: {
        security: [],
        parameters: [
          { $ref: "#/components/parameters/PageLimit" },
          { name: "filter[kind]", in: "query", schema: { type: "string", enum: ["a", "b", "c"] } },
        ],
        responses: {
          "200": { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/WidgetListResponse" } } } },
          "422": { description: "invalid" },
        },
      },
      post: {
        security: [{ bearer_auth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/WidgetCreate" } } } },
        responses: { "201": { description: "created" } },
      },
    },
    "/api/v1/widgets/{id}": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
      get: { security: [{ bearer_auth: [] }], responses: { "200": { description: "ok" } } },
    },
  },
};

const SELFTEST_GUIDE_PATH = "fixtures/guide.mdx";
const SELFTEST_GUIDE_TEXT = [
  "line1 alpha", // 1
  "GET /api/v1/widgets returns a list", // 2
  "page[limit] max is 100", // 3
  "title is the only required field", // 4
  "status is draft or published", // 5
  "the widgets carry a title field", // 6
  "there is no page[offset] parameter", // 7
  "the create endpoint needs a bearer token", // 8
].join("\n");

// Helper to attach a present quote/line/guide + fill claim/check defaults.
function stClaim(id, type, check, anchor, extra = {}) {
  return {
    id,
    guide: SELFTEST_GUIDE_PATH,
    line: 1,
    quote: "line1 alpha",
    type,
    check,
    claim: `self-test ${id}`,
    anchor,
    ...extra,
  };
}

function runSelfTest() {
  // Each entry: [claim, shouldFail]. Positive cases must produce zero failures for
  // their id; failure cases must produce at least one.
  const cases = [
    // ---- endpoint ----
    [stClaim("F-missing-endpoint", "endpoint", "mechanical", { path: "/api/v1/nope", method: "get" }), true],
    [stClaim("P-endpoint", "endpoint", "mechanical", { path: "/api/v1/widgets", method: "get" }), false],
    [stClaim("F-absent-endpoint-violation", "endpoint", "mechanical", { path: "/api/v1/widgets", method: "get", absent: true }), true],
    [stClaim("P-absent-endpoint", "endpoint", "mechanical", { path: "/api/v1/gone", method: "delete", absent: true }), false],

    // ---- parameter ----
    [stClaim("F-missing-param", "parameter", "mechanical", { path: "/api/v1/widgets", method: "get", param: "page[offset]", in: "query" }), true],
    [stClaim("P-param", "parameter", "mechanical", { path: "/api/v1/widgets", method: "get", param: "page[limit]", in: "query", maximum: 100, default: 25 }), false],
    [stClaim("F-wrong-enum", "parameter", "mechanical", { path: "/api/v1/widgets", method: "get", param: "filter[kind]", in: "query", enum: ["a", "z"] }), true],
    [stClaim("P-enum-subset", "parameter", "mechanical", { path: "/api/v1/widgets", method: "get", param: "filter[kind]", in: "query", enum: ["a", "b"] }), false],
    [stClaim("F-absent-param-violation", "parameter", "mechanical", { path: "/api/v1/widgets", method: "get", param: "page[limit]", in: "query", absent: true }), true],
    [stClaim("P-absent-param", "parameter", "mechanical", { path: "/api/v1/widgets", method: "get", param: "page[offset]", in: "query", absent: true }), false],
    [stClaim("F-wrong-maximum", "parameter", "mechanical", { path: "/api/v1/widgets", method: "get", param: "page[limit]", in: "query", maximum: 50 }), true],

    // ---- auth ----
    [stClaim("F-wrong-auth", "auth", "mechanical", { path: "/api/v1/widgets", method: "get", auth: "bearer" }), true],
    [stClaim("P-auth-none", "auth", "mechanical", { path: "/api/v1/widgets", method: "get", auth: "none" }), false],
    [stClaim("P-auth-bearer", "auth", "mechanical", { path: "/api/v1/widgets", method: "post", auth: "bearer" }), false],
    [stClaim("F-auth-none-on-bearer", "auth", "mechanical", { path: "/api/v1/widgets", method: "post", auth: "none" }), true],

    // ---- request-field ----
    [stClaim("F-missing-required", "request-field", "mechanical", { path: "/api/v1/widgets", method: "post", field: "widget.count", required: true }), true],
    [stClaim("P-required", "request-field", "mechanical", { path: "/api/v1/widgets", method: "post", field: "widget.title", required: true }), false],
    [stClaim("F-wrong-required-exact", "request-field", "mechanical", { path: "/api/v1/widgets", method: "post", field: "widget", required_exact: ["title", "count"] }), true],
    [stClaim("P-required-exact", "request-field", "mechanical", { path: "/api/v1/widgets", method: "post", field: "widget", required_exact: ["title"] }), false],
    [stClaim("F-request-field-absent-violation", "request-field", "mechanical", { path: "/api/v1/widgets", method: "post", field: "widget.title", absent: true }), true],
    [stClaim("P-request-field-absent", "request-field", "mechanical", { path: "/api/v1/widgets", method: "post", field: "widget.phantom", absent: true }), false],
    [stClaim("P-request-type-nullable", "request-field", "mechanical", { path: "/api/v1/widgets", method: "post", field: "widget.note", type: "string", nullable: true }), false],
    [stClaim("F-request-wrong-type", "request-field", "mechanical", { path: "/api/v1/widgets", method: "post", field: "widget.count", type: "string" }), true],
    [stClaim("P-request-enum", "request-field", "mechanical", { path: "/api/v1/widgets", method: "post", field: "widget.status", enum: ["draft"] }), false],

    // ---- response-field ----
    [stClaim("F-response-field-missing", "response-field", "mechanical", { path: "/api/v1/widgets", method: "get", status: "200", field: "widgets[].bogus" }), true],
    [stClaim("P-response-field", "response-field", "mechanical", { path: "/api/v1/widgets", method: "get", status: "200", field: "widgets[].title" }), false],
    [stClaim("P-response-field-absent", "response-field", "mechanical", { path: "/api/v1/widgets", method: "get", status: "200", field: "widgets[].bogus", absent: true }), false],

    // ---- status-code ----
    [stClaim("F-missing-status", "status-code", "mechanical", { path: "/api/v1/widgets", method: "get", status: "418" }), true],
    [stClaim("P-status", "status-code", "mechanical", { path: "/api/v1/widgets", method: "get", status: "200" }), false],
    [stClaim("P-status-absent", "status-code", "mechanical", { path: "/api/v1/widgets", method: "get", status: "418", absent: true }), false],

    // ---- example payloads ----
    [stClaim("F-example-phantom", "example", "mechanical", { path: "/api/v1/widgets", method: "post" }, { payload: { widget: { title: "x", phantom: true } } }), true],
    [stClaim("F-example-missing-required", "example", "mechanical", { path: "/api/v1/widgets", method: "post" }, { payload: { widget: { status: "draft" } } }), true],
    [stClaim("F-example-wrong-enum", "example", "mechanical", { path: "/api/v1/widgets", method: "post" }, { payload: { widget: { title: "x", status: "bogus" } } }), true],
    [stClaim("F-example-wrong-type", "example", "mechanical", { path: "/api/v1/widgets", method: "post" }, { payload: { widget: { title: "x", count: "NaN" } } }), true],
    [stClaim("P-example", "example", "mechanical", { path: "/api/v1/widgets", method: "post" }, { payload: { widget: { title: "x", status: "draft", count: 2, note: null, nested: { a: "y" } } } }), false],
    [stClaim("P-example-allow-unknown", "example", "mechanical", { path: "/api/v1/widgets", method: "post", allow_unknown: true }, { payload: { widget: { title: "x", extra: 1 } } }), false],

    // ---- quote presence ----
    [stClaim("F-missing-quote", "behavior", "semantic", { topic: "phantom" }, { quote: "this sentence is absolutely not present in the guide" }), true],
    [stClaim("P-quote-semantic", "behavior", "semantic", { topic: "present" }, { quote: "title is the only required field", line: 4 }), false],
  ];

  const registry = { version: 1, claims: cases.map((c) => c[0]) };
  const getGuide = (p) => (p === SELFTEST_GUIDE_PATH ? SELFTEST_GUIDE_TEXT : null);
  const { report } = checkAll(SELFTEST_SPEC, registry, getGuide);

  const failedIds = new Set(report.failures.map((f) => f.id));
  const assertions = [];
  for (const [claim, shouldFail] of cases) {
    const did = failedIds.has(claim.id);
    const ok = did === shouldFail;
    assertions.push({ id: claim.id, ok, expected: shouldFail ? "FAIL" : "PASS", got: did ? "FAIL" : "PASS" });
  }

  // Warning behavior: a present quote at the wrong line warns (not fails).
  const warnCase = stClaim("W-line-mismatch", "behavior", "semantic", { topic: "warn" }, { quote: "page[limit] max is 100", line: 99 });
  const warnRun = checkAll(SELFTEST_SPEC, { version: 1, claims: [warnCase] }, getGuide);
  const warnedById = warnRun.report.warnings.some((w) => w.id === "W-line-mismatch");
  const warnDidFail = warnRun.report.failures.some((f) => f.id === "W-line-mismatch");
  assertions.push({ id: "W-line-mismatch(warns)", ok: warnedById && !warnDidFail, expected: "WARN-only", got: `${warnedById ? "warned" : "no-warn"}/${warnDidFail ? "failed" : "no-fail"}` });

  // Hygiene: malformed registry entries must each produce a failure.
  const hygieneClaims = [
    stClaim("dupX", "endpoint", "mechanical", { path: "/api/v1/widgets", method: "get" }),
    stClaim("dupX", "endpoint", "mechanical", { path: "/api/v1/widgets", method: "get" }), // duplicate id
    stClaim("H-badtype", "frobnicate", "mechanical", { path: "/api/v1/widgets", method: "get" }),
    stClaim("H-mech-type-wrong-check", "endpoint", "semantic", { path: "/api/v1/widgets", method: "get" }),
    stClaim("H-behavior-wrong-check", "behavior", "mechanical", { topic: "x" }),
    stClaim("H-bad-anchor", "parameter", "mechanical", { path: "/api/v1/widgets", method: "get", param: "x" }), // missing `in`
    { id: "H-missing-quote-field", guide: SELFTEST_GUIDE_PATH, line: 1, type: "endpoint", check: "mechanical", claim: "x", anchor: { path: "/api/v1/widgets", method: "get" } }, // no quote
  ];
  const hygieneRun = checkAll(SELFTEST_SPEC, { version: 1, claims: hygieneClaims }, getGuide);
  const hFails = hygieneRun.report.failures;
  const hygieneChecks = [
    ["hygiene: duplicate id", hFails.some((f) => /duplicate id/.test(f.reason))],
    ["hygiene: invalid type", hFails.some((f) => f.id === "H-badtype" && /invalid type/.test(f.reason))],
    ["hygiene: mechanical type needs mechanical check", hFails.some((f) => f.id === "H-mech-type-wrong-check" && /must have check 'mechanical'/.test(f.reason))],
    ["hygiene: behavior needs semantic check", hFails.some((f) => f.id === "H-behavior-wrong-check" && /must have check 'semantic'/.test(f.reason))],
    ["hygiene: malformed anchor (missing in)", hFails.some((f) => f.id === "H-bad-anchor" && /anchor\.in/.test(f.reason))],
    ["hygiene: missing required field", hFails.some((f) => f.id === "H-missing-quote-field" && /missing required field 'quote'/.test(f.reason))],
    ["hygiene: no claims array", (() => checkAll(SELFTEST_SPEC, {}, getGuide).report.failures.some((f) => /no `claims` array/.test(f.reason)))()],
  ];
  for (const [name, ok] of hygieneChecks) assertions.push({ id: name, ok, expected: "caught", got: ok ? "caught" : "MISSED" });

  // Report.
  let allOk = true;
  for (const a of assertions) {
    if (!a.ok) allOk = false;
    process.stdout.write(`${a.ok ? "ok  " : "FAIL"}  ${a.id}  (expected ${a.expected}, got ${a.got})\n`);
  }
  process.stdout.write(`\nSELF-TEST: ${assertions.length} assertions, ${assertions.filter((a) => !a.ok).length} failed\n`);
  process.stdout.write(`RESULT: ${allOk ? "PASS" : "FAIL"}\n`);
  process.exit(allOk ? 0 : 1);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { spec: DEFAULT_SPEC, claims: DEFAULT_CLAIMS, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--self-test") opts.selfTest = true;
    else if (arg === "--spec") opts.spec = argv[++i];
    else if (arg === "--claims") opts.claims = argv[++i];
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else {
      process.stderr.write(`Unknown argument: ${arg}\n`);
      opts.help = true;
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(
      [
        "Usage: node eval/check-guide-claims.mjs [options]",
        "  --spec <path>     OpenAPI spec (default api-reference/storefront-v2026-04.yaml)",
        "  --claims <path>   Claims registry (default eval/guide-claims.json)",
        "  --self-test       Run embedded fixtures proving each failure class is caught",
        "Paths are resolved relative to the repo root.",
      ].join("\n") + "\n",
    );
    process.exit(0);
  }

  if (opts.selfTest) {
    runSelfTest();
    return;
  }

  let spec;
  try {
    spec = loadSpec(opts.spec);
  } catch (err) {
    process.stderr.write(`ERROR loading spec: ${err.message}\n`);
    process.exit(2);
  }

  const claimsAbs = resolveFromRoot(opts.claims);
  if (!existsSync(claimsAbs)) {
    process.stderr.write(`ERROR: claims file not found: ${claimsAbs}\n`);
    process.exit(2);
  }
  let registry;
  try {
    registry = JSON.parse(readFileSync(claimsAbs, "utf8"));
  } catch (err) {
    process.stderr.write(`ERROR parsing claims JSON: ${err.message}\n`);
    process.exit(2);
  }

  const guideCache = new Map();
  const getGuide = (guidePath) => {
    if (guideCache.has(guidePath)) return guideCache.get(guidePath);
    let text = null;
    try {
      text = readFileSync(resolveFromRoot(guidePath), "utf8");
    } catch {
      text = null;
    }
    guideCache.set(guidePath, text);
    return text;
  };

  const { report, stats } = checkAll(spec, registry, getGuide);
  printReport(report, stats);
  process.exit(stats.failures === 0 ? 0 : 1);
}

main();
