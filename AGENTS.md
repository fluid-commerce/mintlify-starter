# Documentation project instructions

## Guide truth gate (read before editing `api/guides/`, `storefront/`, or `api-reference/`)

The guides listed in the registry's `guides` array — including `api/guides/*.mdx` and `storefront/*.mdx` — are bound to a claims registry
(`eval/guide-claims.json`) enforced by a deterministic checker in CI
(`eval/check-guide-claims.mjs`). Editing a guide without updating the registry — or
vice versa — fails CI. Read `eval/guide-truth.md` first: it defines the claim
schema, the checker's semantics, the durable verification decisions (accepted
omissions, low-confidence claims, upstream spec gaps), and the adoption procedure
for new guides. Generated API references are synced hourly from GCS mirrors
(`.github/synced-api-references.json` controls which artifacts); endpoint and SDK
reference pages are auto-generated from them. Do not store run reports or logs in the repo — post run
records on the relevant Linear issue and record durable decisions in
`eval/guide-truth.md`.

Before changing the spec sync configuration or investigating a sync failure,
read `eval/guide-truth.md` → **CI wiring** and **Resolving a conflict**.

## About this project

- This is a documentation site built on [Mintlify](https://mintlify.com)
- Pages are MDX files with YAML frontmatter
- Configuration lives in `docs.json`
- Use the Mintlify MCP server, `https://mcp.mintlify.com`, to edit content and settings via MCP
- Use the Mintlify docs MCP server, `https://www.mintlify.com/docs/mcp`, to query information about using Mintlify via MCP

## Where pages go

The site has four tabs. Grouping lives only in `docs.json`: a page's URL is its file path, so a restructure changes `docs.json` and never moves files. Every new page ships with its `docs.json` entry.

- **Help Center** (`help/**`): help for merchants, admins and reps. The guide-claims gate doesn't cover these pages, so check each one against the current admin UI (the fluid-admin code) before you publish it.
  - The URL mirrors the admin route: `admin.fluid.app/settings/taxes` → `help/admin/settings/taxes.mdx`. A screen without a stable route gets a short noun slug in its admin area, for example the page editor at `help/admin/page-editor`.
  - `sidebarTitle` is the screen's label in the admin, and groups follow the admin sidebar's order. Settings pages sit under **Company**, **Commerce**, **Payments** and **System**, in the Settings sidebar's order.
  - A section's hub page sits next to its folder (`help/admin.mdx`) and is listed first in its group. Never add an `index.mdx`.
  - Don't restate API contracts such as payloads, schemas or status codes. Link to the developer page instead.
  - Contact details come from `snippets/contact-support.mdx`: `import ContactSupport from "/snippets/contact-support.mdx"`, then `<ContactSupport />`. Never hard-code a support address.
  - Images go under `images/help/<area>/`. Never publish a screenshot that shows real customer data.
  - `introduction.mdx` is the site's landing page. It routes readers to each tab and sits first in the Help Center tab.
- **Developer Platform**: quickstart, concepts, guides, storefront guides (`storefront/**`), SDKs, and Portal & Widgets. Put a new page in the matching existing folder. Storefront guides are bound to the guide truth gate, like `api/guides/`.
- **Themes** (`themes/**`): storefront theme development, including the member storefront.
- **API Reference** (`api/**` and the generated `api-reference/**`): see the guide truth gate above.

**Pinned URLs.** Help Center pages that fluid-admin's in-app help buttons open are pinned in `eval/advertised-docs-links.json`. Each pin's `consumer` names the admin screen that links to it. CI fails if a pinned page moves or leaves the navigation. To move a pinned page, change the pin, add a redirect, and update the admin's link in the fluid monorepo at the same time.

**Agent skill file.** `skill.md` at the repo root replaces the file Mintlify would otherwise generate at `/skill.md` for AI tools. Keep it short, and list only commands and methods that appear in these docs. When you rename or remove one, update `skill.md` in the same PR.

## Terminology

- The version label in prose and page titles is `v2026-04`; the URL path segment is the non-hyphenated `/api/v202604/...`. Never mix the two forms.
- Two surfaces, named consistently:
  - **Public storefront** — `/api/v202604/<resource>`, slug-addressed, no authentication.
  - **Company** — `/api/v202604/company/<resource>`, `:id`-addressed, requires a Bearer token.

  Public vs. company is expressed per operation, not by splitting the docs.
- Resources are plural kebab-case nouns (`enrollment-packs`). Actions are HTTP methods — never verbs in paths.
- Canonical storefront field vocabulary — use these exact names in prose and examples: `id`, `slug`, `title`, `description`, `image_url`, `canonical_url`, `images`, `active`, `status`, `publish_at`, `seo`, `metafields`, `countries`, `languages`.
- Navigation means three different things. Say which one you mean:
  - **Website navigation menus**: the storefront's navigation bars, footers, and other site menus (`/api/menus`, Website > Navigation menus).
  - **Mobile app navigation**: the Fluid mobile app's navigation (`/api/v2/mobile_navigations`, Mobile app > Navigation).
  - **Portal navigation**: a portal definition's navigation, for `web` or `mobile` (Portal > Portal navigation).

  On website pages, "mobile" can also mean a small screen. Say "small screens" or "phone-sized layout" there, so it isn't read as the mobile app.
- Pagination is **cursor pagination**: request with `page[cursor]` / `page[limit]`; responses return `meta.pagination.next_cursor` / `meta.pagination.prev_cursor`. Cursors are opaque strings. The terms `page`, `per_page`, `offset`, and any totals-based pagination language are banned. Four exceptions, all narrow and verified against the implementation rather than the spec:
  - The `webhooks-v0` surface — see the legacy-reference exception below.
  - Seven `checkout-v2026-04` list operations are genuinely offset-paginated in the Rails implementation, and their generated reference correctly says so: `list_customer_addresses`, `list_customer_payment_methods`, `list_customer_points`, `list_reps`, `get_store_drop_zones`, `list_subscriptions`, and `list_users`. Cursor pagination was available on the same base class these actions inherit and was deliberately not used, so this is the API's design, not drift — do not "fix" the spec, and do not describe these seven as cursor-paginated. Everything else on `checkout-v2026-04`, including `list_customer_orders`, remains cursor and is held to the rule above.
  - The Public SDK Drop Zones operation `public_v2025_06_index_public_drop_zones`, generated only at `/api-reference/public-drop-zones/an-array-of-available-checkout-order-confirmation-and-cart-drop-zones-public`, genuinely uses offset `page` / `per_page` pagination. This exception applies only to that generated page. It does not sanction another Public SDK page or hand-written prose.

  - Two website and mobile app navigation list operations genuinely use offset `page` / `per_page` pagination, verified against the Rails implementation. Both exceptions apply only to their generated pages:
    - `content-v0` **List website navigation menus** (`GET /api/menus`), generated at `/api-reference/menus/list-website-navigation-menus`.
    - `mobile-v2` **List mobile app navigations** (`GET /api/v2/mobile_navigations`), generated at `/api-reference/mobile-navigations/list-mobile-app-navigations`. The controller paginates with `.page(page_param).per(records_per_page)`.

  Three details to preserve when documenting the seven:
  - Passing `page[cursor]` to any of them returns **422** with `errors: {page: ["must be an integer"]}`, not page 1. Request params are validated by a Dry schema before the query runs, so the cursor form fails loudly rather than being silently ignored. This is safe behaviour and worth stating so the question is not re-litigated.
  - Default page sizes differ per operation — 25 for subscriptions, 50 for users, 10 for customer payment methods. State the default per operation; there is no surface-wide default.
  - `list_customer_orders` is cursor-paginated but its response meta also emits `per_page`, `current_page`, and `total_pages` next to the cursors, and `current_page` is hardcoded to `1` upstream. Never present those three as working offset controls on that endpoint.
- The member API and genealogy use a newer version, `v2026-10`, with the version after the surface in the path: `/api/member/v2026-10/...` and `/api/company/v2026-10/genealogy/...`. Write both forms exactly as the path shows; don't convert them to the `/api/v202604/` style.
- Auth wording: "Bearer token" (`Authorization: Bearer <token>`). Integrator token types are company API tokens, partner tokens, public (`pub-`) tokens, and droplet installation (`dit_`) tokens.
- Legacy references in docs content (`company/v1`, `/api/v1/`, `v2025-06` / `v202506`): prefer the newer version of an operation wherever one exists, and when a page has to name both, say which to use. Document a legacy path only when no newer version covers it. The surfaces below are the known cases with no newer version, each tied to a named surface or an exact generated boundary and scoped explicitly — a case for one is not a licence for another:
  - **`/api/v2025-06/tokens/*`** — partner/public token-management endpoints genuinely live there and may be documented as such until a newer surface ships. Scoped to that path prefix on the admin/partner `api/v2025-06` surface (owned by `admin-v2025-06.yaml`, unsynced) and to nothing else. It says nothing about the unrelated `public/v2025-06` surface below.
  - **`webhooks-v0`** — a genuine `v0` API (not legacy `v1`) whose list endpoints use offset `page` / `per_page` pagination; its auto-generated reference reflects the spec. This covers the synced reference only — hand-written prose must still use cursor-pagination language and must not introduce `page` / `per_page` / `offset` terms.
  - **`public-v2025-06`** (`api-reference/public-v2025-06.yaml`, `info.title: Fluid Public SDK API`) — the REST surface behind the `@fluid-app` FairShare SDK. It genuinely lives at `/api/public/v2025-06/*` and may be documented as such until a successor ships: no `public-v2026-04` exists or is in flight, and the surface carries no sunset or deprecation middleware. The rule was wrong here, not the API. The ban read every `v2025-06` string as legacy drift, but this is the **only** spec the SDK registers — 49 files reference it on `fluid-fairshare` `origin/main`, a tree that contains **zero** `v2026-04` references in any form — and it is covered by 54 dedicated Rails integration tests. Document it as **SDK-internal: for a direct REST integration use `checkout-v2026-04`**, so publishing it never reads as an endorsement to build a new integration against `v2025-06`.

    Two scoping points, both load-bearing:
    - **This exception extends to hand-written prose, not only to the synced reference.** Unlike the `webhooks-v0` exception above, prose pages may name this surface, its version label, and its paths. An SDK page has to tell a reader which surface its cart methods call, and it cannot do that without saying `public-v2025-06`. Prefer a link to the generated reference over a hand-typed path — hand-typing invites the form being mistaken for a banned version — and keep per-endpoint contracts on the generated pages per Content boundaries below.
    - **The version label names the spec, not a path prefix.** 18 of its 67 paths sit outside `/api/public/v2025-06`: 12 `/api/v202506/carts/*` payment-gateway callbacks, three `/api/public/health*`, plus `/api/carts/{cart_token}/update_cart_items_prices`, `/api/public/drop_zones`, and `/api/public/leaderboards/countries`. So the exception covers **this spec's operations**, and covers `v202506` as well as `v2025-06`; scoping it to one literal prefix would be wrong.

    Do not conflate this with the tokens exception. `api/v2025-06` (admin/partner) and `public/v2025-06` (SDK) are different surfaces owned by different specs that happen to share a version label. This exception covers only the latter and widens nothing about the former.
  - **`admin-v2025-06` and `members-v2025-06` generated references** — Fluid's current admin API for resources with no newer version (promo codes, shipping methods, sitemap, points, price types, sales channels, API and partner tokens, member management, member types, and more). They are synced so those resources appear in the API reference. The exception covers the **generated reference pages only**: hand-written prose must not introduce `v2025-06` / `v202506` paths or labels beyond the tokens exception above; link to the generated page instead. The admin spec's operations that newer APIs supersede (the storefront resources, Lighthouse and compliance scans) and its rep-facing `users` API are excluded from the sidebar in `.github/api-reference-nav.json`.
  - **`messaging-v1` generated reference** — Fluid's messaging API genuinely lives at `/api/v1/messaging/*` (channels, messages, drafts, scheduled messages, recipients, bots) and has no newer version. It is synced so the Messaging section is complete. The exception covers the **generated reference pages only**, and only `/api/v1/messaging/*`; it is not an exception for any other `/api/v1/` path, and hand-written prose must not introduce `/api/v1/` paths — link to the generated page instead.
  - **Checkout's reciprocal generated-reference boundary** — `checkout-v2026-04`'s `info.description` correctly says that the FairShare SDK calls the Fluid Public SDK API (`public-v2025-06`). Permit only that exact sentence when the same generated operation page carries a contract line proving it comes from `api-reference/checkout-v2026-04.yaml` at an `/api/checkout/v2026-04/*` path. This is an occurrence-level exception, not a page or tag sanction: another `v2025-06` / `v202506` marker on the same Checkout page must still fail.

## Style preferences

- Use active voice and second person ("you")
- Keep sentences concise — one idea per sentence
- Use sentence case for headings
- Bold for UI elements: Click **Settings**
- Code formatting for file names, commands, paths, and code references

## Guided setup pages

Pages under `setup/` walk one configuration task end to end, and people, scripts, and agents all follow them. Start every new one from `templates/setup-guide.mdx` (ignored by Mintlify, never published) and add it to the **Guided setup** group in `docs.json` and to the cards on `setup/overview.mdx`.

- Keep the template's section order: **Before you start**, **Steps**, **What the status means**, **Troubleshooting**, **Use the API directly**.
- The frontmatter `setup` block must list the same steps, in the same order and with the same titles, as the `<Steps>` component. Each step names the CLI command it runs (`run`); mark steps that change live configuration with `changes: true`, and give a repeated step a `done_when`.
- Steps run published Fluid CLI plugin commands, which print JSON. Document a command only once its plugin version is published.
- A step that changes live configuration must say so and show `--yes`. Checks run once; never tell the reader to poll in a tight loop.
- **Use the API directly** links each operation to its generated reference page. It must not restate parameters or response schemas.
- A setup page asserts API facts, so it is registered in `eval/guide-claims.json` like any task guide, with a `guideSpecs` entry for its spec.

## Content boundaries

- The OpenAPI files under `api-reference/` and TypeDoc files under `sdk-artifacts/` are generated, synced artifacts — `.github/synced-api-references.json` is the control surface listing which references sync hourly from their source-of-truth mirrors. Never hand-edit them.
- Endpoint-level details (params, schemas, status codes) belong to the auto-generated Endpoints pages driven by the synced spec. Hand-written prose pages must not duplicate or restate per-endpoint contracts — that duplication is the drift problem this repo eliminated.
- No internal implementation names in published content: Rails class/module/gem names, internal service names, and code file paths stay out of docs. Evidence and audit-trail references belong in PRs and issues, not published pages.
- Every factual claim in a guide must be registered in `eval/guide-claims.json` and pass `eval/check-guide-claims.mjs` (see the Guide truth gate section).
- Examples must be realistic — real-looking slugs, names, and values. Never `"string"`, placeholder names, or auto-generated filler.
- No hand-written prose page in the nav may document legacy v1 endpoints or use offset-pagination language, except where it describes one of the operations named in the pagination exceptions above and says so explicitly. (The auto-generated `webhooks-v0` reference reflects that surface's genuine offset `page` / `per_page` pagination — see the webhooks exception above; this is not a legacy `v1` reference. The seven offset `checkout-v2026-04` list operations and the exact Public SDK Drop Zones generated page are likewise genuine, not legacy.)
