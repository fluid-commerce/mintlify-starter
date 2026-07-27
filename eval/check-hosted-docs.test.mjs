// Unit tests for the pure helpers in check-hosted-docs.mjs.
//
// Zero dependencies — built-in node:test + node:assert only. Offline: nothing
// here touches the network, which is why CI can run it with no credentials.
//   node --test eval/check-hosted-docs.test.mjs
//   cd eval && node --test            # scans this directory (only *.test.mjs)
//
// These characterize the deterministic checker: argument parsing, SSE/chunk
// parsing, path-template matching against retrieved text, required/forbidden term
// evaluation, and legacy-marker attribution. They pin CURRENT behavior — where
// behavior is surprising, a comment marks it.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
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
} from "./check-hosted-docs.mjs";

describe("parseArgs", () => {
  it("reads --base and --only from argv", () => {
    const args = parseArgs(["--base", "https://docs.fluid.app", "--only", "bundle"]);
    assert.equal(args.base, "https://docs.fluid.app");
    assert.equal(args.only, "bundle");
  });

  it("strips trailing slashes so `${base}/mcp` is well-formed", () => {
    assert.equal(parseArgs(["--base", "https://docs.fluid.app///"]).base, "https://docs.fluid.app");
    assert.equal(parseArgs([], { EVAL_DOCS_BASE_URL: "https://docs.fluid.app/" }).base, "https://docs.fluid.app");
  });

  it("falls back to EVAL_DOCS_BASE_URL, and argv wins over env", () => {
    assert.equal(parseArgs([], { EVAL_DOCS_BASE_URL: "https://env.example" }).base, "https://env.example");
    assert.equal(
      parseArgs(["--base", "https://argv.example"], { EVAL_DOCS_BASE_URL: "https://env.example" }).base,
      "https://argv.example",
    );
  });

  it("defaults to empty strings, repeat 1, and ignores a flag with no value", () => {
    assert.deepEqual(parseArgs([]), { base: "", only: "", repeat: 1 });
    assert.deepEqual(parseArgs(["--base"]), { base: "", only: "", repeat: 1 });
  });

  it("reads --repeat as a positive integer, clamping junk to 1", () => {
    assert.equal(parseArgs(["--repeat", "5"]).repeat, 5);
    assert.equal(parseArgs(["--repeat", "0"]).repeat, 1);
    assert.equal(parseArgs(["--repeat", "-3"]).repeat, 1);
    assert.equal(parseArgs(["--repeat", "abc"]).repeat, 1);
    assert.equal(parseArgs(["--repeat"]).repeat, 1);
  });
});

describe("retrievalRateVerdict", () => {
  it("passes at or above the 90% floor", () => {
    assert.equal(retrievalRateVerdict(60, 63).ok, true);
    assert.equal(retrievalRateVerdict(9, 10).ok, true);
    assert.equal(retrievalRateVerdict(63, 63).ok, true);
  });

  it("fails below the floor", () => {
    assert.equal(retrievalRateVerdict(56, 63).ok, false);
    assert.equal(retrievalRateVerdict(8, 10).ok, false);
    assert.equal(retrievalRateVerdict(0, 63).ok, false);
  });

  it("reports the rate so it can be printed next to the floor", () => {
    assert.equal(retrievalRateVerdict(60, 63).rate.toFixed(3), "0.952");
  });

  it("accepts an explicit floor", () => {
    assert.equal(retrievalRateVerdict(60, 63, 1).ok, false);
    assert.equal(retrievalRateVerdict(60, 63, 0.5).ok, true);
  });

  it("fails an empty run rather than reporting a vacuous 100%", () => {
    // 0/0 must not read as success; there is nothing to be confident about.
    assert.deepEqual(retrievalRateVerdict(0, 0), { rate: 0, ok: false });
  });
});

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

describe("cacheBustedUrl", () => {
  it("appends the nonce as a new query string", () => {
    assert.equal(
      cacheBustedUrl("https://docs.example.com/llms-full.txt", 1234),
      "https://docs.example.com/llms-full.txt?cb=1234",
    );
  });

  it("preserves an existing query string", () => {
    assert.equal(cacheBustedUrl("https://docs.example.com/llms.txt?v=2", 99), "https://docs.example.com/llms.txt?v=2&cb=99");
  });

  it("returns a different URL for each nonce so no edge copy is reused", () => {
    const url = "https://docs.example.com/llms-full.txt";
    assert.notEqual(cacheBustedUrl(url, 1), cacheBustedUrl(url, 2));
  });
});

describe("parseSseText", () => {
  const frame = (obj) => `event: message\ndata: ${JSON.stringify(obj)}\n\n`;

  it("concatenates text entries from result.content across frames", () => {
    const raw =
      frame({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "first" }] } }) +
      frame({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "second" }] } });
    assert.equal(parseSseText(raw), "first\nsecond");
  });

  it("ignores non-text content entries", () => {
    const raw = frame({
      result: { content: [{ type: "text", text: "keep" }, { type: "resource", uri: "x" }] },
    });
    assert.equal(parseSseText(raw), "keep");
  });

  it("skips keep-alives, comments, and unparseable data lines", () => {
    const raw = `: ping\ndata: not json\n\n${frame({ result: { content: [{ type: "text", text: "ok" }] } })}`;
    assert.equal(parseSseText(raw), "ok");
  });

  it("returns an empty string for an error response or non-string input", () => {
    assert.equal(parseSseText(frame({ error: { code: -32601, message: "no such tool" } })), "");
    assert.equal(parseSseText(""), "");
    assert.equal(parseSseText(null), "");
  });
});

describe("splitChunks", () => {
  const retrieved = [
    "Title: Read the bundle structure",
    "Link: https://docs.fluid.app/themes/product-bundles#read-the-bundle-structure",
    "Page: themes/product-bundles",
    "Content: use product.bundle_groups[]",
    "Title: Cart API",
    "Link: https://docs.fluid.app/sdk/cart-api",
    "Page: sdk/cart-api",
    "Content: addCartItems()",
  ].join("\n");

  it("splits on Title: boundaries and labels each chunk with its page", () => {
    const chunks = splitChunks(retrieved);
    assert.equal(chunks.length, 2);
    assert.deepEqual(
      chunks.map((c) => c.label),
      ["themes/product-bundles", "sdk/cart-api"],
    );
    assert.match(chunks[0].text, /bundle_groups/);
    assert.match(chunks[1].text, /addCartItems/);
  });

  it("returns one unlabeled chunk when the content has no Title: headers", () => {
    const chunks = splitChunks("just some prose about /api/v202604/categories");
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].label, "(unlabeled)");
  });

  it("returns no chunks for empty or non-string input", () => {
    assert.deepEqual(splitChunks(""), []);
    assert.deepEqual(splitChunks("   "), []);
    assert.deepEqual(splitChunks(null), []);
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

  it("fails on segment-count mismatch and on a static-segment mismatch", () => {
    assert.equal(pathMatches("/api/v202604/categories/{id}", "/api/v202604/categories"), false);
    assert.equal(pathMatches("/api/v202604/company/categories/{id}", "/api/v202604/categories/4821"), false);
    assert.equal(pathMatches("/api/v202604/categories", "/api/v202604/collections"), false);
  });

  it("fails when a template slot is empty or a path is not a string", () => {
    assert.equal(pathMatches("/api/v202604/categories/{slug}", "/api/v202604/categories/"), false);
    assert.equal(pathMatches("/api/v202604/categories", null), false);
    assert.equal(pathMatches(undefined, "/api/v202604/categories"), false);
  });
});

describe("pathTemplateRegex", () => {
  it("wildcards each {placeholder} to exactly one path segment", () => {
    const re = pathTemplateRegex("/api/v202604/company/categories/{id}");
    assert.match("/api/v202604/company/categories/4821", re);
    assert.match("/api/v202604/company/categories/{id}", re);
    // One segment only, and the wildcard cannot backtrack to leave a trailing
    // sub-resource behind: a sub-resource path must not satisfy its parent.
    assert.doesNotMatch("/api/v202604/company/categories/4821/children", re);
    assert.doesNotMatch("/api/v202604/company/categories/{id}/reorder", re);
  });

  it("handles more than one wildcard in a path", () => {
    const re = pathTemplateRegex("/api/v202604/orders/{order_id}/edits/{id}");
    assert.match("POST /api/v202604/orders/9931/edits/412", re);
    assert.doesNotMatch("/api/v202604/orders/9931/edits", re);
  });

  it("escapes regex metacharacters in static segments", () => {
    const re = pathTemplateRegex("/api/v2026-04/carts.json");
    assert.match("GET /api/v2026-04/carts.json now", re);
    // The dot is literal, so it does not match an arbitrary character.
    assert.doesNotMatch("/api/v2026-04/cartsXjson", re);
  });

  it("returns null for a non-string path", () => {
    assert.equal(pathTemplateRegex(null), null);
  });
});

describe("contentHasPath", () => {
  it("finds a path inside surrounding prose, markdown, or a URL", () => {
    assert.equal(contentHasPath("Public operations under `/api/v202604/categories`, and", "/api/v202604/categories"), true);
    assert.equal(contentHasPath("see https://docs.fluid.app/api/v202604/categories now", "/api/v202604/categories"), true);
  });

  it("accepts a concrete value where the expectation has a template", () => {
    assert.equal(
      contentHasPath("GET /api/v202604/collections/wellness-essentials", "/api/v202604/collections/{slug}"),
      true,
    );
  });

  it("does not let a shorter path match inside a longer one", () => {
    // The trailing lookahead is what stops `/categories` passing on the strength
    // of `/categories/{slug}` alone — the collection path must appear in its own right.
    assert.equal(contentHasPath("only /api/v202604/categories/{slug} appears", "/api/v202604/categories"), false);
    assert.equal(contentHasPath("only /api/v202604/categories/{slug} appears", "/api/v202604/categories/{slug}"), true);
  });

  it("still matches when a query string, backtick, or newline follows", () => {
    assert.equal(contentHasPath("/api/v202604/categories?page[limit]=50", "/api/v202604/categories"), true);
    assert.equal(contentHasPath("`/api/v202604/categories`", "/api/v202604/categories"), true);
    assert.equal(contentHasPath("/api/v202604/categories\nnext line", "/api/v202604/categories"), true);
    // A bare trailing slash is not another segment, so it is tolerated too.
    assert.equal(contentHasPath("/api/v202604/categories/\n", "/api/v202604/categories"), true);
  });

  it("returns false when the path is absent", () => {
    assert.equal(contentHasPath("nothing relevant here", "/api/v202604/categories"), false);
    assert.equal(contentHasPath(null, "/api/v202604/categories"), false);
  });
});

describe("contentHasMethod", () => {
  it("finds the uppercase method used in prose and examples", () => {
    assert.equal(contentHasMethod("`GET /api/v202604/products` returns live products", "GET"), true);
    assert.equal(contentHasMethod("Send a POST to create it", "POST"), true);
  });

  it("finds the lowercase form on a generated reference contract line", () => {
    assert.equal(
      contentHasMethod("/api-reference/storefront-v2026-04.yaml get /api/v202604/categories", "GET"),
      true,
    );
    assert.equal(contentHasMethod("checkout-v2026-04.yaml post /api/checkout/v2026-04/carts", "POST"), true);
  });

  it("does NOT accept the lowercase method as an English word", () => {
    // A case-insensitive bare-word match would make every prompt pass on prose
    // like "get the collection", so lowercase only counts before a path.
    assert.equal(contentHasMethod("get the collection you need", "GET"), false);
    assert.equal(contentHasMethod("post a message to the channel", "POST"), false);
    assert.equal(contentHasMethod("delete the draft first", "DELETE"), false);
  });

  it("is word-bounded on the uppercase form", () => {
    assert.equal(contentHasMethod("TARGET_METHOD is set", "GET"), false);
    assert.equal(contentHasMethod("POSTAL_CODE", "POST"), false);
  });

  it("returns false for empty or non-string input", () => {
    assert.equal(contentHasMethod("", "GET"), false);
    assert.equal(contentHasMethod("GET /api", ""), false);
    assert.equal(contentHasMethod(null, "GET"), false);
  });
});

describe("operationLineRegex", () => {
  it("matches the generated contract line for the operation", () => {
    const re = operationLineRegex("GET", "/api/v202604/categories");
    assert.match("/api-reference/storefront-v2026-04.yaml get /api/v202604/categories", re);
  });

  it("distinguishes methods on the same path", () => {
    const post = operationLineRegex("POST", "/api/payment/v2026-04/gateways");
    assert.match("payment-v2026-04.yaml post /api/payment/v2026-04/gateways", post);
    // The same path with a different verb is a different page, so it must not match.
    assert.doesNotMatch("payment-v2026-04.yaml get /api/payment/v2026-04/gateways", post);
  });

  it("wildcards templated segments", () => {
    const re = operationLineRegex("PATCH", "/api/v202604/company/categories/{id}");
    assert.match("storefront-v2026-04.yaml patch /api/v202604/company/categories/{id}", re);
  });

  it("returns null for a missing method or path", () => {
    assert.equal(operationLineRegex("", "/api/v202604/categories"), null);
    assert.equal(operationLineRegex("GET", null), null);
  });
});

describe("resolveTargetPages", () => {
  const sections = [
    { label: "api-reference/gateways/list-gateways", text: "yaml get /api/payment/v2026-04/gateways" },
    { label: "api-reference/gateways/create-a-gateway", text: "yaml post /api/payment/v2026-04/gateways" },
  ];

  it("resolves an API prompt to the page whose contract line matches method and path", () => {
    assert.deepEqual(
      resolveTargetPages(sections, { method: "GET", path: "/api/payment/v2026-04/gateways" }),
      ["api-reference/gateways/list-gateways"],
    );
  });

  it("returns every candidate when a templated path is genuinely ambiguous", () => {
    // `/api/company/webhooks/{id}` wildcards over a literal sub-resource segment,
    // so a real corpus can offer more than one candidate. Both are reported.
    const webhooks = [
      { label: "api-reference/webhooks/show-a-webhook", text: "yaml get /api/company/webhooks/{id}" },
      { label: "api-reference/webhooks-resources/list", text: "yaml get /api/company/webhooks/resources" },
    ];
    assert.equal(resolveTargetPages(webhooks, { method: "GET", path: "/api/company/webhooks/{id}" }).length, 2);
  });

  it("returns an empty list when nothing documents the operation", () => {
    assert.deepEqual(resolveTargetPages(sections, { method: "DELETE", path: "/api/nope" }), []);
    assert.deepEqual(resolveTargetPages(null, { method: "GET", path: "/api/v202604/categories" }), []);
  });

  it("takes a workflow prompt's declared target_page, as a string or an array", () => {
    assert.deepEqual(
      resolveTargetPages(sections, { type: "workflow", target_page: "sdk/cart-api" }),
      ["sdk/cart-api"],
    );
    assert.deepEqual(
      resolveTargetPages(sections, { type: "workflow", target_page: ["themes/product-bundles", "sdk/cart-api"] }),
      ["themes/product-bundles", "sdk/cart-api"],
    );
    assert.deepEqual(resolveTargetPages(sections, { type: "workflow" }), []);
  });
});

describe("runVerdict", () => {
  const green = { contractFailures: 0, retrievalOk: true, surfaceFailures: 0, unsanctionedLegacy: 0 };

  it("passes only when all four gates hold", () => {
    assert.equal(runVerdict(green), true);
  });

  it("fails on any stage-2 contract failure, however small", () => {
    assert.equal(runVerdict({ ...green, contractFailures: 1 }), false);
  });

  it("fails when the stage-1 rate is below the floor", () => {
    assert.equal(runVerdict({ ...green, retrievalOk: false }), false);
  });

  it("fails on an unsanctioned legacy hit even with both stages green", () => {
    // Today's real case: stage 1 95.2%, stage 2 100%, and the run is still red
    // because of the checkout per_page leaks. That is the intended signal.
    assert.equal(runVerdict({ ...green, unsanctionedLegacy: 2 }), false);
  });

  it("fails on a surface-check failure even with both stages green", () => {
    assert.equal(runVerdict({ ...green, surfaceFailures: 1 }), false);
  });

  it("does not let a passing stage-1 rate excuse a stage-2 failure", () => {
    // The rate tolerance is stage 1's alone; it must never bleed into stage 2.
    assert.equal(
      runVerdict({ contractFailures: 1, retrievalOk: true, surfaceFailures: 0, unsanctionedLegacy: 0 }),
      false,
    );
  });

  it("requires retrievalOk to be exactly true, not merely truthy", () => {
    assert.equal(runVerdict({ ...green, retrievalOk: undefined }), false);
  });
});

describe("the stage-1 rate floor boundary", () => {
  it("passes at exactly 90%", () => {
    // 9/10 is exactly the floor and must be inclusive.
    const v = retrievalRateVerdict(9, 10);
    assert.equal(v.rate, 0.9);
    assert.equal(v.ok, true);
    assert.equal(runVerdict({ contractFailures: 0, retrievalOk: v.ok, surfaceFailures: 0, unsanctionedLegacy: 0 }), true);
  });

  it("fails just below 90%", () => {
    const v = retrievalRateVerdict(89, 100);
    assert.equal(v.ok, false);
    assert.equal(runVerdict({ contractFailures: 0, retrievalOk: v.ok, surfaceFailures: 0, unsanctionedLegacy: 0 }), false);
  });

  it("passes the current real numbers: 60/63 stage 1, clean stage 2", () => {
    const v = retrievalRateVerdict(60, 63);
    assert.equal(v.ok, true);
    assert.equal(runVerdict({ contractFailures: 0, retrievalOk: v.ok, surfaceFailures: 0, unsanctionedLegacy: 0 }), true);
  });
});

describe("checkRetrievalStage", () => {
  it("passes when a target page is among the retrieved pages, and reports which", () => {
    const res = checkRetrievalStage(["api-reference/gateways/list-gateways"], [
      "other/page",
      "api-reference/gateways/list-gateways",
    ]);
    assert.equal(res.pass, true);
    assert.equal(res.hit, "api-reference/gateways/list-gateways");
    assert.deepEqual(res.reasons, []);
  });

  it("passes on any one of several candidates", () => {
    const res = checkRetrievalStage(["a/one", "b/two"], ["b/two"]);
    assert.equal(res.pass, true);
    assert.equal(res.hit, "b/two");
  });

  it("fails, naming the wanted and the returned pages, when retrieval missed", () => {
    const res = checkRetrievalStage(["api-reference/subscriptions/create-a-subscription"], ["sdk/cart-api"]);
    assert.equal(res.pass, false);
    assert.equal(res.hit, null);
    assert.match(res.reasons[0], /did not return api-reference\/subscriptions\/create-a-subscription/);
    assert.match(res.reasons[0], /returned: sdk\/cart-api/);
  });

  it("reports a docs gap when no page documents the operation at all", () => {
    const res = checkRetrievalStage([], ["sdk/cart-api"]);
    assert.equal(res.pass, false);
    assert.match(res.reasons[0], /docs gap/);
  });

  it("says 'nothing' rather than an empty list when retrieval returned no pages", () => {
    assert.match(checkRetrievalStage(["a/one"], []).reasons[0], /returned: nothing/);
  });
});

describe("hasQueryParamName", () => {
  it("matches the inlined spec's parameter form", () => {
    const page = "      parameters:\n        - name: page[limit]\n          in: query\n";
    assert.equal(hasQueryParamName(page, "page[limit]"), true);
    assert.equal(hasQueryParamName(page, "filter[country]"), false);
  });

  it("does not accept a bare mention in prose", () => {
    // "the page[limit] parameter" in prose is not evidence the operation declares it.
    assert.equal(hasQueryParamName("pass the page[limit] parameter", "page[limit]"), false);
  });

  it("returns false for non-string page text", () => {
    assert.equal(hasQueryParamName(null, "sort"), false);
  });
});

describe("hasBodyField", () => {
  it("matches a schema property or an example key", () => {
    assert.equal(hasBodyField("        country_isos:\n          type: array\n", "country_isos"), true);
    assert.equal(hasBodyField("                  category:\n                    title: Summer Sale\n", "title"), true);
  });

  it("requires the colon, so a prose mention alone does not count", () => {
    assert.equal(hasBodyField("set the title of the category", "title"), false);
  });

  it("is word-bounded on the left, so a longer field name does not satisfy a shorter one", () => {
    assert.equal(hasBodyField("        parent_id:\n", "id"), false);
    assert.equal(hasBodyField("        id:\n", "id"), true);
  });

  it("escapes regex metacharacters in the field name", () => {
    assert.equal(hasBodyField("        page[limit]:\n", "page[limit]"), true);
  });

  it("returns false for empty or non-string input", () => {
    assert.equal(hasBodyField("title:", ""), false);
    assert.equal(hasBodyField(null, "title"), false);
  });
});

describe("authFromPage", () => {
  it("reads bearer from an inlined security requirement", () => {
    assert.equal(authFromPage("      security:\n        - bearer_auth: []\n"), "bearer");
  });

  it("reads none from an explicit empty security list", () => {
    assert.equal(authFromPage("      security: []\n"), "none");
  });

  it("does NOT treat the securityScheme definition as a requirement", () => {
    // The scheme renders without a leading dash; only the requirement has one.
    assert.equal(authFromPage("  securitySchemes:\n    bearer_auth:\n      type: http\n"), "none");
  });

  it("ignores the agent-instructions banner every page carries", () => {
    // Every page opens with this line, so a prose match would report bearer for all 57.
    assert.equal(
      authFromPage("> Authenticate with the header Authorization: Bearer <token>; public reads need no auth."),
      "none",
    );
  });

  it("returns none for non-string input", () => {
    assert.equal(authFromPage(null), "none");
  });
});

describe("checkApiContract", () => {
  const page = [
    "```yaml /api-reference/storefront-v2026-04.yaml get /api/v202604/categories",
    "      parameters:",
    "        - name: filter[country]",
    "        - name: page[limit]",
    "      security:",
    "        - bearer_auth: []",
    "      requestBody:",
    "        title:",
  ].join("\n");
  const expected = {
    method: "GET",
    path: "/api/v202604/categories",
    auth: "bearer",
    required_query_params: ["filter[country]", "page[limit]"],
    required_body_fields: ["title"],
  };

  it("passes when method, path, auth, params, and body fields all appear", () => {
    const res = checkApiContract(expected, page);
    assert.equal(res.pass, true);
    assert.deepEqual(res.reasons, []);
  });

  it("names an auth mismatch in both directions", () => {
    assert.match(checkApiContract({ ...expected, auth: "none" }, page).reasons[0], /page declares bearer, prompt expects none/);
    const unauth = page.replace("        - bearer_auth: []", "");
    assert.match(checkApiContract(expected, unauth).reasons[0], /page declares none, prompt expects bearer/);
  });

  it("names missing query params and body fields separately", () => {
    const res = checkApiContract(
      { ...expected, required_query_params: ["filter[language]"], required_body_fields: ["publish_at"] },
      page,
    );
    assert.equal(res.pass, false);
    assert.ok(res.reasons.some((r) => /query params not on the page: filter\[language\]/.test(r)));
    assert.ok(res.reasons.some((r) => /body fields not on the page: publish_at/.test(r)));
  });

  it("skips the auth check when the prompt declares no auth", () => {
    const { auth, ...noAuth } = expected;
    assert.equal(checkApiContract(noAuth, page).pass, true);
  });

  it("names a wrong path and a wrong method", () => {
    const res = checkApiContract({ ...expected, method: "DELETE", path: "/api/v202604/collections" }, page);
    assert.equal(res.reasons.filter((r) => /^(method|path)/.test(r)).length, 2);
  });
});

describe("checkWorkflowContract", () => {
  const expected = {
    type: "workflow",
    required_terms: ["addEnrollmentPack", "bundleSelections"],
    forbidden_terms: ["bundle_selections"],
  };

  it("passes when required terms are on the page and forbidden ones are not", () => {
    const res = checkWorkflowContract(expected, "Call addEnrollmentPack() with bundleSelections.");
    assert.equal(res.pass, true);
    assert.deepEqual(res.reasons, []);
  });

  it("matches case-insensitively", () => {
    assert.equal(
      checkWorkflowContract({ required_terms: ["CART_OPERATION_SUCCESS"] }, "listen for cart_operation_success").pass,
      true,
    );
  });

  it("names the missing required terms and the present forbidden terms", () => {
    const res = checkWorkflowContract(expected, "Call addEnrollmentPack() with bundle_selections.");
    assert.equal(res.pass, false);
    assert.ok(res.reasons.some((r) => /required terms not on the target page\(s\): bundleSelections/.test(r)));
    assert.ok(res.reasons.some((r) => /forbidden terms on the target page\(s\): bundle_selections/.test(r)));
  });

  it("matches substrings, so a broader term is satisfied by a longer name (pinned)", () => {
    // This is why distinguishing a current name from a legacy one needs the
    // distinguishing prefix spelled out.
    assert.equal(checkWorkflowContract({ required_terms: ["bundle_groups"] }, "legacy product_bundle_groups[]").pass, true);
    assert.equal(
      checkWorkflowContract({ required_terms: ["product.bundle_groups"] }, "legacy product.product_bundle_groups[]").pass,
      false,
    );
  });

  it("passes vacuously when a prompt declares no terms", () => {
    assert.equal(checkWorkflowContract({ type: "workflow" }, "anything").pass, true);
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

describe("splitLlmsSections", () => {
  const doc = [
    "> ## Agent Instructions",
    "> Never use /api/company/v1 paths or page/per_page params — they are legacy.",
    "",
    "# List webhooks",
    "Source: https://docs.fluid.app/api-reference/webhooks/list-webhooks",
    "",
    "/api-reference/webhooks-v0.yaml get /api/company/webhooks",
    "Pages with `page`/`per_page` (max 100).",
    "",
    "# Build a product bundle selector",
    "Source: https://docs.fluid.app/themes/product-bundles",
    "",
    "## Read the bundle structure",
    "Use `product.bundle_groups[]`.",
  ].join("\n");

  it("puts everything before the first heading in the banner section", () => {
    const sections = splitLlmsSections(doc);
    assert.equal(sections[0].label, "(agent-instructions banner)");
    assert.match(sections[0].text, /Agent Instructions/);
  });

  it("labels each page section with its Source path, host stripped", () => {
    const labels = splitLlmsSections(doc).map((s) => s.label);
    assert.deepEqual(labels, [
      "(agent-instructions banner)",
      "api-reference/webhooks/list-webhooks",
      "themes/product-bundles",
    ]);
  });

  it("does not split on deeper markdown headings inside a page body", () => {
    const sections = splitLlmsSections(doc);
    assert.equal(sections.length, 3);
    assert.match(sections[2].text, /## Read the bundle structure/);
  });

  it("returns an empty list for empty or non-string input", () => {
    assert.deepEqual(splitLlmsSections(""), []);
    assert.deepEqual(splitLlmsSections(null), []);
  });
});

describe("stripAgentBanner", () => {
  const page = [
    "> ## Documentation Index",
    "> Fetch the complete documentation index at: https://docs.fluid.app/llms.txt",
    "",
    "> ## Agent Instructions",
    "> Never use /api/company/v1 or /api/v1 paths, page/per_page params — they are legacy.",
    "> api-reference/webhooks-v0.yaml covers the unversioned webhooks surface.",
    "",
    "# Capture an authorization",
    "Source: https://docs.fluid.app/api-reference/transactions/capture-an-authorization",
    "amount_cents: integer",
  ].join("\n");

  it("removes the leading block-quoted banner and keeps the page body", () => {
    const body = stripAgentBanner(page);
    assert.match(body, /^# Capture an authorization/);
    assert.match(body, /amount_cents/);
  });

  it("removes the banner's legacy markers and spec filenames", () => {
    // Left in, these make the legacy scan hit every page and the webhooks-v0
    // sanction forgive every page.
    const body = stripAgentBanner(page);
    assert.equal(/\bper_page\b/.test(body), false);
    assert.equal(body.includes("webhooks-v0.yaml"), false);
  });

  it("keeps a block quote that appears inside the body", () => {
    const withQuote = "# Title\n\n> A callout in the body.\n";
    assert.equal(stripAgentBanner(withQuote), withQuote);
  });

  it("returns an empty string for a page that is nothing but banner, or non-strings", () => {
    assert.equal(stripAgentBanner("> only banner\n> more banner\n"), "");
    assert.equal(stripAgentBanner(null), "");
  });
});

describe("isSanctionedLegacyHit", () => {
  it("sanctions anything in the agent-instructions banner", () => {
    // The banner names the legacy markers in order to forbid them.
    assert.equal(isSanctionedLegacyHit("per_page", "(agent-instructions banner)"), true);
    assert.equal(isSanctionedLegacyHit("/api/v1/", "(agent-instructions banner)"), true);
  });

  it("sanctions per_page on the genuinely offset-paginated webhooks-v0 surface", () => {
    assert.equal(isSanctionedLegacyHit("per_page", "api-reference/webhooks/list-webhooks"), true);
    assert.equal(isSanctionedLegacyHit("per_page", "api-reference/callback-registrations/list"), true);
    assert.equal(isSanctionedLegacyHit("per_page", "some/other/page", "cites webhooks-v0.yaml here"), true);
  });

  it("does NOT sanction per_page on a hand-written prose page", () => {
    // AGENTS.md allows offset pagination only in the generated webhooks-v0
    // reference; prose must still use cursor-pagination language.
    assert.equal(isSanctionedLegacyHit("per_page", "api/guides/categories"), false);
    assert.equal(isSanctionedLegacyHit("per_page", "themes/product-bundles"), false);
  });

  it("never sanctions a legacy version or v1 path, even on the webhooks surface", () => {
    assert.equal(isSanctionedLegacyHit("v2025-06", "api-reference/webhooks/list-webhooks"), false);
    assert.equal(isSanctionedLegacyHit("/api/v1/", "api-reference/webhooks/list-webhooks"), false);
  });

  it("sanctions per_page on the seven verified offset checkout pages", () => {
    // Offset confirmed in the Rails actions, not just the spec. See AGENTS.md.
    for (const page of [
      "api-reference/customer-addresses/list-customer-addresses",
      "api-reference/customer-payment-methods/list-customer-payment-methods",
      "api-reference/customer-points/list-customer-points-ledger",
      "api-reference/directory/list-reps",
      "api-reference/directory/list-users",
      "api-reference/store/list-drop-zones",
      "api-reference/subscriptions/list-subscriptions",
    ]) {
      assert.equal(isSanctionedLegacyHit("per_page", page), true, page);
    }
  });

  it("sanctions customer-orders, whose cursor response still emits per_page", () => {
    // Cursor-paginated in code; the marker comes from its response metadata.
    assert.equal(
      isSanctionedLegacyHit("per_page", "api-reference/customer-orders/list-customer-orders"),
      true,
    );
  });

  it("does NOT sanction a neighbouring page sharing a sanctioned page's tag", () => {
    // The carve-out is page-by-page precisely so that `directory`, `store`, and
    // `subscriptions` — which also hold operations that paginate by cursor or not
    // at all — cannot launder a real leak on a sibling page.
    assert.equal(isSanctionedLegacyHit("per_page", "api-reference/subscriptions/create-a-subscription"), false);
    assert.equal(isSanctionedLegacyHit("per_page", "api-reference/directory/show-a-rep"), false);
    assert.equal(isSanctionedLegacyHit("per_page", "api-reference/store/get-store"), false);
    assert.equal(isSanctionedLegacyHit("per_page", "api-reference/customer-orders/show-customer-order"), false);
  });

  it("never sanctions a legacy version on a verified offset checkout page", () => {
    // The exception covers offset pagination only, not legacy surfaces.
    assert.equal(isSanctionedLegacyHit("v202506", "api-reference/subscriptions/list-subscriptions"), false);
    assert.equal(isSanctionedLegacyHit("/api/v1/", "api-reference/directory/list-users"), false);
  });

  it("sanctions the version marker on the adopted public-v2025-06 reference pages", () => {
    // Phase 9.6f. These pages' paths are genuinely /api/public/v2025-06/... and
    // /api/v202506/carts/..., so the marker is the contract, not a leak.
    for (const page of [
      "api-reference/carts/creates-a-cart",
      "api-reference/carts/adds-items-to-cart",
      "api-reference/enrollment-packs/get-enrollment-pack-by-slug",
      "api-reference/orders/retrieves-an-order-with-points-redemption",
      "api-reference/paypal/create-order-in-paypal",
      "api-reference/widgets/retrieve-cart-widget",
      "api-reference/public/health-health",
    ]) {
      assert.equal(isSanctionedLegacyHit("v2025-06", page), true, page);
      assert.equal(isSanctionedLegacyHit("v202506", page), true, page);
    }
    // Both marker spellings the two legacy patterns can capture, including the
    // case-insensitive underscore form.
    assert.equal(isSanctionedLegacyHit("V2025_06", "api-reference/session/start-a-new-session"), true);
    // The label is accepted with or without the api-reference/ prefix, matching how
    // llms-full.txt section labels and prompts' target_page labels differ.
    assert.equal(isSanctionedLegacyHit("v2025-06", "carts/creates-a-cart"), true);
  });

  it("does NOT sanction a v2026-04 page sharing a tag with a public-v2025-06 page", () => {
    // The load-bearing negative. `carts` holds 12 checkout-v2026-04 pages, `orders`
    // one, and `paypal` four; a version marker on any of those is a real leak, so the
    // carve-out is page-by-page and a `carts/` prefix would have forgiven all 17.
    assert.equal(isSanctionedLegacyHit("v2025-06", "api-reference/carts/create-a-cart"), false);
    assert.equal(isSanctionedLegacyHit("v2025-06", "api-reference/carts/complete-checkout"), false);
    assert.equal(isSanctionedLegacyHit("v202506", "api-reference/orders/show-order"), false);
    assert.equal(isSanctionedLegacyHit("v2025-06", "api-reference/paypal/authorize-a-paypal-order"), false);
  });

  it("does NOT sanction the legacy admin/partner v2025-06 surface", () => {
    // admin-v2025-06 and /api/v2025-06/* are a different API that earlier phases
    // removed. A blanket version sanction would have silently re-legitimised it.
    assert.equal(isSanctionedLegacyHit("v2025-06", "api-reference/tokens/list-partner-tokens"), false);
    assert.equal(isSanctionedLegacyHit("v2025-06", "api-reference/companies/list-companies"), false);
    assert.equal(isSanctionedLegacyHit("v2025-06", "api/authentication"), false);
    assert.equal(isSanctionedLegacyHit("v202506", "sdk/components"), false);
  });

  it("sanctions the version marker on the exact prose pages that explain the Public SDK API", () => {
    for (const page of ["api/choosing-a-cart-surface", "sdk/cart-api"]) {
      assert.equal(isSanctionedLegacyHit("v2025-06", page), true, page);
      assert.equal(isSanctionedLegacyHit("v202506", page), true, page);
      assert.equal(isSanctionedLegacyHit("per_page", page), false, page);
      assert.equal(isSanctionedLegacyHit("/api/v1/", page), false, page);
    }
  });

  it("sanctions only the version marker on a public-v2025-06 page", () => {
    // Adoption licenses the version in the path, nothing else. Whether the Public SDK
    // surface's offset `page`/`per_page` params are genuine is unverified against the
    // implementation, so per_page still fails there.
    const page = "api-reference/root-themes/list-root-themes";
    assert.equal(isSanctionedLegacyHit("v2025-06", page), true);
    assert.equal(isSanctionedLegacyHit("per_page", page), false);
    assert.equal(isSanctionedLegacyHit("/api/v1/", page), false);
    assert.equal(isSanctionedLegacyHit("company/v1/", page), false);
  });
});

describe("scanLegacyAttributed", () => {
  it("splits sanctioned from unsanctioned and keeps the owning section label", () => {
    const { sanctioned, unsanctioned } = scanLegacyAttributed([
      { label: "(agent-instructions banner)", text: "never use per_page" },
      { label: "api-reference/webhooks/list-webhooks", text: "pages with page/per_page" },
      { label: "api/guides/collections", text: "pass per_page=50" },
      { label: "api/guides/legacy", text: "GET /api/v1/categories" },
    ]);
    assert.deepEqual(
      sanctioned.map((h) => h.label),
      ["(agent-instructions banner)", "api-reference/webhooks/list-webhooks"],
    );
    assert.deepEqual(unsanctioned, [
      { marker: "per_page", label: "api/guides/collections" },
      { marker: "/api/v1/", label: "api/guides/legacy" },
    ]);
  });

  it("reports nothing for a clean corpus", () => {
    const res = scanLegacyAttributed([{ label: "api/guides/categories", text: "GET /api/v202604/categories?page[limit]=50" }]);
    assert.deepEqual(res.sanctioned, []);
    assert.deepEqual(res.unsanctioned, []);
  });

  it("forgives the public-v2025-06 section but not its checkout twin, on real labels", () => {
    // End-to-end through the label derivation splitLlmsSections actually performs, so
    // the sanctioned page spellings are pinned against the Source: URL form rather
    // than against a hand-written label. Both sections carry the same marker; only the
    // Public SDK one owns it.
    const doc = [
      "> ## Agent Instructions",
      "> Never use /api/company/v1/ or /api/v1/ paths — they are legacy.",
      "",
      "# Creates a cart",
      "Source: https://docs.fluid.app/api-reference/carts/creates-a-cart",
      "",
      "/api-reference/public-v2025-06.yaml post /api/public/v2025-06/commerce/carts",
      "",
      "# Create a cart",
      "Source: https://docs.fluid.app/api-reference/carts/create-a-cart",
      "",
      "/api-reference/checkout-v2026-04.yaml post /api/checkout/v2026-04/carts",
      "Superseded the old /api/v2025-06/carts endpoint.",
    ].join("\n");

    const { sanctioned, unsanctioned } = scanLegacyAttributed(splitLlmsSections(doc));
    assert.deepEqual(sanctioned, [
      { marker: "company/v1/", label: "(agent-instructions banner)" },
      { marker: "/api/v1/", label: "(agent-instructions banner)" },
      { marker: "v2025-06", label: "api-reference/carts/creates-a-cart" },
    ]);
    assert.deepEqual(unsanctioned, [
      { marker: "v2025-06", label: "api-reference/carts/create-a-cart" },
    ]);
  });
});

describe("countLlmsEntries", () => {
  it("counts markdown link-list entries", () => {
    const llms = [
      "# Fluid",
      "> Agent instructions here.",
      "## Guides",
      "- [Categories](https://docs.fluid.app/api/guides/categories): manage categories",
      "- [Collections](https://docs.fluid.app/api/guides/collections)",
      "  - [Nested](https://docs.fluid.app/nested)",
    ].join("\n");
    assert.equal(countLlmsEntries(llms), 3);
  });

  it("returns 0 for a stub index with no entries and for non-strings", () => {
    assert.equal(countLlmsEntries("# Fluid\n\n> Nothing here yet.\n"), 0);
    assert.equal(countLlmsEntries(null), 0);
  });
});
