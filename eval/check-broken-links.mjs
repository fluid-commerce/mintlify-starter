#!/usr/bin/env node
// Runs the pinned mint CLI's `broken-links` check and fails on any broken internal
// link, anchor, snippet or docs.json redirect destination. The one exception is a
// link into a generated TypeDoc page: production serves those pages, but the CLI
// does not build them. Only links to symbols that exist in the synced TypeDoc
// artifacts are exempt, so a mistyped or renamed symbol still fails.
//
// With --external, it also checks external links. The CLI counts an external link
// as broken on a 404, a timeout or a network error, so CI runs that mode as a
// separate, non-gating report.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// Keep in step with the `mint@` pins in .github/workflows/validate.yml and
// .github/workflows/sync-generated-api-references.yml (a unit test checks this).
export const MINT_VERSION = "4.2.930";

// URL segments Mintlify uses for TypeDoc reflection kinds.
const TYPEDOC_KIND_DIRS = ["classes", "enums", "functions", "interfaces", "types", "variables"];

// Returns the set of generated TypeDoc page paths, one per top-level symbol, for
// every docs.json navigation group that declares an `sdk` of format `typedoc`.
export function typedocPages(docsConfig, readArtifact) {
  const pages = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    if (node.sdk?.format === "typedoc" && node.sdk.source && node.sdk.directory) {
      const artifact = readArtifact(node.sdk.source);
      for (const child of artifact.children ?? []) {
        for (const kindDir of TYPEDOC_KIND_DIRS) {
          pages.add(`/${node.sdk.directory}/${kindDir}/${child.name}`);
        }
      }
    }
    Object.values(node).forEach(visit);
  };
  visit(docsConfig.navigation);
  return pages;
}

// Parses the CLI report. It prints a header line, then one group per file,
// separated by blank lines: the file path, then one `⎿` entry per broken link.
// Long entries wrap onto continuation lines at 80 columns. A redirect entry reads
// `source → destination`. Returns null if the output is not recognised, so a CLI
// format change fails loudly instead of passing.
export function parseBrokenLinks(raw) {
  const text = raw
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ");
  if (/no broken links found/.test(text)) return { total: 0, entries: [] };
  const head = text.match(/found (\d+) broken links? in (\d+) files?/);
  if (!head) return null;

  const body = text.slice(text.indexOf(head[0]) + head[0].length);
  const entries = [];
  for (const group of body.split(/\n\s*\n/)) {
    const lines = group.split("\n").filter((line) => line.trim());
    if (!lines.length || /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(lines[0].trim())) continue;
    const file = lines[0].trim();
    for (const line of lines.slice(1)) {
      const t = line.trim();
      if (t.startsWith("⎿")) entries.push({ file, target: t.slice(1).trim() });
      else if (entries.length && entries.at(-1).file === file) entries.at(-1).target += t;
      else return null;
    }
  }
  for (const entry of entries) entry.target = entry.target.replace(/\s*→\s*/, " → ");
  return { total: Number(head[1]), entries };
}

// For a redirect entry, the link that must resolve is the destination.
export function linkToResolve(target) {
  const parts = target.split(" → ");
  return parts[parts.length - 1];
}

export function classify(parsed, allowedPages = new Set()) {
  if (!parsed) return { ok: false, error: "could not parse mint broken-links output" };
  if (parsed.entries.length !== parsed.total) {
    return { ok: false, error: `parsed ${parsed.entries.length} of ${parsed.total} reported links` };
  }
  const broken = parsed.entries.filter((e) => !allowedPages.has(linkToResolve(e.target)));
  return { ok: broken.length === 0, broken, allowed: parsed.total - broken.length };
}

function main() {
  const external = process.argv.includes("--external");
  const flags = ["--check-redirects", "--check-anchors", "--check-snippets"];
  if (external) flags.push("--check-external");

  const docsConfig = JSON.parse(readFileSync(join(ROOT, "docs.json"), "utf8"));
  const allowed = typedocPages(docsConfig, (source) =>
    JSON.parse(readFileSync(join(ROOT, source), "utf8")),
  );

  const cmd = process.env.MINT_BIN ? [process.env.MINT_BIN] : ["npx", "--yes", `mint@${MINT_VERSION}`];
  const r = spawnSync(cmd[0], [...cmd.slice(1), "broken-links", ...flags], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, CI: "1", DO_NOT_TRACK: "1" },
    maxBuffer: 64 << 20,
  });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const result = r.error
    ? { ok: false, error: `could not run mint: ${r.error.message}` }
    : classify(parseBrokenLinks(output), allowed);
  if (result.error) {
    process.stderr.write(`${output}\nFAIL  ${result.error}\n`);
    process.exitCode = 1;
    return;
  }
  for (const e of result.broken) process.stderr.write(`FAIL  ${e.file}: ${e.target}\n`);
  const scope = external ? "internal and external" : "internal";
  process.stdout.write(
    `${result.ok ? "PASS" : "FAIL"}  ${scope} links: ${result.broken.length} broken; ` +
      `${result.allowed} links to generated TypeDoc pages allowed\n`,
  );
  if (!result.ok) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) main();
