import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applyToDocs, buildNav, collectOperations, countRefs, matches, pageSlug, UNSORTED_SECTION } from "./generate-api-nav.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const storefront = {
  paths: {
    "/api/v202604/products": { get: { tags: ["storefront"], summary: "Public Products catalog", security: [], responses: {} } },
    "/api/v202604/company/products/{id}": {
      parameters: [],
      patch: { tags: ["company"], summary: "Update a Product", security: [{ bearer_auth: [] }], responses: {} },
    },
    "/api/v202604/company/categories/{id}/lighthouse": { get: { tags: ["company"], summary: "Latest Lighthouse result", security: [{ bearer_auth: [] }], responses: {} } },
    "/api/v202604/company/posts/{id}/lighthouse": { get: { tags: ["company"], summary: "Latest Lighthouse result", security: [{ bearer_auth: [] }], responses: {} } },
  },
};
const legacy = {
  paths: {
    "/api/products": { get: { tags: ["products"], summary: "List products", responses: {} } },
    "/api/uploads": { post: { tags: ["uploads"], summary: "Upload", responses: {} } },
    "/api/mystery": { get: { tags: ["mystery"], summary: "Mystery", responses: {} } },
  },
};
const specs = [
  { name: "storefront-v2026-04", source: "api-reference/storefront-v2026-04.yaml", doc: storefront },
  { name: "company-v0", source: "api-reference/company-v0.yaml", doc: legacy },
];
const config = {
  tab: "API Reference",
  manualGroupsBefore: ["Overview"],
  manualGroupsAfter: ["Portal & Widgets"],
  specs: { "company-v0": { openapi: { source: "api-reference/company-v0.yaml", directory: "api-reference/company-v0" }, legacyGroup: "Legacy (v0)" } },
  sections: [
    { section: "Storefront", groups: ["Products", "Categories", "Posts"] },
    { section: "DAM", groups: [], pages: ["api/dam-upload"] },
    { section: "Empty", groups: ["Nothing"] },
  ],
  exclude: [{ spec: "company-v0", tag: "^uploads$" }],
  rules: [
    { spec: "storefront-v2026-04", path: "^/api/v202604/(company/)?products", section: "Storefront", group: "Products" },
    { spec: "storefront-v2026-04", path: "/categories/", section: "Storefront", group: "Categories" },
    { spec: "storefront-v2026-04", path: "/posts/", section: "Storefront", group: "Posts" },
    { spec: "company-v0", tag: "^products$", section: "Storefront", group: "Products" },
  ],
};

test("collectOperations skips path-level keys and reads auth", () => {
  const ops = collectOperations("storefront-v2026-04", storefront);
  assert.equal(ops.length, 4);
  assert.deepEqual(ops.map((o) => o.auth), ["none", "required", "required", "required"]);
  assert.equal(collectOperations("x", { security: [{ a: [] }, {}], paths: { "/p": { get: {} } } })[0].auth, "none");
});

test("matches combines spec, tag, path, method and auth", () => {
  const op = { spec: "s", tag: "carts", path: "/api/carts/{t}", method: "patch", auth: "required" };
  assert.ok(matches({ spec: "s", tag: "^carts$", path: "^/api/carts", method: "PATCH", auth: "required" }, op));
  assert.ok(!matches({ spec: "other" }, op));
  assert.ok(!matches({ spec: "s", auth: "none" }, op));
});

test("pageSlug follows Mintlify's tag/summary URL, under the spec directory", () => {
  assert.equal(pageSlug({ spec: "storefront-v2026-04", tag: "storefront", summary: "Public Products catalog" }, config), "storefront/public-products-catalog");
  assert.equal(pageSlug({ spec: "company-v0", tag: "products", summary: "List products" }, config), "company-v0/products/list-products");
  assert.equal(pageSlug({ spec: "x", tag: "members", summary: "Change a member's type" }, config), "members/change-a-members-type");
});

// Summaries and tags from the synced specs; every expected slug was a 200 on
// docs.fluid.app when this was written.
test("pageSlug keeps the characters Mintlify keeps and removes the ones it removes", () => {
  const slug = (tag, summary) => pageSlug({ spec: "x", method: "get", path: "/p", tag, summary }, config);
  assert.equal(slug("carts", "Removes rep_buyer and customer for the cart"), "carts/removes-rep_buyer-and-customer-for-the-cart");
  assert.equal(slug("carts", "Updates subscribe:false to cart item"), "carts/updates-subscribe:false-to-cart-item");
  assert.equal(slug("order_edits", "Dry-run an edit and return the would-be order shape"), "order_edits/dry-run-an-edit-and-return-the-would-be-order-shape");
  assert.equal(slug("Gateways", "Verify a payment method ($0 auth)"), "gateways/verify-a-payment-method-$0-auth");
  assert.equal(slug("Transactions", "Credit/refund a transaction"), "transactions/creditrefund-a-transaction");
  assert.equal(
    slug("analytics_dashboard_home_live", 'Home > Live "Today so far" chart (cumulative today + same-DOW typical baseline)'),
    'analytics_dashboard_home_live/home->-live-"today-so-far"-chart-cumulative-today-+-same-dow-typical-baseline',
  );
  assert.equal(
    slug("analytics_subscription_billing", "Subscription Billing one day's renewals, each with its risk band"),
    "analytics_subscription_billing/subscription-billing-one-days-renewals-each-with-its-risk-band",
  );
  assert.equal(slug("orders", "List the signed-in member’s orders"), "orders/list-the-signed-in-member’s-orders");
  assert.equal(slug("messaging---bots", "List bots"), "messaging--bots/list-bots");
});

test("pageSlug follows Mintlify's edge cases", () => {
  const slug = (fields) => pageSlug({ spec: "x", method: "post", path: "/api/carts/{token}/items", tag: "carts", summary: "Add an item", ...fields }, config);
  // Only one edge hyphen is trimmed, so a trailing path parameter leaves one behind.
  assert.equal(slug({ summary: "Get a cart by {token}" }), "carts/get-a-cart-by-");
  assert.equal(slug({ summary: "" }), "carts/post-apicarts-items");
  assert.equal(slug({ tag: "" }), "add-an-item");
});

test("buildNav places, nests legacy, excludes, reports unsorted and collisions", () => {
  const { sections, unsorted, excluded, collisions } = buildNav(config, specs);
  assert.deepEqual(sections.map((s) => s.group), ["Storefront", "DAM", UNSORTED_SECTION]);
  const products = sections[0].pages[0];
  assert.equal(products.group, "Products");
  assert.deepEqual(products.pages.slice(0, 2), [
    "api-reference/storefront-v2026-04.yaml GET /api/v202604/products",
    "api-reference/storefront-v2026-04.yaml PATCH /api/v202604/company/products/{id}",
  ]);
  assert.deepEqual(products.pages[2], {
    group: "Legacy (v0)",
    openapi: config.specs["company-v0"].openapi,
    pages: ["GET /api/products"],
  });
  assert.deepEqual(sections[0].pages.map((g) => g.group), ["Products", "Categories"]);
  assert.deepEqual(sections[1].pages, ["api/dam-upload"]);
  assert.equal(excluded, 1);
  assert.deepEqual(unsorted.map((o) => o.path), ["/api/mystery"]);
  assert.deepEqual(sections[2].pages[0], { group: "company-v0", openapi: config.specs["company-v0"].openapi, pages: ["GET /api/mystery"] });
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].op.path, "/api/v202604/company/posts/{id}/lighthouse");
  assert.equal(countRefs(sections), 5);
});

test("buildNav falls back to the section a tag declares", () => {
  const doc = {
    tags: [{ name: "member-types", "x-fluid-section": "Storefront" }, { name: "stray", "x-fluid-section": "Nowhere" }],
    paths: { "/api/v2026-10/member-types": { get: { tags: ["member-types"], summary: "List", responses: {} } }, "/api/x": { get: { tags: ["stray"], summary: "X", responses: {} } } },
  };
  const { sections, unsorted } = buildNav({ ...config, rules: [] }, [{ name: "people", source: "api-reference/people.yaml", doc }]);
  assert.deepEqual(sections[0].pages.at(-1), { group: "Member types", pages: ["api-reference/people.yaml GET /api/v2026-10/member-types"] });
  assert.deepEqual(unsorted.map((o) => o.path), ["/api/x"]);
});

test("buildNav reports a collision only when Mintlify's URLs match", () => {
  const doc = {
    paths: {
      "/api/carts/{token}/rep": { delete: { tags: ["carts"], summary: "Removes rep_buyer", responses: {} } },
      "/api/carts/{token}/buyer": { delete: { tags: ["carts"], summary: "Removes rep buyer", responses: {} } },
      "/api/transactions/{id}/credit": { post: { tags: ["Transactions"], summary: "Credit/refund a transaction", responses: {} } },
      "/api/transactions/{id}/refund": { post: { tags: ["Transactions"], summary: "Creditrefund a transaction", responses: {} } },
    },
  };
  const { collisions } = buildNav({ ...config, rules: [] }, [{ name: "payments", source: "api-reference/payments.yaml", doc }]);
  assert.deepEqual(collisions.map((c) => c.slug), ["transactions/creditrefund-a-transaction"]);
});

test("buildNav leaves out an operation whose summary is too long for a page file", () => {
  const doc = { paths: { "/api/v202604/products/check": { post: { tags: ["storefront"], summary: "x".repeat(200), responses: {} } } } };
  const { sections, tooLong } = buildNav(config, [{ name: "storefront-v2026-04", source: "api-reference/storefront-v2026-04.yaml", doc }]);
  assert.equal(tooLong.length, 1);
  assert.equal(countRefs(sections), 0);
});

test("buildNav nests a group inside another when the section asks", () => {
  const nested = { ...config, sections: [{ section: "Storefront", groups: ["Products", "Categories", "Posts"], nest: { Categories: "Products" } }] };
  const { sections } = buildNav(nested, specs);
  const products = sections[0].pages[0];
  assert.equal(products.group, "Products");
  const children = products.pages.filter((c) => typeof c === "object").map((c) => c.group);
  assert.deepEqual(children, ["Categories", "Legacy (v0)"]);
  assert.deepEqual(sections[0].pages.map((g) => g.group), ["Products"]);
});

test("buildNav rejects a rule that names an undefined group", () => {
  const bad = { ...config, rules: [{ spec: "s", section: "Storefront", group: "Nope" }] };
  assert.throws(() => buildNav(bad, specs), /group "Nope"/);
});

test("applyToDocs keeps manual groups and other tabs", () => {
  const docs = {
    navigation: {
      tabs: [
        { tab: "Documentation", groups: [{ group: "Guides", pages: ["a"] }] },
        { tab: "API Reference", groups: [{ group: "Portal & Widgets", pages: ["p"] }, { group: "Old", pages: [] }, { group: "Overview", pages: ["o"] }] },
      ],
    },
  };
  const next = applyToDocs(docs, config, [{ group: "Storefront", pages: [] }]);
  assert.deepEqual(next.navigation.tabs[1].groups.map((g) => g.group), ["Overview", "Storefront", "Portal & Widgets"]);
  assert.deepEqual(next.navigation.tabs[0], docs.navigation.tabs[0]);
  assert.throws(() => applyToDocs(docs, { ...config, manualGroupsBefore: ["Missing"] }, []), /Missing/);
});

test("the committed mapping names only defined sections and groups", () => {
  const real = JSON.parse(readFileSync(join(ROOT, ".github/api-reference-nav.json"), "utf8"));
  assert.doesNotThrow(() => buildNav(real, []));
});
