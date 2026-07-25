# Corrected row-level disposition ledger — Redocly → Mintlify (Phase 9.6, CURRENT-2711 / 9.6d)

**Purpose.** The Phase 9.6a census (CURRENT-2708, comment 1 of 3) published a 127-row master
disposition table and a tally. Later comments on 9.6a, 9.6b (CURRENT-2709), 9.6c (CURRENT-2710),
9.6c-1 (CURRENT-2724) and 9.6d (CURRENT-2711) changed several of those dispositions but **no
corrected roll-up was ever published**. This file is that roll-up: the authoritative final
disposition for all 127 authored Redocly pages, plus a reconciliation of every migrate / rewrite /
consolidate row against the published 9.6d branch.

**Sources of truth used (in precedence order where they conflict):**

| Tag | Source |
| --- | ------ |
| `9.6a-table` | CURRENT-2708 comment "overview + master disposition table" (2026-07-24T17:20:37Z) — the original 127 rows |
| `9.6a-corr` | CURRENT-2708 comment "CORRECTIONS to the census above" (2026-07-24T18:09:09Z) |
| `9.6b-ledger` | CURRENT-2709 comment "Phase 9.6b verification run" (2026-07-24T20:06:59Z) — the 60-claim verdict table |
| `9.6b-desc` | CURRENT-2709 description, "Resolved — the rep/CRM surface question is settled" |
| `9.6c-desc` | CURRENT-2710 description, "Resolved (2026-07-24) — CRM disposition final" |
| `9.6c-impl` | CURRENT-2710 comment "Phase 9.6c implementation record" (2026-07-24T21:29:18Z) |
| `9.6c1` | CURRENT-2724 description + QA comment (the 8 fast-path pages) |
| `9.6d` | CURRENT-2711 comment "Phase 9.6d implementation checkpoint" (2026-07-24T22:00:41Z) |
| `guide-truth` | `eval/guide-truth.md` §§ 9.6a / 9.6b / 9.6c / 9.6c.1 on the 9.6d branch — the durable record |
| `worktree` | Published 9.6d branch, commit `be7635c` ("Prepare Phase 9.6d closure checks"), inspected read-only |

Source paths are relative to `fluid/redoc/docs/`. Targets are Mintlify page slugs in
`mintlify-starter` (file = `<slug>.mdx`).

---

## Totals — corrected vs original

| Disposition | Original (9.6a) | **Corrected (final)** | Delta |
| ----------- | --------------: | --------------------: | ----: |
| migrate | 10 | **12** | +2 |
| rewrite | 14 | **13** | −1 |
| consolidate | 57 | **56** | −1 |
| defer | 19 | **11** | −8 |
| discard | 27 | **35** | +8 |
| **Total** | **127** | **127** | 0 |

**Deferred bucket after correction (11 rows):** #1 Web Builder component API · #8 DAM (`dam-v0`) ·
#10 drop zones · #11 + #12 `integrations-v0` / Global Embeds · #17 mobile widgets + `users v2025-06` ·
#31 mobile playlists · #35 themes-admin · #50 root-themes/marketplace · #90 upstream SDK type
contract (not a spec sync) · #120 `fairshare-public-v2025-06`.

The 7 CRM rows and `mobile-app/use-cases` left the deferred bucket entirely (they are false, not
unsynced), which is the single largest correction to the original tally.

**Not a disposition change but a material re-attribution:** the 13 `checkout-v2026-04` spec
attributions on rows #60–#85 are wrong. Every FairShare SDK REST call is `/api/public/v2025-06/*`
(30 paths) or `/api/v202506/carts/*` (13 gateway callbacks); the SDK has zero v2026-04 references
(`9.6a-corr` item 4, `9.6b-desc`, `guide-truth` §9.6a). Consequence: effectively **all ~57 SDK pages**
sit on an unsynced surface, not one deferred page plus twelve gated ones. Their dispositions do **not**
change, because 9.6c published them at *SDK altitude* — method names, arguments, events and
client-side behavior only, with no endpoint paths or schemas. Verified in `worktree`: no published
`.mdx` contains `public/v2025-06` or `v202506`. Adoption of that spec is its own phase (9.6f /
CURRENT-2725).

---

## Change log — every row whose final state differs from `9.6a-table`

| Row | Source page | Original → Final | Reason | Evidence |
| --: | ----------- | ---------------- | ------ | -------- |
| 5 | `guides/custom-catch-ups-guide.md` | defer → **migrate** | `crm/v202506` never existed, so the original deferral dependency is void. This page is the one CRM exception: its `/api/company/custom_catch_ups` URLs, auth, route and controller are verbatim correct and documented in `company-v0.yaml`. Must **not** be labelled legacy. Publication is gated on syncing `company-v0`, and the requested `GET /{id}` must not be documented (no controller action). | `9.6c-desc`; `9.6b-desc`; `9.6c-impl` ("remains blocked until `company-v0` is synced"); `guide-truth`:702 |
| 24 | `guides/mobile-app/activities.md` | defer → **discard** | `crm/v202506` is in no OpenAPI document and no Rails route; `git log -S'crm/v202506' --all` is empty — the string first appears in the docs commit that created these pages. Of 62 endpoint rows across the six resource pages, **zero** are correct as written. Not sync-unblockable. | `9.6b-desc`; `9.6c-desc`; `9.6a-corr` item 5 |
| 25 | `guides/mobile-app/catch-ups.md` | defer → **discard** | same as #24 (all catch-up writes have no route at any path) | `9.6b-desc`; `9.6c-desc` |
| 26 | `guides/mobile-app/contacts.md` | defer → **discard** | same as #24 | `9.6b-desc`; `9.6c-desc` |
| 27 | `guides/mobile-app/events.md` | defer → **discard** | same as #24 (user-scoped event writes have no route) | `9.6b-desc`; `9.6c-desc` |
| 29 | `guides/mobile-app/notes.md` | defer → **discard** | same as #24 (all company-scoped notes have no route) | `9.6b-desc`; `9.6c-desc` |
| 30 | `guides/mobile-app/overview.md` | defer → **discard** | same as #24 | `9.6b-desc`; `9.6c-desc` |
| 32 | `guides/mobile-app/tasks.md` | defer → **discard** | same as #24 (all company-scoped tasks have no route) | `9.6b-desc`; `9.6c-desc` |
| 33 | `guides/mobile-app/use-cases.md` | defer → **discard** | Docs-owner decision: discard with the eight mobile-app pages. It asserts no URLs, so both sources add "may migrate as a concept page if its narrative has value" — an option, not a commitment. **AMBIGUOUS — see A3.** | `9.6b-desc`; `9.6c-desc` |
| 63 | `sdk/fairshare/cart/cart-operation-events.md` | rewrite (HARD BLOCKER) → **migrate** | The 9.6a "DOC-AHEAD-OF-CODE" blocker was a **false negative** from verifying against a local `fluid-fairshare` checkout 24 commits / 5 days behind `origin/main`. The API is live in production (`configureCartFeedback`, `withButtonLoading`, `setButtonLoading`, `CART_OPERATION_SUCCESS/_ERROR`, all 13 `data-fluid-toast-*` attributes present in the shipped CDN bundle; landed 2026-07-13, PRs #501/#510/#514/#516). Explicit new disposition: "rows #37 and #63: MIGRATE with one targeted correction, not blocked." Delivered as content in two pages. **AMBIGUOUS label — see A4.** | `9.6a-corr` RETRACTED item 1; `9.6b-ledger` claim 21; `guide-truth`:588-595 |
| 90 | `sdk/fairshare/components/getAuthenticatedUser.md` | consolidate → **defer** | Claim 41 verdict is *deferred*: `FluidCore` writes the user with object storage but reads it through the string storage API, so neither an object-return nor a serialized-return contract may be published until the SDK implementation and its types agree. The published object example was removed and the method is now absent from every published page (verified in `worktree`). Dependency is an **upstream SDK/type fix**, not a spec sync. **Judgement call — see A5.** | `9.6b-ledger` claim 41; `guide-truth`:630-632; `worktree` (zero `.mdx` hits for `getAuthenticatedUser`) |

### State changes that do not move the tally (recorded for completeness)

| Row | Source page | Disposition | What changed |
| --: | ----------- | ----------- | ------------ |
| 37 | `themes/cart-feedback.md` | migrate (unchanged) | The 9.6a hard blocker on this row was retracted for the same reason as #63; additionally the source is wrong in 8 places — the button spinner has been **on by default** since `web-widgets` 0.16.0, so `data-fluid-button-loading` is a kill switch (`!== "false"`), not an enable switch. Fixed on migration. Shipped in 9.6c-1. (`9.6a-corr`; `9.6c1`; `9.6b-ledger` claim 21) |
| 56 | `sdk/files-sdk.md` | migrate (unchanged) | 9.6c did not ship it — 9.6d calls it "previously unaccounted". Migrated on the 9.6d branch as `sdk/files-sdk.mdx` + nav, with unsynced DAM endpoint contracts deliberately omitted. (`9.6d`) |
| 46 | `themes/product-bundles.md` | rewrite (unchanged) | Field-shape correction: the synced storefront Product show response exposes `product.bundle_groups[]`; the legacy `product.product_bundle_groups[]` is absent. `mutually_exclusive_groups_selected` is absent from the synced checkout request schema and is deliberately omitted. Shipped in 9.6c-1. (`guide-truth`:713-725; `9.6c1` QA item 7) |
| 61 | `sdk/fairshare/cart/addCartItems.md` | consolidate (unchanged) | Target `sdk/cart-api` was missing `bundled_items` / `product_bundle_group_id`; added in 9.6c-1 with the TypeScript type-extension caveat. (`9.6c1`; `guide-truth`:726-731) |
| 51 | `themes/theme-variables.md` | consolidate (unchanged) | Target page was 127 lines against a 53 KB source (~2%) — the site's largest content gap. Expanded in 9.6c-1 and rebuilt **from runtime variable builders and Drops**, not from the checked-in legacy JSON catalog. (`9.6c1`; `9.6b-ledger` claim 19) |
| 2, 19 | `guides/authentication-guide.md`, `guides/payment-processing.md` | discard (unchanged) | Both were discarded as duplicates of `guides/authentication.mdx` / `guides/payment-processing.mdx` — **both target pages were deleted in `8fbc6e5`** and are live 404s. The discard stands on its own merits (token-mgmt claims sit on unsynced `tokens-v2025-06`; orchestration on unsynced `fluid_orchestration`), but the "already covered" rationale is falsified. **See A1.** (`9.6a-corr` item 6; `worktree`: neither file exists) |
| 4 | `guides/creating-and-using-droplets.md` | consolidate (unchanged) | Two 9.6b-corrected facts are **not applied** on the published target. **See A2.** |
| 16 | `guides/inventory-management.md` | discard (unchanged) | Rationale strengthened from "contradicts webhook model" to proven-false: neither `inventory.updated` nor `/webhooks/subscriptions` exists. (`9.6b-ledger` claim 50) |
| 34, 86 | `themes/affiliate-hydration.md`, `sdk/fairshare/components/affiliate-hydration.md` | migrate / rewrite (unchanged) | The two source pages were merged into one page, `themes/affiliate-hydration.mdx`. Five elements/attributes/sentinel are real; `rescanForSentinels()` does not exist and the published page correctly says so rather than documenting it. (`9.6b-ledger` claim 22; `guide-truth`:685, :675) |
| 48 | `themes/supported-paths.md` | migrate (unchanged) | Route corrected: the storefront cart route is `/cart`, not `/:credit/cart`. (`9.6b-ledger` claim 20) |
| 102 | `sdk/fairshare/components/playlist.md` | rewrite (unchanged) | Source's internal contradiction resolved in favour of `library.title` / `library_items` (not `playlist.name` / `playlist.media`). (`9.6b-ledger` claim 35) |
| 103 | `sdk/fairshare/components/setAuthentication.md` | consolidate (unchanged) | The 9.6a "SUSPECT" on the published `await setAuthentication(...)` was **retracted** — it is `async`, makes a network call, and throws, so `await` was right all along. (`9.6a-corr` RETRACTED item 2; `9.6b-ledger` claim 31) |
| 121, 91, 92 | `settings/updateLocaleSettings.md`, `components/getCountryCode.md`, `components/getLanguage.md` | consolidate (unchanged) | **Partial** claim deferral: storage precedence and partial-update semantics are published; the locale *fallback order* (IP geolocation, company default, alphabetical) is deferred to a backend owner and is not published. (`9.6b-ledger` claim 39) |
| 126 | `legal/terms.md` | discard (unchanged) | Claim 57 (entity/address text) is deferred to Legal, but the page itself stays out of scope. (`9.6b-ledger` claim 57) |
| 42, 77 | `themes/index.md`, `sdk/fairshare/cart/removeCartItemById.md` | discard / consolidate (unchanged) | Flagged in 9.6c-1 as needing **no content work — redirect only** (Phase 9.6e / CURRENT-2719). (`9.6c1`) |
| 45, 52 | `themes/paged-editor.md`, `themes/themes-cli.md` | discard / consolidate (unchanged) | Slugs renamed in migration: `paged-editor` → `page-editor`, `themes-cli` → `cli`. A path-preserving `/docs/*` redirect rule silently 404s both; `themes-cli` has a live `fluid-admin` consumer including a `#start-up-guide` anchor. (`9.6a-corr` SCOPE GAP; CURRENT-2719) |

---

## Reconciliation against the published 9.6d branch (`be7635c`)

Bar: for every row whose final disposition is migrate / rewrite / consolidate, the Mintlify target
file must exist in the worktree and (for new pages) appear in `docs.json` navigation.

**Rows in scope: 81** (12 migrate + 13 rewrite + 56 consolidate).

**Result: 80 of 81 targets present. 1 hard gap.**

| Gap | Row | Source | Target | Status |
| --- | --: | ------ | ------ | ------ |
| **G1** | 5 | `guides/custom-catch-ups-guide.md` | `guides/custom-catch-ups` (or equivalent) | **MISSING** — no such file in the worktree and no nav entry; `custom_catch_ups` appears in zero published `.mdx`. Final disposition is migrate, publication gated on syncing `company-v0`. This is the only eligible page with no published home. |

**Navigation integrity:** 41 `.mdx` files, 41 nav-matched — zero files missing from nav, zero nav
entries pointing at absent files. `docs.json` carries a `redirects` array with 9 entries (the 7
9.6c-1 theme pages + dual-case `addCartItems`); the remaining ~118 legacy URLs are Phase 9.6e work
and out of scope here.

**Soft findings — target exists, but the row's distinct content is not on it.** These are not file
gaps; they are consolidation-parity questions ("zero eligible unique workflows lost", CURRENT-2711
AC 2):

| # | Row | Finding |
| - | --: | ------- |
| S1 | 114 | `sdk/fairshare/events/trackCheckoutStartedSync.md` — disposition consolidate → `sdk/cart-api`. `trackCheckoutStarted` is published (`sdk/cart-api.mdx:356`, `sdk/components.mdx`) but the **awaitable `trackCheckoutStartedSync` variant appears nowhere** in any published page, and no 9.6b claim covers it. Either the distinction was deliberately dropped without a recorded parity note, or it is a genuine omission. |
| S2 | 4 | `guides/creating-droplets.mdx` still publishes the **flat** exchange response (`{authentication_token, webhook_verification_token, installation_id, shop}`, lines 113-120, 133-140) and `event: 'order_created'` (line 152). 9.6b verdicted both **corrected**: the response is nested under `droplet_installation` + `credentials` + `meta` (claim 44) and registration takes `{resource:"order", event:"created"}` with `order_created` derived (claim 45). `guide-truth`:652-654 says publish the exchange shape "only after its owning unsynced contract is adopted" — which explains not adding the nested shape, but not leaving the disproven flat one on a live page. `api/guides/webhooks.mdx` documents the same registration correctly, so the two published pages now disagree with each other. |
| S3 | 47 | `themes/schema-components.md` (182 KB source) shipped as a single 418-line page rather than the "likely split" 9.6c-1 planned. Reusable option groups are covered (`## Reuse option groups`). Recorded as an accepted-omission judgement, not a gap — the omission sweep explicitly accepted reference territory. |

**Positive checks (no action needed):**

- All 8 fast-path 9.6c-1 pages present and in nav: `themes/blocks-and-components`,
  `theme-variables` (332 lines, 11 per-template scopes — gap closed), `image-transformations`
  (ImageKit, not Filestack), `media-tag`, `cart-feedback` (kill-switch semantics + `withButtonLoading`
  + `configureCartFeedback`), `product-bundles`, `schema-components`, and `sdk/cart-api`
  (`bundled_items` + `product_bundle_group_id`).
- The 6 SDK cart drawer/settings rows (#66, #67, #72, #75, #78, #82) are covered under the corrected
  namespaced API (`cart.control.open|close|toggle`, `cart.settings.get|set|clear`) rather than the
  legacy bare method names — parity holds.
- Deferred content is correctly **absent**: `lookupAffiliate` (row #120) and `custom_catch_ups`
  (row #5) appear in zero published `.mdx`.
- No unsynced-surface leakage: zero published `.mdx` contains `public/v2025-06`, `v202506`, or
  `crm/v202506`.

---

## Ambiguous / conflicting rows — flagged, not resolved

| ID | Rows | Conflict |
| -- | ---- | -------- |
| **A1** | 2, 19 | Discarded as duplicates of `guides/authentication.mdx` and `guides/payment-processing.mdx`, both of which were **deleted in `8fbc6e5`**. `9.6a-corr` item 6 calls the census's "already covered" baseline stale for these topics and says `a2056ea` should be reopened because its premise ("no external links to preserve") is falsified. Unresolved question: is authentication/payment-routing guidance now *intentionally* uncovered, or does the corpus need a rewrite row? Neither issue answers it. Note `api/authentication.mdx` exists and covers API auth, which may or may not be the intended successor. |
| **A2** | 4 | `9.6b-ledger` claims 44 and 45 are verdicted "corrected", but the published `guides/creating-droplets.mdx` still carries both pre-correction shapes (see S2). Is that a deliberate boundary (don't publish an unsynced `integrations-v0` shape) or an unapplied correction? The two readings imply opposite actions: leave as-is vs. fix the live page. |
| **A3** | 33 | `mobile-app/use-cases.md`: both `9.6b-desc` and `9.6c-desc` say discard **or** migrate as a concept page with the dead `/docs/openapi/rep-v0` link removed and no endpoint tables. Recorded here as discard (the stated decision), but `guide-truth`:537 **still lists it as content gated on `integrations-v0`** — i.e. the durable record was not updated to match the discard. Three states in three places. |
| **A4** | 63 | `9.6a-corr` sets the disposition to **migrate**, which this ledger follows. But delivery was consolidation: the cart-operation-events content is published inside `sdk/cart-api.mdx` (`## Cart operation events`) and `themes/cart-feedback.mdx`, and `guide-truth`:691 describes the SDK cart-operation pages as "Consolidated into `sdk/cart-api.mdx`". Labelling it consolidate instead would make the totals migrate 11 / consolidate 57. The content is published either way; only the label is in doubt. |
| **A5** | 90 | Reclassified consolidate → defer on the strength of claim 41 plus the method's total absence from published pages. An alternative reading is that the *page* is still consolidated (the method exists and could be named at SDK altitude) and only its **return contract** is deferred — in which case this is an unclosed consolidation gap rather than a deferral, and the totals become consolidate 57 / defer 10. Needs a docs-owner call. |
| **A6** | 5 | Final disposition conflict on *timing*, not outcome: `9.6c-desc` says "**Migrate** as CURRENT content — not legacy", while `9.6c-impl` and `guide-truth`:702 say it "remains gated on syncing its owning `company-v0` contract". Both also disagree on `GET /{id}`: `9.6c-desc` says "add the undocumented `GET /{id}`", `9.6c-impl` says it "must not be documented because neither the source spec nor controller implements it" (the later, evidence-backed statement should win). Recorded as migrate-but-unpublished (G1). |
| **A7** | 114 | See S1 — no source states a disposition change, so the row stays consolidate, but its distinct workflow is unpublished and unaccounted for. |

**Out-of-scope caveat carried forward:** "zero eligible pages unaccounted for" is scoped to the 127
authored Markdown pages. The legacy Redocly site also served **37 `/docs/openapi/<spec>` reference
routes**, a `_spec/*` OpenAPI-JSON family, and a 20-link landing page — none censused.
`/docs/openapi/rep-v0` (10 inbound internal links) and `/docs/openapi/carts-v0` (8) are the corpus's
most-linked targets and have no Mintlify page (`9.6a-corr`; CURRENT-2707 amendment; CURRENT-2719).

---

## Full corrected ledger — 127 rows

Disposition in **bold** marks a row changed from `9.6a-table`.

### Guides (rows 1–33)

| # | Source page | Final disposition | Mintlify target | Notes |
| --: | ----------- | ----------------- | --------------- | ----- |
| 1 | `guides/adding-components-for-web-builder.md` | defer | — | Web Builder component API undefined ("TBD" in source) |
| 2 | `guides/authentication-guide.md` | discard | — | Original target `guides/authentication.mdx` deleted in `8fbc6e5`; token-mgmt claims sit on unsynced `tokens-v2025-06`. **A1** |
| 3 | `guides/build-shopping-cart.md` | discard | `guides/build-shopping-cart` (present) | Superseded by the synced-spec rewrite; legacy `/api/carts` not resynced |
| 4 | `guides/creating-and-using-droplets.md` | consolidate | `guides/creating-droplets` (present) | Core flow migrated; droplet extras gated on `integrations-v0`. Claims 44/45 unapplied on the live page — **S2 / A2** |
| 5 | `guides/custom-catch-ups-guide.md` | **migrate** (was defer) | *none yet* | Current, not legacy: `/api/company/custom_catch_ups`, Bearer company token, in `company-v0.yaml`. Gated on `company-v0` sync; keep the three action types, drop per-endpoint contract tables, fix fictional hosts, do **not** add `GET /{id}`. **G1 / A6** |
| 6 | `guides/dam-file-picker-guide.md` | discard | `guides/dam-picker` (present) | Internal fluid-admin FilePicker |
| 7 | `guides/dam-picker-sdk-guide.md` | discard | `guides/dam-picker` (present) | Duplicate |
| 8 | `guides/dam-upload-endpoints.md` | defer | — | `dam-v0` unsynced. Corrected limits when it ships: 200 MB images, 2 GB video (claim 53) |
| 9 | `guides/data-dashboard.md` | discard | — | Fictional endpoint |
| 10 | `guides/drop-zone-external-usage.md` | defer | — | Drop-zone/embed API unsynced |
| 11 | `guides/droplet-subscription-webhook-guide.md` | defer | — | `integrations-v0`; subscription-path drift resolved (claim 47) but surface still unsynced |
| 12 | `guides/google-analytics-droplet-guide.md` | defer | — | Global Embeds + `integrations-v0`. Direct-token install flow is valid for legacy/v1 (claim 46) |
| 13 | `guides/headless-commerce.md` | discard | `api/guides/headless-commerce` (present) | Legacy paths superseded |
| 14 | `guides/index.md` | discard | — | Nav only; `docs.json` owns it |
| 15 | `guides/international-support.md` | discard | — | Compliance content, out of API-doc scope |
| 16 | `guides/inventory-management.md` | discard | — | Proven false: no `inventory.updated`, no `/webhooks/subscriptions` (claim 50) |
| 17 | `guides/mobile-widget-implementation.md` | defer | — | Endpoints verified real (claim 56) but `mobile_widgets` + `users v2025-06` unsynced |
| 18 | `guides/mysite-theme-guide.md` | discard | — | Internal rake/filesystem ops |
| 19 | `guides/payment-processing.md` | discard | — | Original target `guides/payment-processing.mdx` deleted in `8fbc6e5`; `fluid_orchestration` unsynced (claims 54/55). **A1** |
| 20 | `guides/targeted-marketing.md` | discard | — | Legacy path, no real surface |
| 21 | `guides/the-fluid-api.md` | discard | `api/overview` (present) | Marketing intro, duplicate |
| 22 | `guides/themes.md` | rewrite | `themes/developer-guide` + `themes/image-transformations` (present) | De-drift Filestack → ImageKit |
| 23 | `guides/webhooks.md` | discard | `api/guides/webhooks` (present) | Drifted; envelope kept per claim 49 |
| 24 | `guides/mobile-app/activities.md` | **discard** (was defer) | — | `crm/v202506` never existed; 0/62 endpoint rows correct |
| 25 | `guides/mobile-app/catch-ups.md` | **discard** (was defer) | — | as #24; all catch-up writes have no route |
| 26 | `guides/mobile-app/contacts.md` | **discard** (was defer) | — | as #24 |
| 27 | `guides/mobile-app/events.md` | **discard** (was defer) | — | as #24; user-scoped event writes have no route |
| 28 | `guides/mobile-app/native-widgets.md` | discard | — | "Coming Soon" stub |
| 29 | `guides/mobile-app/notes.md` | **discard** (was defer) | — | as #24 |
| 30 | `guides/mobile-app/overview.md` | **discard** (was defer) | — | as #24 |
| 31 | `guides/mobile-app/playlists.md` | defer | — | Mobile playlist feature (thin SDK pointer); unchanged |
| 32 | `guides/mobile-app/tasks.md` | **discard** (was defer) | — | as #24 |
| 33 | `guides/mobile-app/use-cases.md` | **discard** (was defer) | — | Asserts no URLs; optional concept-page migration was offered, never committed. **A3** |

### Themes (rows 34–54)

| # | Source page | Final disposition | Mintlify target | Notes |
| --: | ----------- | ----------------- | --------------- | ----- |
| 34 | `themes/affiliate-hydration.md` | migrate | `themes/affiliate-hydration` (present) | Merged with #86; `rescanForSentinels()` documented as nonexistent; cart route `/cart` |
| 35 | `themes/api-reference.md` | defer | — | themes-admin API unsynced |
| 36 | `themes/BASE_THEME_CONFIGURATION.md` | consolidate | `themes/root-theme-configuration` (present) | Volatile per-theme token catalogs discarded |
| 37 | `themes/cart-feedback.md` | migrate | `themes/cart-feedback` (present) | 9.6a blocker retracted — API live in production. Spinner on by default; `data-fluid-button-loading` is a kill switch (8 source places fixed). Shipped 9.6c-1 |
| 38 | `themes/developer-guide.md` | consolidate | `themes/developer-guide` (present) | Custom layouts + corrected Theme History review/compare/publish added |
| 39 | `themes/FLUID_THEME_CONFIGURATION.md` | consolidate | `themes/root-theme-configuration` (present) | as #36 |
| 40 | `themes/github_integration.md` | migrate | `themes/github-integration` (present) | Shipped 9.6c |
| 41 | `themes/image-transformations.md` | migrate | `themes/image-transformations` (present) | Filestack → ImageKit de-drift verified (claim 26 → 9.6c-1 check 3). Shipped 9.6c-1 |
| 42 | `themes/index.md` | discard | — | Duplicate of overview + developer-guide; redirect-only (9.6e) |
| 43 | `themes/linked-css-variable-presets.md` | migrate | `themes/linked-css-variable-presets` (present) | `var(--token)` form + linked-before-literal precedence preserved (claim 28) |
| 44 | `themes/media-tag.md` | migrate | `themes/media-tag` (present) | Defaults verified (claim 27 → 9.6c-1 check 2). Shipped 9.6c-1 |
| 45 | `themes/paged-editor.md` | discard | `themes/page-editor` (present) | Duplicate; slug renamed — needs an explicit 9.6e redirect |
| 46 | `themes/product-bundles.md` | rewrite | `themes/product-bundles` (present) | Rails internals stripped; `product.bundle_groups[]` (not `product_bundle_groups[]`); `mutually_exclusive_groups_selected` omitted (absent from spec); claims registered against `storefront-v2026-04` with cross-spec checkout claims. Shipped 9.6c-1 |
| 47 | `themes/schema-components.md` | migrate | `themes/schema-components` (present) | Only implemented selector types migrated (claim 18); reusable option groups covered. Shipped as one page, not split — **S3** |
| 48 | `themes/supported-paths.md` | migrate | `themes/supported-paths` (present) | Table rebuilt from registered routes; `/cart` not `/:credit/cart` (claim 20) |
| 49 | `themes/template-types.md` | migrate | `themes/blocks-and-components` (present) | Shipped 9.6c-1; slug renamed → redirect exists |
| 50 | `themes/theme-marketplace.md` | defer | — | root-themes/marketplace API unsynced; review half likely discard even post-sync |
| 51 | `themes/theme-variables.md` | consolidate | `themes/theme-variables` (present) | Expanded from ~2% coverage to 332 lines / 11 per-template scopes; rebuilt from runtime builders + Drops, legacy JSON catalog not migrated (claim 19). Shipped 9.6c-1 |
| 52 | `themes/themes-cli.md` | consolidate | `themes/cli` (present) | Includes `fluid theme skills install` (`--dir`, `--force`, `.agents/skills` default; claim 29). Slug renamed — 9.6e redirect must carry the `#start-up-guide` anchor |
| 53 | `themes/themes.md` | consolidate | `themes/overview` + `themes/developer-guide` (present) | Embedded themes-admin API dump discarded (unsynced) |
| 54 | `themes/VOX_THEME_CONFIGURATION.md` | consolidate | `themes/root-theme-configuration` (present) | as #36 |

### SDK — cart and roots (rows 55–85)

Spec attribution for rows #60–#85 corrected from `checkout-v2026-04` to
`fairshare-public-v2025-06` / `/api/v202506/carts/*` (unsynced). Published at SDK altitude only —
no endpoint paths or schemas.

| # | Source page | Final disposition | Mintlify target | Notes |
| --: | ----------- | ----------------- | --------------- | ----- |
| 55 | `sdk/index.md` | discard | — | Stale hub: marks Files SDK "Coming Soon" though shipped; links banned `/docs/openapi/admin-v0` |
| 56 | `sdk/files-sdk.md` | migrate | `sdk/files-sdk` (present, in nav) | Shipped in **9.6d**, not 9.6c ("previously unaccounted"); unsynced DAM endpoint contracts omitted |
| 57 | `sdk/mobile-sdk.md` | discard | — | Placeholder |
| 58 | `sdk/fairshare/index.md` | consolidate | `sdk/overview` (present) | |
| 59 | `sdk/fairshare/installation.md` | consolidate | `sdk/installation` (present) | Canonical script URL `assets.fluid.app/scripts/fluid-sdk/latest/web-widgets/index.js` only (claim 40) |
| 60 | `sdk/fairshare/cart/index.md` | consolidate | `sdk/cart-api` (present) | |
| 61 | `sdk/fairshare/cart/addCartItems.md` | consolidate | `sdk/cart-api` (present) | `bundled_items` + `product_bundle_group_id` added in 9.6c-1 with the type-extension caveat |
| 62 | `sdk/fairshare/cart/addEnrollmentPack.md` | consolidate | `sdk/cart-api` (present) | SDK sends `bundle_selections`; nested `bundled_items` are a different payload level (claim 8) |
| 63 | `sdk/fairshare/cart/cart-operation-events.md` | **migrate** (was rewrite/blocked) | `sdk/cart-api` (§ Cart operation events) + `themes/cart-feedback` (present) | Blocker was a stale-checkout false negative. Six operations, `CART_OPERATION_SUCCESS/_ERROR`, detail fields and per-operation error contracts published. **A4** |
| 64 | `sdk/fairshare/cart/checkout.md` | consolidate | `sdk/cart-api` (present) | |
| 65 | `sdk/fairshare/cart/clearCart.md` | consolidate | `sdk/cart-api` (present) | Local client-state cleanup, no REST delete (claim 15) |
| 66 | `sdk/fairshare/cart/clearCartSettings.md` | consolidate | `sdk/cart-api` (present) | Published as `cart.settings.clear()` |
| 67 | `sdk/fairshare/cart/closeCart.md` | consolidate | `sdk/cart-api` (present) | Published as `cart.control.close()` |
| 68 | `sdk/fairshare/cart/createCart.md` | consolidate | `sdk/cart-api` (present) | |
| 69 | `sdk/fairshare/cart/decrementCartItem.md` | consolidate | `sdk/cart-api` (present) | |
| 70 | `sdk/fairshare/cart/getCart.md` | consolidate | `sdk/cart-api` (present) | `getCart()` fetches only; it does not update widgets (claim 23) |
| 71 | `sdk/fairshare/cart/getCartItemCount.md` | consolidate | `sdk/cart-api` (present) | |
| 72 | `sdk/fairshare/cart/getCartSettings.md` | consolidate | `sdk/cart-api` (present) | Published as `cart.settings.get()` |
| 73 | `sdk/fairshare/cart/getCheckoutUrl.md` | consolidate | `sdk/cart-api` (present) | |
| 74 | `sdk/fairshare/cart/getLocalCart.md` | consolidate | `sdk/cart-api` (present) | |
| 75 | `sdk/fairshare/cart/openCart.md` | consolidate | `sdk/cart-api` (present) | Published as `cart.control.open()` |
| 76 | `sdk/fairshare/cart/refreshCart.md` | consolidate | `sdk/cart-api` (present) | Updates all widgets; clears local state on 410 — do not generalize (claim 13) |
| 77 | `sdk/fairshare/cart/removeCartItemById.md` | consolidate | `sdk/cart-api` (present) | No content work needed — redirect only (9.6e) |
| 78 | `sdk/fairshare/cart/setCartSettings.md` | consolidate | `sdk/cart-api` (present) | Published as `cart.settings.set()`, page-scoped |
| 79 | `sdk/fairshare/cart/setCartToken.md` | consolidate | `sdk/cart-api` (present) | `?cart_token=` adoption, `history.replaceState`, realtime subscribe, single-flight; rejects a completed token **without** clearing (claims 13, 24) |
| 80 | `sdk/fairshare/cart/setOnCheckout.md` | consolidate | `sdk/cart-api` (present) | With `getOnCheckout()` |
| 81 | `sdk/fairshare/cart/subscribeCartItem.md` | consolidate | `sdk/cart-api` (present) | `subscription`, no `subscribe` alias (claim 5) |
| 82 | `sdk/fairshare/cart/toggleCart.md` | consolidate | `sdk/cart-api` (present) | Published as `cart.control.toggle()` |
| 83 | `sdk/fairshare/cart/unsubscribeCartItem.md` | consolidate | `sdk/cart-api` (present) | |
| 84 | `sdk/fairshare/cart/updateCartItems.md` | consolidate | `sdk/cart-api` (present) | |
| 85 | `sdk/fairshare/cart/updateCartItemVariant.md` | consolidate | `sdk/cart-api` (present) | Added in 9.6c |

### SDK — components / events / settings (rows 86–121)

| # | Source page | Final disposition | Mintlify target | Notes |
| --: | ----------- | ----------------- | --------------- | ----- |
| 86 | `sdk/fairshare/components/affiliate-hydration.md` | rewrite | `themes/affiliate-hydration` (present) | Merged with #34 rather than given its own SDK page |
| 87 | `sdk/fairshare/components/attribution.md` | consolidate | `sdk/overview` (present) | Stale `cdn.fluid.app/sdk/cdn.js` src not carried forward (claim 40) |
| 88 | `sdk/fairshare/components/captureLead.md` | rewrite | `sdk/components` + `sdk/cart-api` (present) | Data-loss fix: `{message?, contact:{name?,email?,phone?}}`; flat `{first_name,…}` silently dropped all contact data. No contact union is enforced |
| 89 | `sdk/fairshare/components/country.md` | consolidate | `sdk/cart-api` (present) | Index page; `getCountryCode()` published |
| 90 | `sdk/fairshare/components/getAuthenticatedUser.md` | **defer** (was consolidate) | — | Claim 41 deferred: SDK writes an object but reads via string storage. Neither return contract publishable until the SDK and its types agree. Absent from all published pages. Dependency is an upstream SDK fix. **A5** |
| 91 | `sdk/fairshare/components/getCountryCode.md` | consolidate | `sdk/cart-api` (present) | Fallback *order* deferred (claim 39) |
| 92 | `sdk/fairshare/components/getLanguage.md` | consolidate | `sdk/cart-api` (present) | as #91 |
| 93 | `sdk/fairshare/components/getLibrary.md` | consolidate | `sdk/components` (present) | Consumers read `response.library` (claim 34) |
| 94 | `sdk/fairshare/components/getMedia.md` | consolidate | `sdk/components` (present) | Consumers read `response.media` (claim 34) |
| 95 | `sdk/fairshare/components/language.md` | consolidate | `sdk/cart-api` (present) | Index page |
| 96 | `sdk/fairshare/components/lead-capture.md` | rewrite | `sdk/components` (present) | `contact-method` is `email|phone` (default `email`) — published `both` never existed; attribute table is explicitly a subset (claim 36) |
| 97 | `sdk/fairshare/components/media-cta-options.md` | rewrite | `sdk/media` (present) | CTA priority: embed attribute > media > playlist > default (claim 38) |
| 98 | `sdk/fairshare/components/media-event-listeners.md` | rewrite | `sdk/media` (present) | Six event names + lifecycle/payload hold (claim 37) |
| 99 | `sdk/fairshare/components/media.md` | rewrite | `sdk/components` + `sdk/media` (present) | `playlist-id`/`media-id`; `library-id` has no alias and is silently ignored; registered tag is `<fluid-media-widget>` |
| 100 | `sdk/fairshare/components/playlist-cta-options.md` | rewrite | `sdk/media` (present) | Merged with #97 |
| 101 | `sdk/fairshare/components/playlist-event-listeners.md` | rewrite | `sdk/media` (present) | Merged with #98 |
| 102 | `sdk/fairshare/components/playlist.md` | rewrite | `sdk/components` (present) | Source contradiction resolved to `library.title` / `library_items` (claim 35) |
| 103 | `sdk/fairshare/components/setAuthentication.md` | consolidate | `sdk/components` (present) | SUSPECT retracted — `async`, network call, throws; `await` is correct |
| 104 | `sdk/fairshare/components/user.md` | discard | — | Duplicate index |
| 105 | `sdk/fairshare/events/flushEvents.md` | consolidate | `sdk/cart-api` + `sdk/components` (present) | `sync` default `true` (claim 32) |
| 106 | `sdk/fairshare/events/flushEventsWithBeacon.md` | consolidate | `sdk/cart-api` + `sdk/components` (present) | |
| 107 | `sdk/fairshare/events/getAttribution.md` | consolidate | `sdk/cart-api` / `sdk/overview` (present) | |
| 108 | `sdk/fairshare/events/getSessionToken.md` | consolidate | `sdk/cart-api` + `sdk/components` (present) | All four documented failure causes hold (claim 33) |
| 109 | `sdk/fairshare/events/index.md` | discard | — | Nav only |
| 110 | `sdk/fairshare/events/initializeFairshare.md` | consolidate | `sdk/installation` (present) | `initializeFluid` = full SDK init; `initializeFairshare` = lower-level async tracking init (claim 30) |
| 111 | `sdk/fairshare/events/reset.md` | consolidate | `sdk/installation` (present) | |
| 112 | `sdk/fairshare/events/resetFairshare.md` | consolidate | `sdk/installation` (present) | |
| 113 | `sdk/fairshare/events/trackCheckoutStarted.md` | consolidate | `sdk/cart-api` (present) | |
| 114 | `sdk/fairshare/events/trackCheckoutStartedSync.md` | consolidate | `sdk/cart-api` (present) | **The sync/awaitable variant is not documented anywhere — S1 / A7** |
| 115 | `sdk/fairshare/events/trackFairshareEvent.md` | rewrite | `sdk/cart-api` + `sdk/components` (present) | `{eventName, data}`, returns `void`, only valid name `"CHECKOUT_STARTED"`; `{event, properties}` is a silent no-op |
| 116 | `sdk/fairshare/settings/fetchSettings.md` | consolidate | `sdk/cart-api` (§ Shop Settings) (present) | Settings schema corrected — no affiliate `share_guid` (claim 42) |
| 117 | `sdk/fairshare/settings/getOrFetchSettings.md` | consolidate | `sdk/cart-api` (present) | |
| 118 | `sdk/fairshare/settings/getSettings.md` | consolidate | `sdk/cart-api` (present) | Cache read |
| 119 | `sdk/fairshare/settings/index.md` | rewrite | `sdk/cart-api` (§ Shop Settings) (present) | Source bug (verbatim duplicated "Locale Updates Are Partial" section, ~140-177) not carried forward |
| 120 | `sdk/fairshare/settings/lookupAffiliate.md` | defer | — | `fairshare-public-v2025-06` unsynced. Corrected for when it ships: wrapped **POST**, five identifier forms, propagates not-found (claim 43). Correctly absent from published pages |
| 121 | `sdk/fairshare/settings/updateLocaleSettings.md` | consolidate | `sdk/cart-api` (present) | Partial-update semantics published; locale fallback order deferred (claim 39) |

### Supporting (rows 122–127)

| # | Source page | Final disposition | Mintlify target | Notes |
| --: | ----------- | ----------------- | --------------- | ----- |
| 122 | `about-us/getting-started.md` | discard | `quickstart` + `platform-overview` (present) | Website Editor onboarding, superseded |
| 123 | `about-us/index.md` | discard | `introduction` (present) | Marketing landing |
| 124 | `about-us/who-we-are.md` | discard | `introduction` / `concepts/we-commerce` (present) | Unverified promotional claims discarded (claim 60) |
| 125 | `legal/responsible-use.md` | discard | — | Legal, out of scope |
| 126 | `legal/terms.md` | discard | — | 2021, truncated; current entity/address text deferred to Legal (claim 57) |
| 127 | `changelog.md` | discard | — | Fictional Redocly "Warp API" template content (claim 58); a real release-notes page would be net-new |
