# Documentation project instructions

## Guide truth gate (read before editing `api/guides/` or `api-reference/`)

The task guides in `api/guides/*.mdx` are bound to a claims registry
(`eval/guide-claims.json`) enforced by a deterministic checker in CI
(`eval/check-guide-claims.mjs`). Editing a guide without updating the registry — or
vice versa — fails CI. Read `eval/guide-truth.md` first: it defines the claim
schema, the checker's semantics, the durable verification decisions (accepted
omissions, low-confidence claims, upstream spec gaps), and the adoption procedure
for new guides. The OpenAPI spec is synced hourly from a GCS mirror
(`.github/synced-specs.json` controls which specs); endpoint reference pages are
auto-generated from it. Do not store run reports or logs in the repo — post run
records on the relevant Linear issue and record durable decisions in
`eval/guide-truth.md`.

## About this project

- This is a documentation site built on [Mintlify](https://mintlify.com)
- Pages are MDX files with YAML frontmatter
- Configuration lives in `docs.json`
- Use the Mintlify MCP server, `https://mcp.mintlify.com`, to edit content and settings via MCP
- Use the Mintlify docs MCP server, `https://www.mintlify.com/docs/mcp`, to query information about using Mintlify via MCP

## Terminology

- The version label in prose and page titles is `v2026-04`; the URL path segment is the non-hyphenated `/api/v202604/...`. Never mix the two forms.
- Two surfaces, named consistently:
  - **Public storefront** — `/api/v202604/<resource>`, slug-addressed, no authentication.
  - **Company** — `/api/v202604/company/<resource>`, `:id`-addressed, requires a Bearer token.

  Public vs. company is expressed per operation, not by splitting the docs.
- Resources are plural kebab-case nouns (`enrollment-packs`). Actions are HTTP methods — never verbs in paths.
- Canonical storefront field vocabulary — use these exact names in prose and examples: `id`, `slug`, `title`, `description`, `image_url`, `canonical_url`, `images`, `active`, `status`, `publish_at`, `seo`, `metafields`, `countries`, `languages`.
- Pagination is **cursor pagination**: request with `page[cursor]` / `page[limit]`; responses return `meta.pagination.next_cursor` / `meta.pagination.prev_cursor`. Cursors are opaque strings. The terms `page`, `per_page`, `offset`, and any totals-based pagination language are banned.
- Auth wording: "Bearer token" (`Authorization: Bearer <token>`). Integrator token types are company API tokens, partner tokens, and public (`pub-`) tokens.
- Banned legacy references in docs content: `company/v1`, `/api/v1/`, `v2025-06` / `v202506`. Single exception: partner/public token-management endpoints genuinely live at `/api/v2025-06/tokens/*` and may be documented as such until a newer surface ships.

## Style preferences

- Use active voice and second person ("you")
- Keep sentences concise — one idea per sentence
- Use sentence case for headings
- Bold for UI elements: Click **Settings**
- Code formatting for file names, commands, paths, and code references

## Content boundaries

- `api-reference/storefront-v2026-04.yaml` is a generated, synced artifact (hourly sync from the source-of-truth repo; the spec wins on conflict). Never hand-edit it.
- Endpoint-level details (params, schemas, status codes) belong to the auto-generated Endpoints pages driven by the synced spec. Hand-written prose pages must not duplicate or restate per-endpoint contracts — that duplication is the drift problem this repo eliminated.
- No internal implementation names in published content: Rails class/module/gem names, internal service names, and code file paths stay out of docs. Evidence and audit-trail references belong in PRs and issues, not published pages.
- Every factual claim in a guide must be registered in `eval/guide-claims.json` and pass `eval/check-guide-claims.mjs` (see the Guide truth gate section).
- Examples must be realistic — real-looking slugs, names, and values. Never `"string"`, placeholder names, or auto-generated filler.
- No page in the nav may document legacy v1 endpoints or offset pagination.
