import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  MINT_VERSION,
  classify,
  linkToResolve,
  parseBrokenLinks,
  typedocPages,
} from "./check-broken-links.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Shaped like real `mint broken-links` output: entries are indented with U+00A0,
// targets wrap at 80 columns, file groups are separated by blank lines, and a
// redirect entry reads `source → destination`.
const NBSP = " ";
const entry = (target) => `${NBSP}⎿${NBSP}${NBSP}${target}`;
const SAMPLE = [
  "found 5 broken links in 4 files",
  "",
  "platform-overview.mdx",
  entry("/nope-two-with-a-long-path/that-wraps-past-eighty-columns/for-sure/really-lo"),
  "ng-segment.json",
  entry("/portal-widgets/reference/widget-worker-sdk/interfaces/DeclarativeCapability"),
  "Use",
  "",
  "quickstart.mdx",
  entry("/nope-one"),
  entry("/portal-widgets/reference/widget-worker-sdk/interfaces/NotARealSymbolXyz"),
  "",
  "docs.json",
  entry("/portal-widgets/reference/widget-worker-sdk/x → /gone-destination"),
  "",
  "",
].join("\n");

const ALLOWED = new Set([
  "/portal-widgets/reference/widget-worker-sdk/interfaces/DeclarativeCapabilityUse",
]);

describe("parseBrokenLinks", () => {
  it("joins wrapped targets and attributes each to its file", () => {
    const parsed = parseBrokenLinks(SAMPLE);

    assert.equal(parsed.total, 5);
    assert.deepEqual(parsed.entries[0], {
      file: "platform-overview.mdx",
      target: "/nope-two-with-a-long-path/that-wraps-past-eighty-columns/for-sure/really-long-segment.json",
    });
    assert.equal(parsed.entries[1].file, "platform-overview.mdx");
    assert.equal(
      parsed.entries[1].target,
      "/portal-widgets/reference/widget-worker-sdk/interfaces/DeclarativeCapabilityUse",
    );
    assert.deepEqual(parsed.entries.at(-1), {
      file: "docs.json",
      target: "/portal-widgets/reference/widget-worker-sdk/x → /gone-destination",
    });
  });

  it("restores the spaces around a redirect arrow lost at a wrap", () => {
    const wrapped = ["found 1 broken link in 1 file", "", "docs.json", entry("/old-page →"), "/new-page"].join("\n");

    assert.equal(parseBrokenLinks(wrapped).entries[0].target, "/old-page → /new-page");
  });

  it("reports a clean run as zero entries", () => {
    assert.deepEqual(parseBrokenLinks("success no broken links found"), { total: 0, entries: [] });
  });

  it("returns null for output it does not recognise", () => {
    assert.equal(parseBrokenLinks("something else"), null);
  });
});

describe("classify", () => {
  it("allows only links to real generated TypeDoc symbols", () => {
    const result = classify(parseBrokenLinks(SAMPLE), ALLOWED);

    assert.equal(result.ok, false);
    assert.equal(result.allowed, 1);
    assert.deepEqual(
      result.broken.map((e) => e.target),
      [
        "/nope-two-with-a-long-path/that-wraps-past-eighty-columns/for-sure/really-long-segment.json",
        "/nope-one",
        "/portal-widgets/reference/widget-worker-sdk/interfaces/NotARealSymbolXyz",
        "/portal-widgets/reference/widget-worker-sdk/x → /gone-destination",
      ],
    );
  });

  it("checks a redirect's destination, not its source", () => {
    const ok = "/portal-widgets/reference/widget-worker-sdk/interfaces/DeclarativeCapabilityUse";

    assert.equal(linkToResolve(`/old → ${ok}`), ok);
    assert.equal(classify({ total: 1, entries: [{ file: "docs.json", target: `/old → ${ok}` }] }, ALLOWED).ok, true);
    assert.equal(classify({ total: 1, entries: [{ file: "docs.json", target: `${ok} → /gone` }] }, ALLOWED).ok, false);
  });

  it("fails closed when the parsed count differs from the reported count", () => {
    const result = classify({ total: 2, entries: [{ file: "a.mdx", target: "/b" }] });

    assert.equal(result.ok, false);
    assert.match(result.error, /parsed 1 of 2/);
  });

  it("fails closed on unrecognised output", () => {
    assert.equal(classify(parseBrokenLinks("something else")).ok, false);
  });

  it("passes a clean run", () => {
    assert.equal(classify(parseBrokenLinks("success no broken links found")).ok, true);
  });
});

describe("typedocPages", () => {
  it("lists a page per kind directory for each symbol of every TypeDoc group", () => {
    const docsConfig = {
      navigation: {
        tabs: [{ groups: [{ group: "Ref", sdk: { format: "typedoc", source: "a.json", directory: "ref/sdk" } }] }],
      },
    };
    const pages = typedocPages(docsConfig, () => ({ children: [{ name: "defineWidget" }] }));

    assert.ok(pages.has("/ref/sdk/functions/defineWidget"));
    assert.ok(pages.has("/ref/sdk/interfaces/defineWidget"));
    assert.ok(!pages.has("/ref/sdk/functions/defineWidgets"));
  });
});

describe("mint version pin", () => {
  it("matches every mint@ pin in the workflows", () => {
    for (const workflow of ["validate.yml", "sync-generated-api-references.yml"]) {
      const text = readFileSync(join(ROOT, ".github/workflows", workflow), "utf8");
      const pins = [...text.matchAll(/mint@([\w.-]+)/g)].map((m) => m[1]);

      assert.ok(pins.length > 0, `${workflow} pins no mint version`);
      assert.deepEqual([...new Set(pins)], [MINT_VERSION], workflow);
    }
  });
});
