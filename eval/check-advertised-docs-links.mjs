#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DOCS_ORIGIN = "https://docs.fluid.app";

export function normalizeAdvertisedUrl(value) {
  let url;

  try {
    url = new URL(value);
  } catch {
    return { error: `invalid URL: ${value}` };
  }

  if (url.origin !== DOCS_ORIGIN) {
    return { error: `URL must use ${DOCS_ORIGIN}: ${value}` };
  }

  if (url.search || url.hash) {
    return { error: `URL must name a page without a query or fragment: ${value}` };
  }

  if (url.pathname === "/" || url.pathname.endsWith("/") || url.pathname.includes("//")) {
    return { error: `URL must use a canonical page path: ${value}` };
  }

  const route = url.pathname.slice(1);
  let decodedRoute;
  try {
    decodedRoute = decodeURIComponent(route);
  } catch {
    return { error: `URL path contains invalid percent encoding: ${value}` };
  }

  if (decodedRoute !== route) {
    return { error: `URL path must not use percent encoding: ${value}` };
  }

  return { route };
}

export function collectNavigationPages(value, pages = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectNavigationPages(item, pages);
    return pages;
  }

  if (!value || typeof value !== "object") return pages;

  for (const [key, child] of Object.entries(value)) {
    if (key === "pages" && Array.isArray(child)) {
      for (const page of child) {
        if (typeof page === "string") pages.add(page);
        else collectNavigationPages(page, pages);
      }
    } else {
      collectNavigationPages(child, pages);
    }
  }

  return pages;
}

export async function validateAdvertisedLinks(entries, navigationPages, pageExists) {
  const errors = [];
  const seen = new Set();

  if (!Array.isArray(entries) || entries.length === 0) {
    return ["advertised-docs-links.json must contain at least one entry"];
  }

  for (const [index, entry] of entries.entries()) {
    const label = `entry ${index + 1}`;

    if (!entry || typeof entry.url !== "string" || typeof entry.consumer !== "string") {
      errors.push(`${label} must contain string url and consumer fields`);
      continue;
    }

    const normalized = normalizeAdvertisedUrl(entry.url);
    if (normalized.error) {
      errors.push(`${label}: ${normalized.error}`);
      continue;
    }

    if (seen.has(normalized.route)) {
      errors.push(`${label}: duplicate advertised route /${normalized.route}`);
      continue;
    }
    seen.add(normalized.route);

    if (!navigationPages.has(normalized.route)) {
      errors.push(`${label}: /${normalized.route} is not registered in docs.json navigation`);
    }

    if (!(await pageExists(normalized.route))) {
      errors.push(`${label}: /${normalized.route} has no authored .mdx or .md page`);
    }
  }

  return errors;
}

async function authoredPageExists(route) {
  for (const extension of [".mdx", ".md"]) {
    try {
      await access(join(ROOT, `${route}${extension}`));
      return true;
    } catch {
      // Try the other supported authored-page extension.
    }
  }
  return false;
}

async function main() {
  const [manifestText, docsText] = await Promise.all([
    readFile(join(HERE, "advertised-docs-links.json"), "utf8"),
    readFile(join(ROOT, "docs.json"), "utf8"),
  ]);

  const entries = JSON.parse(manifestText);
  const docsConfig = JSON.parse(docsText);
  const navigationPages = collectNavigationPages(docsConfig.navigation);
  const errors = await validateAdvertisedLinks(entries, navigationPages, authoredPageExists);

  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`FAIL  ${error}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`PASS  ${entries.length} advertised docs URLs resolve to navigated authored pages\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`FAIL  ${error.message}\n`);
    process.exitCode = 1;
  });
}
