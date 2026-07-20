// Unit tests for the pure grading/parsing helpers in run-eval.mjs.
//
// Zero dependencies — built-in node:test + node:assert only. Run with:
//   node --test eval/
//   node --test eval/run-eval.test.mjs
//
// These cover the code-only grader (no LLM, no network): path/auth matching,
// param/body flattening, JSON extraction from model text, legacy-endpoint
// scanning, and the gradeOne verdict that ties them together.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
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
} from "./run-eval.mjs";

// ---------------------------------------------------------------------------
// isRetryableStatus
// ---------------------------------------------------------------------------

test("isRetryableStatus: 429 and 5xx are retryable, others are not", () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(599), true);
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(404), false);
  assert.equal(isRetryableStatus(200), false);
  assert.equal(isRetryableStatus(600), false);
});

// ---------------------------------------------------------------------------
// normalizePath
// ---------------------------------------------------------------------------

test("normalizePath: strips host, query, fragment, and trailing slash", () => {
  assert.equal(normalizePath("https://acme.fluid.app/api/v202604/categories"), "/api/v202604/categories");
  assert.equal(normalizePath("/api/v202604/categories?page[limit]=50"), "/api/v202604/categories");
  assert.equal(normalizePath("/api/v202604/categories#frag"), "/api/v202604/categories");
  assert.equal(normalizePath("/api/v202604/categories/"), "/api/v202604/categories");
});

test("normalizePath: adds a leading slash and rejects non-strings", () => {
  assert.equal(normalizePath("api/v202604/categories"), "/api/v202604/categories");
  assert.equal(normalizePath(42), null);
  assert.equal(normalizePath(null), null);
});

// ---------------------------------------------------------------------------
// isParamSegment
// ---------------------------------------------------------------------------

test("isParamSegment: recognizes {tpl} and :param segments", () => {
  assert.equal(isParamSegment("{id}"), true);
  assert.equal(isParamSegment("{slug}"), true);
  assert.equal(isParamSegment(":id"), true);
  assert.equal(isParamSegment("categories"), false);
  assert.equal(isParamSegment("4821"), false);
});

// ---------------------------------------------------------------------------
// pathMatches
// ---------------------------------------------------------------------------

test("pathMatches: template segment accepts any concrete value", () => {
  const tpl = "/api/v202604/company/categories/{id}";
  assert.equal(pathMatches(tpl, "/api/v202604/company/categories/4821"), true);
  assert.equal(pathMatches(tpl, "/api/v202604/company/categories/summer-sale"), true);
  assert.equal(pathMatches(tpl, "/api/v202604/company/categories/{id}"), true); // echoed template
});

test("pathMatches: host and trailing slash are normalized before compare", () => {
  assert.equal(
    pathMatches("/api/v202604/categories/{slug}", "https://acme.fluid.app/api/v202604/categories/summer-sale/"),
    true,
  );
});

test("pathMatches: static-segment mismatch and length mismatch fail", () => {
  assert.equal(pathMatches("/api/v202604/categories", "/api/v202604/collections"), false);
  assert.equal(pathMatches("/api/v202604/categories/{id}", "/api/v202604/categories"), false);
  assert.equal(pathMatches("/api/v202604/company/categories/{id}", "/api/v202604/categories/4821"), false);
});

test("pathMatches: an empty value in a template slot fails", () => {
  assert.equal(pathMatches("/api/v202604/categories/{slug}", "/api/v202604/categories/"), false);
});

// ---------------------------------------------------------------------------
// flattenNames
// ---------------------------------------------------------------------------

test("flattenNames: nested object yields bare and bracket-reconstructed names", () => {
  const names = flattenNames({ filter: { country: "GB" } });
  assert.equal(names.has("filter"), true);
  assert.equal(names.has("country"), true);
  assert.equal(names.has("filter[country]"), true);
});

test("flattenNames: already-bracketed keys are preserved", () => {
  const names = flattenNames({ "filter[country]": "GB", "page[limit]": 50 });
  assert.equal(names.has("filter[country]"), true);
  assert.equal(names.has("page[limit]"), true);
});

test("flattenNames: non-objects produce an empty set", () => {
  assert.equal(flattenNames(null).size, 0);
  assert.equal(flattenNames([1, 2, 3]).size, 0);
  assert.equal(flattenNames("nope").size, 0);
});

// ---------------------------------------------------------------------------
// normalizeAuth
// ---------------------------------------------------------------------------

test("normalizeAuth: bearer/token variants normalize to 'bearer'", () => {
  assert.equal(normalizeAuth("bearer"), "bearer");
  assert.equal(normalizeAuth("Bearer <token>"), "bearer");
  assert.equal(normalizeAuth("requires token"), "bearer");
});

test("normalizeAuth: empty/none/public variants normalize to 'none'", () => {
  assert.equal(normalizeAuth(""), "none");
  assert.equal(normalizeAuth("none"), "none");
  assert.equal(normalizeAuth("no auth"), "none");
  assert.equal(normalizeAuth("unauthenticated"), "none");
  assert.equal(normalizeAuth("public"), "none");
});

test("normalizeAuth: non-strings become empty and unknown values pass through", () => {
  assert.equal(normalizeAuth(undefined), "");
  assert.equal(normalizeAuth(123), "");
  assert.equal(normalizeAuth("oauth2"), "oauth2");
});

// ---------------------------------------------------------------------------
// scanLegacy
// ---------------------------------------------------------------------------

test("scanLegacy: flags legacy endpoint / version / param markers", () => {
  assert.deepEqual(scanLegacy("use /api/v1/categories"), ["/api/v1/"]);
  assert.ok(scanLegacy("company/v1/categories").length > 0);
  assert.ok(scanLegacy("version v202506 is old").length > 0);
  assert.ok(scanLegacy("pass per_page=50").length > 0);
});

test("scanLegacy: clean modern text has no hits", () => {
  assert.deepEqual(scanLegacy("GET /api/v202604/categories?page[limit]=50"), []);
});

// ---------------------------------------------------------------------------
// extractFinalText
// ---------------------------------------------------------------------------

test("extractFinalText: concatenates text blocks, ignoring non-text", () => {
  const response = {
    content: [
      { type: "text", text: "line one" },
      { type: "tool_use", name: "search" },
      { type: "text", text: "line two" },
    ],
  };
  assert.equal(extractFinalText(response), "line one\nline two");
});

test("extractFinalText: malformed responses yield empty string", () => {
  assert.equal(extractFinalText(null), "");
  assert.equal(extractFinalText({}), "");
  assert.equal(extractFinalText({ content: "nope" }), "");
});

// ---------------------------------------------------------------------------
// parseAnyObject / extractJson
// ---------------------------------------------------------------------------

test("parseAnyObject: parses a bare JSON object", () => {
  const obj = parseAnyObject('{"method":"GET","path":"/api/v202604/categories"}');
  assert.equal(obj.method, "GET");
  assert.equal(obj.path, "/api/v202604/categories");
});

test("parseAnyObject: scans for an answer object embedded in prose", () => {
  const text = 'Here is the call: {"method":"POST","path":"/api/v202604/company/categories"} — done.';
  const obj = parseAnyObject(text);
  assert.equal(obj.method, "POST");
});

test("parseAnyObject: ignores JSON objects that are not answer-shaped", () => {
  // Has no method/path key, so the brace-scan rejects it.
  assert.equal(parseAnyObject('prose {"foo":"bar"} more'), null);
});

test("extractJson: pulls JSON out of a ```json fenced block", () => {
  const text = 'Sure:\n```json\n{"method":"GET","path":"/api/v202604/categories","auth":"none"}\n```';
  const obj = extractJson(text);
  assert.equal(obj.method, "GET");
  assert.equal(obj.auth, "none");
});

test("extractJson: returns null for text with no JSON", () => {
  assert.equal(extractJson("no json here"), null);
  assert.equal(extractJson(""), null);
  assert.equal(extractJson(null), null);
});

// ---------------------------------------------------------------------------
// gradeOne — the verdict that combines the helpers
// ---------------------------------------------------------------------------

const EXPECTED = {
  method: "POST",
  path: "/api/v202604/company/categories",
  auth: "bearer",
  required_query_params: [],
  required_body_fields: ["category", "category[title]"],
};

function answer(overrides = {}) {
  return {
    method: "POST",
    path: "/api/v202604/company/categories",
    auth: "bearer",
    query_params: {},
    body: { category: { title: "Summer Sale" } },
    ...overrides,
  };
}

test("gradeOne: a fully-correct answer passes with no reasons", () => {
  const { pass, reasons } = gradeOne(EXPECTED, answer());
  assert.equal(pass, true);
  assert.deepEqual(reasons, []);
});

test("gradeOne: null answer fails with a parse reason", () => {
  const { pass, reasons } = gradeOne(EXPECTED, null);
  assert.equal(pass, false);
  assert.match(reasons[0], /no parseable JSON/);
});

test("gradeOne: wrong method fails (case-insensitive compare)", () => {
  const okCase = gradeOne(EXPECTED, answer({ method: "post" }));
  assert.equal(okCase.pass, true); // case-insensitive: 'post' === 'POST'
  const wrong = gradeOne(EXPECTED, answer({ method: "GET" }));
  assert.equal(wrong.pass, false);
  assert.ok(wrong.reasons.some((r) => /method/.test(r)));
});

test("gradeOne: wrong path fails", () => {
  const { pass, reasons } = gradeOne(EXPECTED, answer({ path: "/api/v202604/company/collections" }));
  assert.equal(pass, false);
  assert.ok(reasons.some((r) => /path/.test(r)));
});

test("gradeOne: wrong auth fails", () => {
  const { pass, reasons } = gradeOne(EXPECTED, answer({ auth: "none" }));
  assert.equal(pass, false);
  assert.ok(reasons.some((r) => /auth/.test(r)));
});

test("gradeOne: missing required body field fails and names it", () => {
  const { pass, reasons } = gradeOne(EXPECTED, answer({ body: { category: {} } }));
  assert.equal(pass, false);
  assert.ok(reasons.some((r) => /missing body fields/.test(r) && /category\[title\]/.test(r)));
});

test("gradeOne: missing required query param fails", () => {
  const expected = { ...EXPECTED, required_query_params: ["filter[country]"], required_body_fields: [] };
  const { pass, reasons } = gradeOne(expected, answer({ query_params: {}, body: {} }));
  assert.equal(pass, false);
  assert.ok(reasons.some((r) => /missing query params/.test(r) && /filter\[country\]/.test(r)));
});

test("gradeOne: required query param supplied via nested object is accepted", () => {
  const expected = { ...EXPECTED, required_query_params: ["filter[country]"], required_body_fields: [] };
  const { pass } = gradeOne(expected, answer({ query_params: { filter: { country: "GB" } }, body: {} }));
  assert.equal(pass, true);
});

test("gradeOne: a concrete path value satisfies a templated expected path", () => {
  const expected = { method: "GET", path: "/api/v202604/company/categories/{id}", auth: "bearer" };
  const { pass } = gradeOne(expected, answer({ method: "GET", path: "/api/v202604/company/categories/4821", body: {} }));
  assert.equal(pass, true);
});
