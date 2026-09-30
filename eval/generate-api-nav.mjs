#!/usr/bin/env node
// Rebuilds the API Reference sidebar in docs.json from the synced OpenAPI specs.
//
// The sidebar is organized into sections that mirror Fluid Admin (Storefront,
// Commerce, Checkout, ...) rather than one group per spec. The mapping lives in
// .github/api-reference-nav.json: ordered rules send each operation to a section
// and group, and the first matching rule wins. Because every page reference is
// derived from the specs on disk, a spec sync can never leave the sidebar
// pointing at an endpoint that no longer exists (Mintlify fails the build on
// one), and a new endpoint lands in its section without anyone editing
// docs.json. An operation no rule matches goes to the section its tag declares
// with x-fluid-section (Fluid's new-endpoint lint requires one); failing that, to
// "Unsorted endpoints", where it is
// reported as a warning, so it is visible but never blocks a sync.
//
// Only the generated groups of the API Reference tab are rewritten. The groups
// named in manualGroupsBefore / manualGroupsAfter, and every other tab, are left
// exactly as they are.
//
// Node >=20, zero repo dependencies. YAML is parsed by shelling out to the same
// version-pinned js-yaml CLI the claims checker uses.
//
// Usage:
//   node eval/generate-api-nav.mjs          rewrite docs.json
//   node eval/generate-api-nav.mjs --check  exit 1 if docs.json is out of date
//
// Warnings (unsorted endpoints) never affect the exit code.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CONFIG_PATH = ".github/api-reference-nav.json";
const MANIFEST_PATH = ".github/synced-api-references.json";
const DOCS_PATH = "docs.json";
const METHODS = ["get", "put", "post", "patch", "delete", "options", "head", "trace"];
export const UNSORTED_SECTION = "Unsorted endpoints";
// Mintlify writes each endpoint page to a file named after its URL slug. A slug
// past the filesystem's name limit fails the whole build (ENAMETOOLONG), so a
// summary long enough to produce one is left out and reported instead.
export const MAX_SLUG_LENGTH = 150;

// Public: List the operations in a parsed spec, in spec order.
//
// Returns [{ spec, path, method, tag, auth }], where auth is "required" when the
// operation (or the spec default) declares a non-empty security requirement with
// no anonymous alternative, and "none" otherwise.
export function collectOperations(specName, spec) {
  const ops = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of Object.keys(item)) {
      if (!METHODS.includes(method)) continue;
      const op = item[method];
      if (!op || typeof op !== "object") continue;
      const security = op.security ?? spec.security ?? [];
      const anonymous = security.length === 0 || security.some((s) => Object.keys(s).length === 0);
      ops.push({
        spec: specName,
        path,
        method,
        tag: (op.tags && op.tags[0]) || "",
        summary: op.summary ?? "",
        auth: anonymous ? "none" : "required",
      });
    }
  }
  return ops;
}

// Public: The URL slug Mintlify gives an operation's page: its first tag and its
// summary, lowercased, straight apostrophes dropped (Mintlify keeps curly ones),
// other runs collapsed to hyphens, under
// the spec's output directory when it has one.
export function pageSlug(op, config) {
  const slug = (s) =>
    s.toLowerCase().replace(/'/g, "").replace(/[^a-z0-9\u2019]+/g, "-").replace(/^-+|-+$/g, "");
  const dir = config.specs?.[op.spec]?.openapi?.directory;
  const prefix = dir ? dir.replace(/^api-reference\/?/, "") + "/" : "";
  return `${prefix}${slug(op.tag)}/${slug(op.summary)}`;
}

// Public: Whether a rule (or exclude entry) matches an operation.
export function matches(rule, op) {
  if (rule.spec !== op.spec) return false;
  if (rule.tag !== undefined && !new RegExp(rule.tag).test(op.tag)) return false;
  if (rule.path !== undefined && !new RegExp(rule.path).test(op.path)) return false;
  if (rule.method !== undefined && rule.method.toLowerCase() !== op.method) return false;
  if (rule.auth !== undefined && rule.auth !== op.auth) return false;
  return true;
}

// Internal: Throw when a rule names a section or group the config doesn't define.
function validateConfig(config) {
  const known = new Map(config.sections.map((s) => [s.section, new Set(s.groups)]));
  config.rules.forEach((rule, i) => {
    if (!rule.spec) throw new Error(`rule ${i}: missing spec`);
    const groups = known.get(rule.section);
    if (!groups) throw new Error(`rule ${i}: unknown section "${rule.section}"`);
    if (!groups.has(rule.group)) {
      throw new Error(`rule ${i}: group "${rule.group}" is not listed under section "${rule.section}"`);
    }
  });
}

// Internal: The sidebar node for one group's operations. Specs with an
// `openapi` setting (a custom output directory) must be referenced from a group
// that carries that setting, or their page URLs change. Such operations share
// the group's node when they are the only ones in it, and otherwise nest in a
// child group named by the spec's legacyGroup.
function groupNode(name, ops, config, sources) {
  const plain = [];
  const nested = new Map();
  for (const op of ops) {
    const ref = `${op.method.toUpperCase()} ${op.path}`;
    const specConfig = config.specs?.[op.spec];
    if (specConfig?.openapi) {
      if (!nested.has(op.spec)) nested.set(op.spec, []);
      nested.get(op.spec).push(ref);
    } else {
      plain.push(`${sources.get(op.spec)} ${ref}`);
    }
  }
  if (plain.length === 0 && nested.size === 1) {
    const [[spec, pages]] = [...nested.entries()];
    return { group: name, openapi: config.specs[spec].openapi, pages };
  }
  const pages = [...plain];
  for (const [spec, refs] of nested) {
    const specConfig = config.specs[spec];
    pages.push({ group: specConfig.legacyGroup ?? spec, openapi: specConfig.openapi, pages: refs });
  }
  return { group: name, pages };
}

// Internal: The docs section a spec's tag declares with x-fluid-section, when it
// names a section this config defines. Fluid's new-endpoint lint requires it on
// every tag a new endpoint uses, so new tags place themselves without a rule.
function sectionFromTag(doc, tag, buckets) {
  const declared = (doc.tags ?? []).find((t) => t.name === tag);
  const section = declared?.["x-fluid-section"];
  return section && buckets.has(section) ? section : null;
}

// Internal: A sidebar group name from a tag, for example "member-types" ->
// "Member types".
function humanize(tag) {
  const words = tag.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Public: Build the generated sections.
//
// specs - Array of { name, source, doc } in manifest order.
//
// Returns { sections, unsorted, excluded } where sections is the array of
// docs.json group nodes and unsorted lists the operations no rule matched.
export function buildNav(config, specs) {
  validateConfig(config);
  const sources = new Map(specs.map((s) => [s.name, s.source]));
  const buckets = new Map(config.sections.map((s) => [s.section, new Map(s.groups.map((g) => [g, []]))]));
  const unsorted = [];
  const collisions = [];
  const tooLong = [];
  const slugOwner = new Map();
  let excluded = 0;

  for (const { name, doc } of specs) {
    for (const op of collectOperations(name, doc)) {
      if ((config.exclude ?? []).some((e) => matches(e, op))) {
        excluded += 1;
        continue;
      }
      // Two operations with the same tag and summary would share one page URL,
      // and Mintlify fails the build on that. Keep the first, as the automatic
      // sidebar did, and report the rest so the spec summary gets fixed.
      const slug = pageSlug(op, config);
      if (slug.split("/").pop().length > MAX_SLUG_LENGTH) {
        tooLong.push({ op, slug });
        continue;
      }
      if (slugOwner.has(slug)) {
        collisions.push({ op, slug, keptBy: slugOwner.get(slug) });
        continue;
      }
      slugOwner.set(slug, op);
      const rule = config.rules.find((r) => matches(r, op));
      const fallback = rule ? null : sectionFromTag(doc, op.tag, buckets);
      if (rule) buckets.get(rule.section).get(rule.group).push(op);
      else if (fallback) {
        const groups = buckets.get(fallback);
        const group = humanize(op.tag);
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(op);
      } else unsorted.push(op);
    }
  }

  const sections = [];
  for (const section of config.sections) {
    const pages = [...(section.pages ?? [])];
    const nodes = new Map();
    for (const [group, ops] of buckets.get(section.section)) {
      if (ops.length > 0) nodes.set(group, groupNode(group, ops, config, sources));
    }
    // A section's `nest` map places one group inside another, for example
    // { "Product tags": "Products" }. The child goes into the parent's pages,
    // ahead of any legacy subgroup; if the parent has no endpoints, the child
    // stays top-level.
    const nest = section.nest ?? {};
    for (const [group, node] of nodes) {
      const parent = nest[group] && nodes.get(nest[group]);
      if (parent) {
        // Place it ahead of any legacy child group, so current resources come first.
        const legacyAt = parent.pages.findIndex((c) => typeof c === "object" && Object.values(config.specs ?? {}).some((sp) => sp.legacyGroup === c.group));
        if (legacyAt >= 0) parent.pages.splice(legacyAt, 0, node);
        else parent.pages.push(node);
      }
    }
    for (const [group, node] of nodes) {
      if (!(nest[group] && nodes.has(nest[group]))) pages.push(node);
    }
    if (pages.length > 0) sections.push({ group: section.section, pages });
  }

  if (unsorted.length > 0) {
    const bySpec = new Map();
    for (const op of unsorted) {
      if (!bySpec.has(op.spec)) bySpec.set(op.spec, []);
      bySpec.get(op.spec).push(op);
    }
    sections.push({
      group: UNSORTED_SECTION,
      pages: [...bySpec].map(([spec, ops]) => groupNode(spec, ops, config, sources)),
    });
  }

  return { sections, unsorted, excluded, collisions, tooLong };
}

// Public: Return a copy of docs with the API Reference tab's generated groups
// replaced. Manual groups keep their content and their before/after position.
export function applyToDocs(docs, config, sections) {
  const next = structuredClone(docs);
  const tab = next.navigation.tabs.find((t) => t.tab === config.tab);
  if (!tab) throw new Error(`docs.json has no "${config.tab}" tab`);
  const byName = new Map(tab.groups.map((g) => [g.group, g]));
  const pick = (names) =>
    names.map((n) => {
      if (!byName.has(n)) throw new Error(`manual group "${n}" not found in the "${config.tab}" tab`);
      return byName.get(n);
    });
  tab.groups = [...pick(config.manualGroupsBefore ?? []), ...sections, ...pick(config.manualGroupsAfter ?? [])];
  return next;
}

// Public: Count the endpoint references (not manual pages) under a list of nodes.
export function countRefs(nodes) {
  let n = 0;
  for (const node of nodes) {
    if (typeof node === "string") n += / \/[^ ]*$/.test(node) && /^(\S+\.ya?ml )?[A-Z]+ \//.test(node) ? 1 : 0;
    else if (node && Array.isArray(node.pages)) n += countRefs(node.pages);
  }
  return n;
}

function readJson(rel) {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
}

function loadSpec(rel) {
  const out = execFileSync("npx", ["-y", "js-yaml@4.1.0", join(ROOT, rel)], {
    encoding: "utf8",
    maxBuffer: 1 << 28,
    stdio: ["ignore", "pipe", "inherit"],
  });
  return JSON.parse(out);
}

function main(argv) {
  const check = argv.includes("--check");
  const config = readJson(CONFIG_PATH);
  const manifest = readJson(MANIFEST_PATH).filter((e) => e.format === undefined || e.format === "openapi");
  const specs = manifest.map((e) => ({ name: basename(e.path).replace(/\.ya?ml$/, ""), source: e.path, doc: loadSpec(e.path) }));

  const { sections, unsorted, excluded, collisions, tooLong } = buildNav(config, specs);
  const docsText = readFileSync(join(ROOT, DOCS_PATH), "utf8");
  const nextText = JSON.stringify(applyToDocs(JSON.parse(docsText), config, sections), null, 2) + "\n";

  for (const op of unsorted) {
    console.log(`::warning file=${CONFIG_PATH}::No rule places ${op.method.toUpperCase()} ${op.path} (${op.spec}, tag "${op.tag}") — it is listed under "${UNSORTED_SECTION}".`);
  }
  for (const { op } of tooLong) {
    console.log(`::warning file=${CONFIG_PATH}::${op.method.toUpperCase()} ${op.path} (${op.spec}) has a summary too long to become a page file name, so it is left out until the spec summary is shortened.`);
  }
  for (const { op, slug, keptBy } of collisions) {
    console.log(`::warning file=${CONFIG_PATH}::${op.method.toUpperCase()} ${op.path} (${op.spec}) has the same tag and summary as ${keptBy.method.toUpperCase()} ${keptBy.path} (${keptBy.spec}), so both would be /api-reference/${slug}. It is left out until its spec summary is made unique.`);
  }
  console.log(`API Reference nav: ${sections.length} sections, ${countRefs(sections)} endpoints, ${unsorted.length} unsorted, ${excluded} excluded by config, ${collisions.length} left out for duplicate URLs, ${tooLong.length} for overlong summaries.`);

  if (check) {
    if (nextText !== docsText) {
      console.log(`FAIL  ${DOCS_PATH} is out of date. Run: node eval/generate-api-nav.mjs`);
      process.exit(1);
    }
    console.log(`PASS  ${DOCS_PATH} matches the generated API Reference nav`);
    return;
  }
  if (nextText !== docsText) {
    writeFileSync(join(ROOT, DOCS_PATH), nextText);
    console.log(`Wrote ${DOCS_PATH}`);
  } else {
    console.log(`${DOCS_PATH} already up to date`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
