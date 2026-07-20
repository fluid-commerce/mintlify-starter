// Unit tests for the pure grading/parsing helpers in run-eval.mjs.
//
// Zero dependencies — built-in node:test + node:assert only. Run with:
//   node --test eval/run-eval.test.mjs
//   cd eval && node --test            # scans this directory (only *.test.mjs)
//
// These characterize the code-only grader as it exists today (no LLM, no
// network): path/auth matching, param/body flattening, JSON extraction from
// model text, legacy-endpoint scanning, and the gradeOne verdict. They pin
// CURRENT behavior — where behavior is surprising, a comment marks it.

import { describe, it } from "node:test";
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

describe("isRetryableStatus", () => {
  it("treats 429 and any 5xx as retryable", () => {
    assert.equal(isRetryableStatus(429), true);
    assert.equal(isRetryableStatus(500), true);
    assert.equal(isRetryableStatus(503), true);
    assert.equal(isRetryableStatus(599), true);
  });

  it("treats 4xx (other than 429), 2xx, and out-of-range as non-retryable", () => {
    assert.equal(isRetryableStatus(400), false);
    assert.equal(isRetryableStatus(404), false);
    assert.equal(isRetryableStatus(200), false);
    assert.equal(isRetryableStatus(600), false);
  });
});

describe("normalizePath", () => {
  it("strips host, query string, fragment, and trailing slash", () => {
    assert.equal(normalizePath("https://acme.fluid.app/api/v202604/categories"), "/api/v202604/categories");
    assert.equal(normalizePath("/api/v202604/categories?page[limit]=50"), "/api/v202604/categories");
    assert.equal(normalizePath("/api/v202604/categories#frag"), "/api/v202604/categories");
    assert.equal(normalizePath("/api/v202604/categories/"), "/api/v202604/categories");
  });

  it("adds a leading slash when missing", () => {
    assert.equal(normalizePath("api/v202604/categories"), "/api/v202604/categories");
  });

  it("returns null for non-strings", () => {
    assert.equal(normalizePath(42), null);
    assert.equal(normalizePath(null), null);
    assert.equal(normalizePath(undefined), null);
  });
});

describe("isParamSegment", () => {
  it("recognizes {tpl} and :param segments", () => {
    assert.equal(isParamSegment("{id}"), true);
    assert.equal(isParamSegment("{slug}"), true);
    assert.equal(isParamSegment(":id"), true);
  });

  it("rejects static and concrete segments", () => {
    assert.equal(isParamSegment("categories"), false);
    assert.equal(isParamSegment("4821"), false);
    assert.equal(isParamSegment("summer-sale"), false);
  });
});

describe("pathMatches", () => {
  it("accepts any concrete value in an expected {template} slot", () => {
    const tpl = "/api/v202604/company/categories/{id}";
    assert.equal(pathMatches(tpl, "/api/v202604/company/categories/4821"), true);
    assert.equal(pathMatches(tpl, "/api/v202604/company/categories/summer-sale"), true);
  });

  it("accepts a template echoed back on the got side (param segment on both sides)", () => {
    assert.equal(pathMatches("/api/v202604/company/categories/{id}", "/api/v202604/company/categories/{id}"), true);
  });

  it("does NOT treat a got-side {template} as a wildcard when expected is concrete", () => {
    // Only the EXPECTED side's param segments are wildcards; a concrete expected
    // segment is compared literally, so "{id}" != "4821".
    assert.equal(pathMatches("/api/v202604/categories/4821", "/api/v202604/categories/{id}"), false);
  });

  it("normalizes host, query string, and trailing slash before comparing", () => {
    assert.equal(
      pathMatches("/api/v202604/categories/{slug}", "https://acme.fluid.app/api/v202604/categories/summer-sale/"),
      true,
    );
    assert.equal(pathMatches("/api/v202604/categories", "/api/v202604/categories?q=sale"), true);
  });

  it("is case-sensitive on static segments", () => {
    assert.equal(pathMatches("/api/v202604/categories", "/api/v202604/Categories"), false);
  });

  it("fails on segment-count mismatch", () => {
    assert.equal(pathMatches("/api/v202604/categories/{id}", "/api/v202604/categories"), false);
    assert.equal(pathMatches("/api/v202604/company/categories/{id}", "/api/v202604/categories/4821"), false);
  });

  it("fails on a static-segment value mismatch", () => {
    assert.equal(pathMatches("/api/v202604/categories", "/api/v202604/collections"), false);
  });

  it("fails when a template slot is empty", () => {
    assert.equal(pathMatches("/api/v202604/categories/{slug}", "/api/v202604/categories/"), false);
  });

  it("fails when either path is not a string", () => {
    assert.equal(pathMatches("/api/v202604/categories", null), false);
    assert.equal(pathMatches(undefined, "/api/v202604/categories"), false);
  });
});

describe("flattenNames", () => {
  it("yields bare names, bracket-reconstructed names, and nested keys", () => {
    const names = flattenNames({ filter: { country: "GB" } });
    assert.equal(names.has("filter"), true);
    assert.equal(names.has("country"), true);
    assert.equal(names.has("filter[country]"), true);
  });

  it("preserves keys that are already in bracket form", () => {
    const names = flattenNames({ "filter[country]": "GB", "page[limit]": 50 });
    assert.equal(names.has("filter[country]"), true);
    assert.equal(names.has("page[limit]"), true);
  });

  it("returns an empty set for non-objects and arrays", () => {
    assert.equal(flattenNames(null).size, 0);
    assert.equal(flattenNames([1, 2, 3]).size, 0);
    assert.equal(flattenNames("nope").size, 0);
  });
});

describe("normalizeAuth", () => {
  it("maps bearer/token variants to 'bearer'", () => {
    assert.equal(normalizeAuth("bearer"), "bearer");
    assert.equal(normalizeAuth("Bearer <token>"), "bearer");
    assert.equal(normalizeAuth("requires a token"), "bearer");
  });

  it("maps empty/none/no-auth/unauth/public to 'none'", () => {
    assert.equal(normalizeAuth(""), "none");
    assert.equal(normalizeAuth("none"), "none");
    assert.equal(normalizeAuth("no auth"), "none");
    assert.equal(normalizeAuth("unauthenticated"), "none");
    assert.equal(normalizeAuth("public"), "none");
  });

  it("returns '' for non-strings and passes unknown values through lowercased", () => {
    assert.equal(normalizeAuth(undefined), "");
    assert.equal(normalizeAuth(123), "");
    assert.equal(normalizeAuth("OAuth2"), "oauth2");
  });
});

describe("scanLegacy", () => {
  it("flags each legacy marker when present", () => {
    assert.deepEqual(scanLegacy("use company/v1/categories"), ["company/v1/"]);
    assert.deepEqual(scanLegacy("GET /api/v1/categories"), ["/api/v1/"]);
    assert.deepEqual(scanLegacy("this is v2025-06 stuff"), ["v2025-06"]);
    assert.deepEqual(scanLegacy("pass per_page=50"), ["per_page"]);
  });

  it("flags a compact v202506 twice (both the loose and exact version patterns fire)", () => {
    // /v2025[-_]?06/i AND /v202506/ both match "v202506" — pinned as-is.
    assert.deepEqual(scanLegacy("uses v202506 today"), ["v202506", "v202506"]);
  });

  it("does NOT flag modern/near-miss strings", () => {
    assert.deepEqual(scanLegacy("GET /api/v202604/categories?page[limit]=50"), []);
    assert.deepEqual(scanLegacy("/api/v10/categories"), []); // not /api/v1/
    assert.deepEqual(scanLegacy("released v2025-07"), []); // not ...06
    assert.deepEqual(scanLegacy("field named per_pages here"), []); // \bper_page\b is word-bounded
    assert.deepEqual(scanLegacy("the exper_page token"), []); // per_page not on a word boundary
  });

  it("matches company/v1/ as an unanchored substring (pinned)", () => {
    // Not word-bounded: it fires inside a longer host-ish token too.
    assert.deepEqual(scanLegacy("mycompany/v1/categories"), ["company/v1/"]);
  });
});

describe("extractFinalText", () => {
  it("concatenates text blocks with newlines, ignoring non-text blocks", () => {
    const response = {
      content: [
        { type: "text", text: "line one" },
        { type: "tool_use", name: "search" },
        { type: "text", text: "line two" },
      ],
    };
    assert.equal(extractFinalText(response), "line one\nline two");
  });

  it("returns an empty string for malformed responses", () => {
    assert.equal(extractFinalText(null), "");
    assert.equal(extractFinalText({}), "");
    assert.equal(extractFinalText({ content: "nope" }), "");
  });
});

describe("parseAnyObject", () => {
  it("parses a bare JSON object", () => {
    const obj = parseAnyObject('{"method":"GET","path":"/api/v202604/categories"}');
    assert.equal(obj.method, "GET");
    assert.equal(obj.path, "/api/v202604/categories");
  });

  it("returns a bare non-answer object as-is (pinned: the top-level JSON.parse wins)", () => {
    // A cleanly-parseable object is returned even without method/path — the
    // method/path filter only gates the embedded brace-scan fallback below.
    assert.deepEqual(parseAnyObject('{"foo":"bar"}'), { foo: "bar" });
  });

  it("scans out an answer object embedded in prose", () => {
    const obj = parseAnyObject('Here is the call: {"method":"POST","path":"/api/v202604/company/categories"} — done.');
    assert.equal(obj.method, "POST");
  });

  it("returns null for an embedded object that is not answer-shaped", () => {
    assert.equal(parseAnyObject('prose {"foo":"bar"} more'), null);
  });

  it("returns null for single-quoted / malformed input and bare arrays", () => {
    assert.equal(parseAnyObject("{'method':'GET'}"), null);
    assert.equal(parseAnyObject("[1,2,3]"), null);
    assert.equal(parseAnyObject("not json at all"), null);
  });
});

describe("extractJson", () => {
  it("pulls JSON out of a ```json fenced block", () => {
    const text = 'Sure:\n```json\n{"method":"GET","path":"/api/v202604/categories","auth":"none"}\n```';
    const obj = extractJson(text);
    assert.equal(obj.method, "GET");
    assert.equal(obj.auth, "none");
  });

  it("pulls JSON out of an unlabeled fence with trailing prose", () => {
    const text = 'Answer below.\n```\n{"method":"POST","path":"/api/v202604/company/categories"}\n```\nThanks!';
    assert.equal(extractJson(text).method, "POST");
  });

  it("extracts bare JSON with no fence", () => {
    assert.equal(extractJson('{"method":"GET","path":"/api/v202604/categories"}').method, "GET");
  });

  it("returns null when there is no JSON", () => {
    assert.equal(extractJson("no json here"), null);
    assert.equal(extractJson(""), null);
    assert.equal(extractJson(null), null);
  });
});

describe("gradeOne", () => {
  // Mirrors prompts.json entry "cat-company-create".
  const EXPECTED_CREATE = {
    method: "POST",
    path: "/api/v202604/company/categories",
    auth: "bearer",
    required_body_fields: ["title"],
  };
  const goodCreate = () => ({
    method: "POST",
    path: "/api/v202604/company/categories",
    auth: "bearer",
    query_params: {},
    body: { category: { title: "Summer Sale" } },
  });

  it("passes a fully-correct answer with no reasons", () => {
    const { pass, reasons } = gradeOne(EXPECTED_CREATE, goodCreate());
    assert.equal(pass, true);
    assert.deepEqual(reasons, []);
  });

  it("fails a null answer with a parse reason", () => {
    const { pass, reasons } = gradeOne(EXPECTED_CREATE, null);
    assert.equal(pass, false);
    assert.match(reasons[0], /no parseable JSON/);
  });

  it("matches method case-insensitively but fails a genuinely wrong method", () => {
    assert.equal(gradeOne(EXPECTED_CREATE, { ...goodCreate(), method: "post" }).pass, true);
    const wrong = gradeOne(EXPECTED_CREATE, { ...goodCreate(), method: "GET" });
    assert.equal(wrong.pass, false);
    assert.ok(wrong.reasons.some((r) => /method/.test(r)));
  });

  it("fails a wrong path", () => {
    const res = gradeOne(EXPECTED_CREATE, { ...goodCreate(), path: "/api/v202604/company/collections" });
    assert.equal(res.pass, false);
    assert.ok(res.reasons.some((r) => /path/.test(r)));
  });

  it("fails an auth mismatch", () => {
    const res = gradeOne(EXPECTED_CREATE, { ...goodCreate(), auth: "none" });
    assert.equal(res.pass, false);
    assert.ok(res.reasons.some((r) => /auth/.test(r)));
  });

  it("fails and names a missing required body field", () => {
    const res = gradeOne(EXPECTED_CREATE, { ...goodCreate(), body: { category: {} } });
    assert.equal(res.pass, false);
    assert.ok(res.reasons.some((r) => /missing body fields/.test(r) && /title/.test(r)));
  });

  it("tolerates extra query params and body fields beyond the required set", () => {
    const res = gradeOne(EXPECTED_CREATE, {
      ...goodCreate(),
      query_params: { lang: "fr" },
      body: { category: { title: "Summer Sale", description: "extra", parent_id: null } },
    });
    assert.equal(res.pass, true);
    assert.deepEqual(res.reasons, []);
  });

  // Mirrors prompts.json entry "cat-public-parameterized-list".
  const EXPECTED_LIST = {
    method: "GET",
    path: "/api/v202604/categories",
    auth: "none",
    required_query_params: ["filter[country]", "sort", "page[limit]"],
  };

  it("passes a GET with all required query params (bracket + bare forms)", () => {
    const res = gradeOne(EXPECTED_LIST, {
      method: "GET",
      path: "/api/v202604/categories",
      auth: "none",
      query_params: { "filter[country]": "GB", sort: "-created_at", "page[limit]": 50 },
      body: {},
    });
    assert.equal(res.pass, true);
  });

  it("accepts a required bracket param supplied as a nested object", () => {
    const res = gradeOne(
      { ...EXPECTED_LIST, required_query_params: ["filter[country]"] },
      {
        method: "GET",
        path: "/api/v202604/categories",
        auth: "none",
        query_params: { filter: { country: "GB" } },
        body: {},
      },
    );
    assert.equal(res.pass, true);
  });

  it("fails and names a missing required query param", () => {
    const res = gradeOne(
      { ...EXPECTED_LIST, required_query_params: ["filter[country]"] },
      { method: "GET", path: "/api/v202604/categories", auth: "none", query_params: {}, body: {} },
    );
    assert.equal(res.pass, false);
    assert.ok(res.reasons.some((r) => /missing query params/.test(r) && /filter\[country\]/.test(r)));
  });

  it("accepts a concrete path value against a templated expected path (PATCH by id)", () => {
    const expected = {
      method: "PATCH",
      path: "/api/v202604/company/categories/{id}",
      auth: "bearer",
      required_body_fields: ["status", "publish_at"],
    };
    const res = gradeOne(expected, {
      method: "PATCH",
      path: "/api/v202604/company/categories/4821",
      auth: "bearer",
      query_params: {},
      body: { category: { status: "scheduled", publish_at: "2026-07-01T08:00:00Z" } },
    });
    assert.equal(res.pass, true);
  });
});
