import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  collectNavigationPages,
  normalizeAdvertisedUrl,
  validateAdvertisedLinks,
} from "./check-advertised-docs-links.mjs";

describe("normalizeAdvertisedUrl", () => {
  it("returns the authored route for a canonical Fluid docs URL", () => {
    assert.deepEqual(normalizeAdvertisedUrl("https://docs.fluid.app/api/public/forms"), {
      route: "api/public/forms",
    });
  });

  it("rejects a different origin, query, fragment, trailing slash, and encoded path", () => {
    for (const url of [
      "http://docs.fluid.app/api/public/forms",
      "https://example.com/api/public/forms",
      "https://docs.fluid.app/api/public/forms?source=header",
      "https://docs.fluid.app/api/public/forms#usage",
      "https://docs.fluid.app/api/public/forms/",
      "https://docs.fluid.app/api/public/%66orms",
      "https://docs.fluid.app/api/public/%zzforms",
    ]) {
      assert.ok(normalizeAdvertisedUrl(url).error, url);
    }
  });
});

describe("collectNavigationPages", () => {
  it("collects string pages from nested navigation groups", () => {
    const pages = collectNavigationPages({
      tabs: [
        { groups: [{ pages: ["introduction", "migration/server-side-attribution"] }] },
        { groups: [{ pages: ["api/public/forms"] }] },
      ],
    });

    assert.deepEqual([...pages].sort(), [
      "api/public/forms",
      "introduction",
      "migration/server-side-attribution",
    ]);
  });
});

describe("validateAdvertisedLinks", () => {
  it("accepts unique advertised routes that are navigated and authored", async () => {
    const entries = [
      {
        url: "https://docs.fluid.app/api/public/forms",
        consumer: "Public forms sunset header",
      },
    ];

    const errors = await validateAdvertisedLinks(
      entries,
      new Set(["api/public/forms"]),
      async (route) => route === "api/public/forms",
    );

    assert.deepEqual(errors, []);
  });

  it("reports duplicate, unnavigated, and missing authored routes", async () => {
    const entries = [
      {
        url: "https://docs.fluid.app/api/public/forms",
        consumer: "First consumer",
      },
      {
        url: "https://docs.fluid.app/api/public/forms",
        consumer: "Second consumer",
      },
      {
        url: "https://docs.fluid.app/migration/server-side-attribution",
        consumer: "Third consumer",
      },
    ];

    const errors = await validateAdvertisedLinks(entries, new Set(), async () => false);

    assert.deepEqual(errors, [
      "entry 1: /api/public/forms is not registered in docs.json navigation",
      "entry 1: /api/public/forms has no authored .mdx or .md page",
      "entry 2: duplicate advertised route /api/public/forms",
      "entry 3: /migration/server-side-attribution is not registered in docs.json navigation",
      "entry 3: /migration/server-side-attribution has no authored .mdx or .md page",
    ]);
  });

  it("rejects an empty manifest and malformed entries", async () => {
    assert.deepEqual(await validateAdvertisedLinks([], new Set(), async () => true), [
      "advertised-docs-links.json must contain at least one entry",
    ]);

    assert.deepEqual(
      await validateAdvertisedLinks([{ url: 42 }], new Set(), async () => true),
      ["entry 1 must contain string url and consumer fields"],
    );
  });
});
