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
- Pagination is **cursor pagination**: request with `page[cursor]` / `page[limit]`; responses return `meta.pagination.next_cursor` / `meta.pagination.prev_cursor`. Cursors are opaque strings. The terms `page`, `per_page`, `offset`, and any totals-based pagination language are banned. Two exceptions, both narrow and both verified against the implementation rather than the spec:
  - The `webhooks-v0` surface — see the legacy-reference exception below.
  - Seven `checkout-v2026-04` list operations are genuinely offset-paginated in the Rails implementation, and their generated reference correctly says so: `list_customer_addresses`, `list_customer_payment_methods`, `list_customer_points`, `list_reps`, `get_store_drop_zones`, `list_subscriptions`, and `list_users`. Cursor pagination was available on the same base class these actions inherit and was deliberately not used, so this is the API's design, not drift — do not "fix" the spec, and do not describe these seven as cursor-paginated. Everything else on `checkout-v2026-04`, including `list_customer_orders`, remains cursor and is held to the rule above.

  Three details to preserve when documenting the seven:
  - Passing `page[cursor]` to any of them returns **422** with `errors: {page: ["must be an integer"]}`, not page 1. Request params are validated by a Dry schema before the query runs, so the cursor form fails loudly rather than being silently ignored. This is safe behaviour and worth stating so the question is not re-litigated.
  - Default page sizes differ per operation — 25 for subscriptions, 50 for users, 10 for customer payment methods. State the default per operation; there is no surface-wide default.
  - `list_customer_orders` is cursor-paginated but its response meta also emits `per_page`, `current_page`, and `total_pages` next to the cursors, and `current_page` is hardcoded to `1` upstream. Never present those three as working offset controls on that endpoint.
- Auth wording: "Bearer token" (`Authorization: Bearer <token>`). Integrator token types are company API tokens, partner tokens, and public (`pub-`) tokens.
- Banned legacy references in docs content: `company/v1`, `/api/v1/`, `v2025-06` / `v202506`. Single exception: partner/public token-management endpoints genuinely live at `/api/v2025-06/tokens/*` and may be documented as such until a newer surface ships. A second, narrower exception: the `webhooks-v0` surface is a genuine `v0` API (not legacy `v1`) whose list endpoints use offset `page` / `per_page` pagination; its auto-generated reference reflects the spec. This covers the synced reference only — hand-written prose must still use cursor-pagination language and must not introduce `page` / `per_page` / `offset` terms.

## Style preferences

- Use active voice and second person ("you")
- Keep sentences concise — one idea per sentence
- Use sentence case for headings
- Bold for UI elements: Click **Settings**
- Code formatting for file names, commands, paths, and code references

## Content boundaries

- The OpenAPI specs under `api-reference/` are generated, synced artifacts — `.github/synced-specs.json` is the control surface listing which specs sync (hourly from the source-of-truth repo; the spec wins on conflict). Never hand-edit them.
- Endpoint-level details (params, schemas, status codes) belong to the auto-generated Endpoints pages driven by the synced spec. Hand-written prose pages must not duplicate or restate per-endpoint contracts — that duplication is the drift problem this repo eliminated.
- No internal implementation names in published content: Rails class/module/gem names, internal service names, and code file paths stay out of docs. Evidence and audit-trail references belong in PRs and issues, not published pages.
- Every factual claim in a guide must be registered in `eval/guide-claims.json` and pass `eval/check-guide-claims.mjs` (see the Guide truth gate section).
- Examples must be realistic — real-looking slugs, names, and values. Never `"string"`, placeholder names, or auto-generated filler.
- No hand-written prose page in the nav may document legacy v1 endpoints or use offset-pagination language, except where it describes one of the operations named in the pagination exceptions above and says so explicitly. (The auto-generated `webhooks-v0` reference reflects that surface's genuine offset `page` / `per_page` pagination — see the webhooks exception above; this is not a legacy `v1` reference. The seven offset `checkout-v2026-04` list operations are likewise genuine, not legacy.)
