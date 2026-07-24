# Guide truth gate — claims registry + mechanical checker

Phase 3.5 of the trustworthy-API-docs bet (Linear CURRENT-2587). Task guides
(`api/guides/*.mdx`) assert facts about the API. The OpenAPI spec
(`api-reference/storefront-v2026-04.yaml`) is synced hourly from the backend, so a
spec change can silently contradict a published guide — the original drift problem,
one level up. This mechanism makes guide claims **inspectable** (a committed
registry), **mechanically enforceable** (a deterministic checker in CI), and
**semantically verified** (a one-off adversarial pass at authoring time).

## The pieces

| Piece | File | When it runs |
| ----- | ---- | ------------ |
| Claims registry | `eval/guide-claims.json` | Committed; updated whenever a guide changes |
| Mechanical checker | `eval/check-guide-claims.mjs` | CI: every PR/push (`validate.yml`) and every spec sync (`sync-openapi-spec.yml`) |
| Adversarial semantic verification | procedure below; run record posted on the phase's Linear issue | One-off at guide authoring/major-edit time (LLM; never in CI) |
| Reverse omission sweep | procedure below; durable decisions recorded in this doc | One-off at guide authoring/major-edit time |

Run records (verdict tables, transcripts) are **not** stored in the repo — they go on
the phase's Linear issue. Only *durable decisions* (accepted omissions, low-confidence
claims, known upstream gaps) live here, in the sections at the end of this doc.

## Claims registry — `eval/guide-claims.json`

Every factual statement in every covered guide is decomposed into **atomic, typed
claims**. Extraction is **blind**: the extractor reads only the guides, never the
spec, so the registry records what the guides *say*, not what the spec would make
convenient. Anchors into the spec (paths, methods, param names, field paths) are
derived from the guide text itself.

### Top-level shape

```jsonc
{
  "version": 1,
  "spec": "api-reference/storefront-v2026-04.yaml",  // default spec (see guideSpecs)
  "extraction": {
    "method": "blind — guides only, no spec access",
    "date": "YYYY-MM-DD"
  },
  "guides": ["api/guides/<file>.mdx", ...],
  "guideSpecs": {                                     // optional: per-guide spec overrides
    "api/guides/webhooks.mdx": "api-reference/webhooks-v0.yaml"
  },
  "claims": [ /* Claim objects, see below */ ]
}
```

**Specs are resolved per guide.** `spec` is the default every guide's mechanical
claims validate against. `guideSpecs` (optional) overrides it for individual guides:
a guide listed there validates against its own spec — the webhooks guide against
`api-reference/webhooks-v0.yaml`, while the storefront pilot guides stay on the
default. Guides not listed use `spec`. The checker loads each referenced spec once
(cached) and validates every claim against its guide's resolved spec in a single run,
so one registry spans multiple published surfaces. When `guideSpecs` is absent the
behavior is exactly the single-spec case. The `--spec` CLI flag overrides the
*default*; per-guide overrides in `guideSpecs` still apply on top of it.

### Claim object

```jsonc
{
  "id": "find-create-001",        // stable: <guide-prefix>-<zero-padded seq>
  "guide": "api/guides/find-and-create-categories-and-collections.mdx",
  "line": 22,                      // 1-based line the claim text starts on
  "quote": "returns a page of **live** categories only",
                                   // exact substring of the guide file (whitespace-
                                   // normalized match); keeps registry in sync with edits
  "type": "endpoint | auth | parameter | request-field | response-field | status-code | example | behavior | negative",
  "check": "mechanical | semantic",
  "claim": "One-sentence restatement of the asserted fact",
  "anchor": { /* type-specific, see below */ },
  "payload": { /* type=example only: the full JSON request body from the guide */ }
}
```

Guide prefixes: `find-create`, `rename-publish`, `country`, `hierarchy` (new guides
add their own).

### Anchor fields by type

All anchors that reference an operation carry `path` (templated, e.g.
`/api/v202604/company/categories/{id}`) and `method` (lowercase).

| type | anchor fields | mechanical meaning |
| ---- | ------------- | ------------------ |
| `endpoint` | `path`, `method`, `absent?` | Operation exists in the spec (or must NOT exist when `absent: true`) |
| `auth` | `path`, `method`, `auth: "none"\|"bearer"` | `none` → op has no security requirement (or empty); `bearer` → op requires a bearer/http scheme. Scope names (e.g. `storefront.update`) are **semantic** unless the spec models them |
| `parameter` | `path`, `method`, `param`, `in: "query"\|"path"`, `enum?`, `enum_exact?: bool`, `required?`, `absent?`, `default?`, `maximum?` | Param with that name+location exists on the op (path-level params included). `enum` asserts values (subset unless `enum_exact`); `default`/`maximum` compare against the param schema; `absent: true` asserts the op does NOT accept it |
| `request-field` | `path`, `method`, `field` (dot path from body root, e.g. `category.title`), `required?`, `required_exact?: [names]`, `type?`, `enum?`, `nullable?`, `absent?` | Field exists in the JSON request-body schema. `required_exact` (on a field pointing at an object) asserts the object's full `required` list. `absent: true` asserts the schema has no such field |
| `response-field` | `path`, `method`, `status` (e.g. `"200"`), `field` (dot path; `[]` for array items, e.g. `categories[].slug`), `absent?` | Field exists (or not) in the JSON response schema for that status |
| `status-code` | `path`, `method`, `status`, `absent?` | The response code is documented on the op. The *condition* under which it fires is a separate `behavior` claim |
| `example` | `path`, `method`, `allow_unknown?: bool` | `payload` validates against the op's request-body schema: types, `required`, `enum`, `nullable`; properties not present in the schema **fail** (phantom-field trap) unless the schema allows additional properties or `allow_unknown: true` |
| `behavior` | `path?`, `method?`, `topic` (short slug) | Semantic only — verified adversarially, skipped by the mechanical checker |
| `negative` | same as `behavior` | Semantic negative ("no scheduled unpublish exists"). Mechanical negatives (a param/field/endpoint that must not exist) instead use their structural type with `absent: true` |

Rules of thumb for `check`:

- **mechanical** — anything the spec YAML can settle deterministically: existence of
  ops/params/fields/codes, enums, required lists, types, defaults, maxima, example
  payload validity, absence of any of those.
- **semantic** — runtime behavior, cross-field semantics, filtering/visibility rules,
  slug lifecycle, timing ("resolves at read time"), and anything settled by spec
  *description prose* rather than schema structure.

## Mechanical checker — `eval/check-guide-claims.mjs`

Deterministic Node script, **no LLM**, no repo dependencies (YAML parsing via a
pinned `npx` one-shot). Exits `0` only when every check passes.

```bash
node eval/check-guide-claims.mjs                 # spec + claims from repo defaults
node eval/check-guide-claims.mjs --spec path/to/spec.yaml --claims path/to/claims.json
node eval/check-guide-claims.mjs --self-test     # embedded fixtures prove each failure class is caught
node eval/check-guide-claims.mjs --coverage-only # just the coverage lint (no spec needed)
```

What it validates:

1. **Registry hygiene** — required fields present, types/anchors well-formed, ids unique.
2. **Quote presence** — every claim's `quote` still appears in its guide file
   (whitespace-normalized). A guide edit that removes or rewords a claimed sentence
   fails CI until the registry is updated. Applies to semantic claims too.
3. **Mechanical claims** — validated against the spec per the table above, with
   internal `$ref` resolution and path-level parameter merging.
4. **Example payloads** — structural validation against the request-body schema
   (`type`, `required`, `enum`, `nullable`, arrays, nested objects; unknown
   properties fail unless allowed). Unsupported schema keywords produce a warning,
   never a silent pass.
5. **Coverage lint** — the reverse direction (see below): guide prose that names
   an API fact must have a covering claim.

Failure output names the claim id, guide file:line, and the reason, so the fix
(guide, registry, or spec) is obvious.

### Coverage lint

Quote presence binds *existing claims → guide text*. It cannot catch the reverse:
new guide prose that asserts an API fact **without** a claim. The coverage lint
closes that gap. It reads each guide in the registry's `guides` array directly and
fails when an API-shaped token has no covering claim, so a guide edit that adds an
endpoint, param, field, or status code can't ship without a registry entry.

**Tokens enforced** (per guide):

- **Endpoint paths** — any `/api/v202604/...` occurrence (trailing punctuation
  stripped; `{id}`/`{slug}` templates and concrete segments match interchangeably).
- **Query params** — backticked `filter[...]` / `page[...]`, plus backticked
  `sort`, `lang`, `q`.
- **snake_case identifiers** — backticked `^[a-z][a-z0-9_]*$` tokens that contain an
  underscore (`country_isos`, `publish_at`, …). Plain backticked words without an
  underscore (`title`, `slug`, `category`) are **not** enforced — too noisy.
- **Status codes** — backticked `200` `201` `202` `401` `403` `404` `422`.

**Coverage rule** — a token in guide *G* is covered when any claim with
`guide === G` (guide-scoped on purpose) either:

- names it in its anchor (`anchor.path` template-matches a path; `anchor.param`
  equals a param; any dot-segment of `anchor.field` equals a snake_case token;
  `anchor.status` equals a code), **or**
- contains it in the claim's `quote` (whole-token, whitespace-normalized), **or**
- owns the guide line it sits on — a line inside a claim's quote span, or inside a
  fenced code block that contains any claim's quote (a request/response example
  block's incidental sibling keys are not separate assertions).

**Skips**: YAML frontmatter; `import` / JSX-tag lines; anything an ignore comment
suppresses (below).

**Escape hatches** (MDX comments):

- `{/* truth-gate: ignore-next-line */}` — suppresses enforcement for the next line.
- `{/* truth-gate: ignore: <token> */}` — suppresses one token for the whole file.

**Honest limit**: the lint only sees *tokens*. Token-less behavioral prose ("resolves
at read time", "PATCH semantics") carries no enforceable token and still relies on
the authoring-time adversarial semantic pass — the lint does not claim to cover it.

## CI wiring

- **`validate.yml`** — on every PR and push to `main`, runs `mint validate`, the
  checker self-test, the eval-harness unit tests, and the checker itself
  (`node eval/check-guide-claims.mjs`). A PR that edits a guide without updating the
  registry (or vice versa) fails here — this is the hard gate for human-authored
  changes.
- **`sync-openapi-spec.yml`** — hourly, **manifest-driven** and **flow-and-flag**.
  `.github/synced-specs.json` is the control surface for *which* specs sync (each
  entry pulled from its mirror into its repo path); spec truth then flows to the
  docs/MCP unconditionally — **additions and removals both publish** on the sync,
  because the reference pages are *auto-generated* from the spec (docs.json points a
  navigation group at the spec with no explicit page list).
  - **Hard gate — `mint validate` (quarantine).** A broken spec would break the
    auto-generated build, so `mint validate` still gates. On failure the invalid
    spec is parked on the `spec-sync-blocked` branch behind a PR and the run exits
    non-zero; `main` and the hosted docs stay on the last-good spec. That PR is now
    strictly about build validation — guide-claim conflicts are no longer a reason
    for it.
  - **Flow.** Once the spec validates, it is committed and pushed to `main`
    **unconditionally**, whatever the claims outcome — the docs never fall behind
    the backend.
  - **Flag.** The checker then runs against the just-pushed spec as a *non-gating*
    step (the sync run itself exits `0`). On a conflict it opens — or comments on
    the existing open — a single labeled issue (`guide-spec-conflict`) carrying the
    failing `[FAIL]` lines. The spec is **not** rolled back.

  While a conflict is open, `main`'s CI is **deliberately red**: the same
  `validate.yml` run (above) fails on the synced commit because a published guide now
  contradicts the published reference. That red build, plus the issue, is the signal.

### Future: replacing the cron with Mintlify-native sync

Mintlify can consume an OpenAPI spec directly by URL and re-deploy on demand via its
trigger-deployment API (called from the backend's publish CI — the fluid repo's
`docs.yml`, right after the GCS upload). That would eliminate this cron and the
up-to-an-hour sync lag. We deliberately don't use it yet: a remote spec never lands
as a commit, so there is no diff to review, no hook to run the claims checker, no
`mint validate` gate, and no quarantine for a broken spec — every safety property
above lives in the committed mirror. Revisit when either (a) Mintlify adds a
pre-deploy validation hook, or (b) the claims check + validate move upstream into
the fluid repo's `docs.yml` so they gate the GCS upload itself. If lag alone becomes
the pain point, the cheaper fix is a `repository_dispatch` from `docs.yml` that
triggers this workflow immediately after upload — push-based freshness, all gates
intact.

Progress on (b): fluid#19972 adds an upstream `mint validate` gate to the GCS
upload itself — the fluid repo's `docs.yml` clones this repo, overlays each spec
listed in `.github/synced-specs.json`, and runs `mint validate` before `rsync`ing
to the mirror. Once that merges, a build-breaking spec should never reach the
mirror, and this workflow's validate quarantine becomes rare defense-in-depth
(it still guards docs.json edits and any other writer of the bucket). The claims
check stays downstream **by design**: backend PRs must not fail on docs prose —
guide conflicts are this repo's to reconcile, via flow-and-flag.

### Resolving a conflict

1. Open the `guide-spec-conflict` issue — it names each failing claim (`claim-id`,
   `guide:line`, reason) from the checker output.
2. Decide which side is right:
   - **Spec change is correct** → update the guide prose and the affected claims in
     `eval/guide-claims.json` (quotes, lines, anchors) in a PR.
   - **Spec change is an upstream mistake** → correct it in the backend; the next
     hourly sync republishes the fixed spec and heals `main`.
3. Merge the fix. `validate.yml` goes green on `main`; close the issue.

## Adversarial semantic verification (one-off, never in CI)

At authoring time (and after major guide edits), every `check: "semantic"` claim is
verified against the spec by refutation-prompted review:

1. Two independent verifiers each receive the claims and the spec, prompted to
   **refute** each claim from the spec text (not to confirm it). Verdicts:
   `CONFIRMED` (spec text supports it), `REFUTED` (spec contradicts it),
   `UNSUPPORTED` (spec is silent — the guide asserts something unverifiable).
2. Disagreements and flagged-subtle claims get a third targeted vote; majority
   holds, with citations required.
3. Guides (or the registry) are fixed until **zero REFUTED / UNSUPPORTED** remain.
4. Verdicts + citations are posted on the phase's Linear issue; claims that survive
   on a split vote get an entry under *Low-confidence claims* below.

## Reverse omission sweep (one-off, never in CI)

Claims verification catches what guides *say*; the sweep catches what they *hide*.
A spec-only reviewer (no guide access) lists reader-trapping facts per guide topic —
422 conditions, limits, lifecycle edge cases, param gotchas. The list is then
diffed against the guides; every finding is either fixed in the guide or explicitly
accepted — accepted findings are recorded (with rationale) under *Accepted omissions*
below so they are not re-litigated on the next sweep.

## Adopting the mechanism for new guides (Phases 5–9)

1. Author the guide as usual.
2. **Blind-extract** claims (no spec access; read only the new guide + this doc) and
   append them to `eval/guide-claims.json` with a new guide prefix; add the guide to
   the `guides` array.
3. Run `node eval/check-guide-claims.mjs` — fix guide or registry until green.
   Mechanical failures at this point are usually real guide errors: the whole point.
4. Run the adversarial semantic pass + omission sweep on the new guide; fix until
   zero REFUTED/UNSUPPORTED; post the run record on the phase's Linear issue and add
   any durable decisions to the sections below.
5. Commit guide + registry together. CI keeps them honest from then on.

Editing an existing guide: update the affected claims (quotes/lines/anchors) in the
same PR; the quote-presence check fails until you do. Semantic re-verification is
only needed when behavioral statements changed.

## Multi-spec guides (Phase 9 — `headless-commerce`)

`api/guides/headless-commerce.mdx` walks a flow that legitimately spans three
published surfaces: product listing (`storefront-v2026-04`), the cart→order
lifecycle (`checkout-v2026-04`), and card tokenization/3DS + wallets
(`payments-v2026-04`). The mechanical checker resolves **one** spec per guide, so
the guide is gated against `checkout-v2026-04` (its `guideSpecs` entry) and **all**
its mechanical claims anchor there. The storefront and payments touchpoints are
expressed as prose **cross-links** to their reference groups, deliberately
token-light so the coverage lint stays satisfied against the checkout spec — the
guide never emits a `/api/v202604/...` product path or a payments snake_case field
as an asserted fact. This preserves the one-spec-per-guide model with no
eval-harness change; if a future guide genuinely needs mechanical claims across
multiple specs, extend `guideSpecs` to accept an array and resolve each claim
against the spec that holds its anchor.

## Accepted omissions (deliberate — do not re-litigate without cause)

Facts the omission sweep surfaced that the guides intentionally do **not** cover:

| Omitted fact | Rationale |
| ------------ | --------- |
| Metafields `id` in CollectionWrite but not CategoryWrite | **Confirmed intentional backend asymmetry (CURRENT-2657)** — category write params (`categories/{create,update}_params.rb`) omit `id`; collection params include `optional(:id)`, so per-metafield update/destroy is a collection-only capability. The reference now documents both surfaces; guides still don't teach per-item metafield updates. Not a modeling bug — structural symmetry deliberately not forced (would document a field the category API silently strips). |
| Past `publish_at` + `status: scheduled` resolving published immediately | Implied by the read-time resolution rule the guides already state. |
| ISO-code validation, cycle/self-parent protection, `source_type` enum-validation | Spec is silent — nothing assertable without inventing behavior. |
| Envelope details (`seo` always present, nullable `meta.request_id`, 202 envelope quirks) | Outside the four topics' task flows. |
| Webhook delivery retrigger + a delivery-event history list | `webhooks-v0` exposes no retrigger endpoint and no delivery-event list — only most-recent-per-resource inspection via `GET /api/company/webhooks/resources/{resource_name}`. The old guide/source documented both, but they contradict the published surface; documenting them would mislead readers and fail mechanical endpoint claims. Adding them would be a backend spec addition, out of Phase 8 scope. |
| The empty/no-events-yet `404` on `GET /api/company/webhooks/resources/{resource_name}` | The controller has a latent bug: with a valid resource but no delivered events yet it crashes rather than returning a clean empty body. The guide documents only the invalid/unregistered-resource `404` (`{message, status}`), which is well-defined. Revisit if the backend fixes the empty case. |
| Webhooks per-endpoint 4xx matrix (PUT/DELETE/show/schema codes), the callback + company-event 4xx codes, `http_method` enum/defaults, and `deprecated_resources` | Endpoint-level contract detail belongs to the auto-generated reference driven by the spec, not the task guide (AGENTS.md content boundary). The guide covers only the codes its task flows hinge on (create `201`/`422`, delete `200`, resource-events `404`). |
| Webhooks list pagination (offset `page`/`per_page`, `per_page` max 100) | The `webhooks-v0` list endpoints genuinely use offset pagination; the auto-generated reference reflects it, but hand-written prose must not use offset-pagination language (AGENTS.md). The guide omits list pagination entirely rather than introduce banned terms. |
| Headless (`headless-commerce`): the anonymous cart-token / magic-link customer auth path (`/carts/{cart_token}/auth/*`, the `jwt` from `verify_cart_magic_link`) | The guide documents the **server-side company-token model** — one bearer token drives the whole flow. The customer-facing anonymous auth path is a separate integration model, out of this guide's task scope. |
| Headless: per-endpoint create-cart error detail — explicit-`null` dry-validation `422`, `400` on missing/blank `fluid_shop`, `404` on an unresolvable `fluid_shop` subdomain | The guide uses the well-defined `country_code`→`422` example for its one validation callout ("for example …", not a universal claim); the full 400/404/422 matrix belongs to the auto-generated reference (AGENTS.md content boundary). See upstream gap #8 for the 400/422 asymmetry. |
| Headless: `410` second trigger (enrollment carts in an authorized-payment state); `update_cart_country` cascade (clears address/discounts/shipping); points / manual-discount / enrollment ops; `shipping_method_id: null` clears the selection | Outside the linear product→cart→order task flow the guide teaches; reference territory. |

## Low-confidence claims (survived on a split vote)

- **`has_children` semantics** (hierarchy-010/-027/-030): **RESOLVED — upgraded to
  confident (CURRENT-2657).** The residual doubt (does `has_children` count *non-live*
  children on the live-only public catalog?) is now settled against the backend, the
  authoritative source: `Api::V202604::Categories::Browser.ids_with_children`
  (`app/services/api/v202604/categories/browser.rb`) resolves the flag with
  `Category.where(ancestry: …)` and **no visibility filter** — unlike the catalog
  scope, it does not restrict to `live?`. So `has_children` counts child categories in
  **any** lifecycle state: a live parent whose only children are draft/scheduled/
  archived still reports `true`. The spec `has_children` description now states this
  counting semantic authoritatively, so the three claims are re-verified with
  independent (code) evidence rather than resting on the guide. Claims stay
  `check: semantic` (a counting rule is behavioral, not settleable from schema
  structure); anchors unchanged.

## Known upstream spec gaps (flagged to the backend contract owners)

1. `custom_slug` structurally present in public response schemas while prose says
   it's omitted from the public surface (shared-schema modeling).
   **Resolved (CURRENT-2657)** — the shared read schema was split per surface for all
   seven resources that carry `custom_slug` (Category, Post, Product, Collection, Medium,
   Page, Playlist): a public base carries every field except `custom_slug` and is closed
   with `unevaluatedProperties: false` (so a company-only field leaking onto the public
   surface now fails conformance), while an authenticated variant composes the base with
   `custom_slug` via `allOf` and backs the company read responses. Confirmed against the
   backend: `custom_slug` is the only field in each blueprint's `view :authenticated`
   block, and public controllers render the default view (no `custom_slug`).
2. `has_children` and `position` have no field descriptions.
   **Resolved (9.5a)** — field descriptions were added to both on the `Category`
   schema. **Counting semantic also confirmed (CURRENT-2657)**: the `has_children`
   description now authoritatively states it counts children in any lifecycle state,
   verified against `Categories::Browser.ids_with_children` — this re-verifies and
   upgrades hierarchy-010/-027/-030 (see Low-confidence claims above, now resolved).
3. `filter[status]` stored-vs-resolved matching undefined for past-due scheduled rows.
   **Resolved (CURRENT-2657)** — confirmed against `Categories::Browser#apply_status_filter`
   (`where(status:)`): `filter[status]` matches the **stored** status column. A past-due
   `scheduled` row renders as `status: published` but is matched by `filter[status]=scheduled`,
   not `=published`. The spec param descriptions now state this.
4. Delete behavior undocumented (child cascade; category soft- vs collection hard-delete).
   **Resolved (CURRENT-2657)** — confirmed against the models/controllers: BOTH category
   and collection are **hard** delete (neither includes `Discard`); deleting a category
   **cascade-destroys its descendant categories** (`has_ancestry` orphan_strategy
   `:destroy`, runtime-verified), while filed products/media/pages are foreign-key
   **nullified**; collections have no child hierarchy. The earlier "category soft- vs
   collection hard-delete" framing was inaccurate (`archived` is a lifecycle state, not a
   delete) and is corrected. The destroy op descriptions now document this.
5. Metafields write asymmetry (CollectionWrite models `id`; CategoryWrite doesn't).
   **Confirmed intentional (CURRENT-2657)** — verified as real backend behavior (category
   write params omit `id`; collection params include `optional(:id)`), not a modeling bug.
   Both `metafields_attributes` descriptions were sharpened to state it; structural
   symmetry was deliberately **not** forced (adding `id` to `CategoryWrite` would document
   a field the category API silently strips). See Accepted omissions above.
6. `sort=position` offered on collections, which expose no `position` field.
   **Resolved (CURRENT-2657)** — the shared `Sort` parameter (which offers `position`)
   was swapped for `SortNoPosition` on both collection index ops (`storefrontCollectionsIndex`,
   `companyCollectionsIndex`); collections no longer advertise a `position` sort key.
7. Webhook **delivery/callback** contract is unmodeled in `webhooks-v0` (a
   management-API spec — it covers subscription management, not the outbound
   callback). The signed delivery headers (`X-Fluid-Signature`, a hex HMAC-SHA256
   over `"{X-Fluid-Timestamp}.{raw_body}"` keyed with the webhook's `auth_token`;
   plus `X-Fluid-Token`/`AUTH_TOKEN` carrying the raw token, and `X-Fluid-Shop`),
   the 2xx-to-acknowledge expectation, and delivery idempotency are runtime
   behaviors with no schema representation. The webhooks guide documents them,
   verified against backend code (`webhook.rb#request_headers`, `webhook_caller.rb`),
   carried as `check: semantic` claims (`webhooks-036`, `-037`, `-038`, `-039`) since
   the mechanical checker cannot settle them from this spec. The delivery *envelope*
   shape, by contrast, IS modeled (the resource-events endpoint returns it), so
   envelope claims are mechanical. A future OpenAPI 3.1 `webhooks:` block could model
   the callback contract; until then this stays code-verified.
   (Supersedes the earlier `x-auth-token` framing, which was incorrect — no such
   header exists.)
8. **Checkout cart auth model is internally inconsistent and the `security:` blocks are
   stale vs. the controllers** (`checkout-v2026-04`). Ground truth (Rails controllers):
   - `commerce/checkout/v202604/base_controller.rb` is secure-by-default
     (`before_action :authenticate_customer!`). Cart controllers OPT OUT with
     `skip_before_action :authenticate_customer!` and authorize by the **cart token in the
     path** instead; an optional bearer (`current_jwt`) only enriches behavior (wallet
     resolution for isolated-payment-token companies).
   - `carts/carts_controller.rb:11` skips auth for all cart ops EXCEPT `sync` and
     `volume_rep` (`carts_controller.rb:13`), which genuinely require a bearer.
   - `carts/auth_controller.rb:8`, `carts/items_controller.rb:8`,
     `carts/discount_controller.rb:10` (except `create_manual`),
     `carts/discounts_controller.rb:8`, `carts/points_controller.rb:8`,
     `enrollments_controller.rb:9`, `orders_controller.rb:7`, `products_controller.rb:7`
     all `skip_before_action :authenticate_customer!`.
   So the cart-mutation ops (`add_cart_items`, `update_cart_item`, `delete_cart_item`,
   `apply_cart_discount`, `remove_cart_discount`, `update_cart`, `update_cart_language`,
   `update_cart_metadata`, `recalculate_cart`, `complete_cart`, `update_cart_country`,
   `update_cart_address`, `update_cart_shipping`, points ops) AND the four cart-auth ops
   (`get_cart_auth_me`, `send_cart_magic_link`, `verify_cart_magic_link`,
   `destroy_cart_auth`) are all PUBLIC — yet the spec annotates them
   `security: [{ bearer_auth: [] }]`. (Correction to the prior framing: the cart-auth ops
   are NOT `security: []`; they carry `bearer_auth`.) The `skip_before_action` opt-outs
   were never mirrored into the per-op swagger annotations, which still reflect the base
   controller's secure-by-default posture.
   **Recommended fix (contract owners):** model the public cart ops (mutation + auth) as
   `security: [{}, { bearer_auth: [] }]` — an OPTIONAL bearer that matches the controllers
   (public, cart-token scoped, bearer-enriched) — NOT `security: []`. This also keeps the
   truth-gate green: the mechanical `auth: bearer` claim `headless-005`
   (`POST …/carts/{cart_token}/items`) still passes because `requiresBearer` is satisfied
   by the `bearer_auth` alternative, whereas `[]` would fail it. `sync`/`volume_rep` stay
   `[{ bearer_auth: [] }]` (genuinely required); add a `401` to the ops that require auth.
   **9.5b — DONE (docs side):** operation DESCRIPTIONS now state the real (public,
   cart-token-scoped) contract, correcting the earlier PR-#20043 prose that echoed the
   stale bearer declaration (Greptile review, verified against the controllers above). The
   `security:` shape change is deferred to the contract owners per the recommendation.
9. **`query_product` uses a legacy 404 error envelope** (`checkout-v2026-04`). Its
   `404` returns `{ status: "fail", data: { error } }` while every other error
   (including `query_product`'s own `422`) uses `ErrorResponse`
   (`{ error_message, errors, meta }`). A uniform error parser breaks on
   product-not-found.
   **9.5b — DOCUMENTED.** `query_product`'s description now calls out that its `404`
   returns the legacy `{ status: "fail", data: { error } }` shape while its `422` and
   every other operation use the standard `ErrorResponse`. Structural fix (aligning
   the envelope) is a spec-behavior change, out of scope; still flagged upstream.
10. **`payment_uuid` provenance spans specs.** `complete_cart` consumes a
    `payment_uuid` query param, but the tokenize/authorize step and the
    `requires_3ds` branch that produce it live in `payments-v2026-04`, not
    `checkout-v2026-04`. The headless guide bridges the gap with a cross-link to the
    Cart payment reference; a reader working only from the checkout spec cannot find
    where `payment_uuid` comes from.
    **9.5b — DOCUMENTED on both surfaces.** In `payments-v2026-04`, the tokenize and
    verify (`requires_3ds`) operations and the PayPal-order `payment_uuid` response
    field now describe it as the server-produced Fluid payment reference carried into
    checkout. In `checkout-v2026-04`, `complete_cart` now states the `payment_uuid` it
    consumes is produced upstream by the Cart payment surface and cross-references it.
    (No `payment_uuid`-named field is invented on the card-flow response — none is
    modeled there; that opacity is the remaining upstream gap.)
11. **`fluid_shop` example format is inconsistent** across checkout ops (`acme`
    subdomain in `create_cart`/`send_magic_link` vs `acme.fluid.app` full host in
    `query_product`'s `metadata.fluid_shop`). The headless guide matches each op's
    own example rather than inventing a single convention.
    **9.5b — DOCUMENTED (per-op).** Each operation's `fluid_shop` is now described in
    its own terms — subdomain form in `create_cart`/`send_magic_link`, full-host form
    in `query_product`'s `metadata.fluid_shop` — rather than unifying the convention.
    Unifying is a spec-behavior change, out of scope; still flagged upstream.

## Phase 9.5b — remaining-specs description enrichment (CURRENT-2635)

Applied the 9.5a description bar to the six remaining synced specs
(`.github/synced-specs.json`, excluding storefront). Spec edits land in `fluid`
(`docs/openapi/*.yaml`); this repo records the durable decisions and the truth-gate
result. All changes were **additive** (descriptions + named examples only) — a
structural diff vs `master` confirmed identical paths, methods, security, status
codes, params, and request/response/component schemas on every spec, so Skooma
`:strict` and the mechanical claims are unaffected. The guide-claims gate was re-run
against the enriched specs: **PASS** (351 claims, 234 mechanical, 0 failures,
0 coverage failures), including the two registry-gated surfaces (`webhooks-v0`,
49 claims; `checkout-v2026-04`/headless, 44 claims).

Per-spec description coverage (before → after):

| Spec | operations | parameter defs | schema properties |
| ---- | ---------- | -------------- | ----------------- |
| `auth-v0` | 28/28 → 28/28 (100%) | 7/13 → 13/13 (100%) | 2/65 → 65/65 (100%) |
| `commerce-v2026-04` | 2/2 → 2/2 (100%) | 2/2 → 2/2 (100%) | 31/69 → 69/69 (100%) |
| `webhooks-v0` | 8/24 → 24/24 (100%) | 8/17 → 17/17 (100%) | 8/161 → 57/161 (35%) |
| `payment-v2026-04` | 2/15 → 15/15 (100%) | 12/12 → 12/12 (100%) | 55/155 → 101/155 (65%) |
| `payments-v2026-04` | 6/12 → 12/12 (100%) | 14/14 → 14/14 (100%) | 10/65 → 46/65 (71%) |
| `checkout-v2026-04` | 28/73 → 73/73 (100%) | 141/141 → 141/141 (100%) | 98/2437 → 220/2437 (9%) |

100% operation + parameter description coverage on every surface; property coverage
was prioritized on guide-explained and core integration fields (giant checkout
sub-trees intentionally not exhausted). Named request examples were added to the
guide-walked operations on each surface.

### New contract-owner questions from 9.5b

- **Gap #8 correction (above):** the four `checkout-v2026-04` cart-auth/magic-link ops
  declare `bearer_auth`, not `security: []` as the original gap #8 stated. Descriptions
  reflect the actual declared auth; whether those ops *should* be public is an
  unresolved spec-behavior question for contract owners.
- **`payment-processing.mdx` maps to a different surface.** The `guides/payment-processing.mdx`
  guide documents the Fluid Orchestration routing API (`/api/fluid_orchestration/...`,
  bearer-authed), **not** the `payment-v2026-04` gateway spec or the `payments-v2026-04`
  cart-payment spec. Enrichment of those two specs was therefore driven by the specs'
  own structure, the cart/checkout guides, and (for `commerce-v2026-04` totals) the
  backend recalculator — never by importing orchestration-guide facts. Worth confirming
  the intended guide↔surface mapping when guides are slimmed in 9.5e.

## Phase 9.6a — Redocly census dispositions (CURRENT-2708)

Census of the legacy Redocly corpus (`fluid/redoc/docs/`, 127 authored `.md` pages) against the
synced OpenAPI specs, deciding what earns migration into Mintlify. Redocly prose was treated as
evidence to investigate, not truth to copy. Only **settled, structural** outcomes are recorded here;
the per-claim adversarial verification queue (contradictions still to resolve) lives on the phase's
Linear issue, not in this doc.

### Corpus and disposition tally (settled)

127 pages, independently counted (`find … -name '*.md' | wc -l`): guides 33, themes 21, SDK 67
(cart 31 + components/events/settings 36), supporting 6.

| Disposition | Count | Meaning |
| ----------- | ----- | ------- |
| migrate | 10 | verified, unique, API surface synced |
| rewrite | 14 | valuable workflow, prose drifted / violated house rules |
| consolidate | 57 | merge into an existing Mintlify page |
| defer | 19 | owning API surface not synced yet |
| discard | 27 | false / obsolete / duplicate / out-of-scope |

The 57 `consolidate` pages fold overwhelmingly into `sdk/cart-api.mdx`, `sdk/components.mdx`,
`sdk/installation.mdx`, and the theme root-configuration / developer-guide pages; the 10 `migrate`
pages are the confirmed unaudited theme gaps (image-transformations, media-tag,
linked-css-variable-presets, supported-paths, schema-components, blocks-and-components,
affiliate-hydration, cart-feedback, github-integration) plus `sdk/files-sdk`.

### Unsynced-surface deferral map (structural — verified by grep-absence in `api-reference/*.yaml`)

Synced set = `storefront-v2026-04`, `checkout-v2026-04`, `payment-v2026-04`, `payments-v2026-04`,
`commerce-v2026-04`, `auth-v0`, `webhooks-v0`. Each surface below is absent from that set and
gates the listed content until it is synced:

| Unsynced surface | Endpoints (as seen in source) | Gated content |
| ---------------- | ----------------------------- | ------------- |
| **fairshare-public-v2025-06** | `/api/public/v2025-06/*` (**commerce/carts + carts/{t}/items, items/{id}/subscribe, items/{id}/variant, enroll, enrollment, enrollment_packs/{slug}**, affiliates/lookup, events/leads/capture, events/checkout/started, events/media/video_analytics, events/pages\|urls/visit, media/{slug}, playlists/{slug}, session, browser/fingerprint) plus `/api/v202506/carts/*` gateway callbacks | the ENTIRE REST backing of the `@fluid-app` FairShare SDK — **cart mutations included**, so effectively **all ~57 SDK pages** (rows #58–#121 less the purely client-side ones), not a subset. Owning spec `public-v2025-06.yaml` is live/current but unsynced |
| **integrations-v0 (Droplets)** | `/api/droplets*`, `/api/droplet_installations*` (+`/exchange`) | droplet-subscription-webhook, google-analytics-droplet, drop-zone-external-usage, mobile-app/use-cases; extras of creating-droplets |
| **~~CRM / rep-v0 (`crm/v202506`)~~ — NOT A SURFACE** | `/api/company\|user/crm/v202506/{activities,catch_ups,contacts,events,notes,tasks}` — **in no spec and no Rails route**; `catch_ups` really live at `/api/catch_ups` | custom-catch-ups-guide + the mobile-app CRM pages. **Not sync-unblockable** — see the structural fact below; re-classify toward discard / rewrite-from-routes |
| **themes-admin API** | `/api/application_themes*`, `/api/application_theme_templates*` | themes/api-reference; admin-API dump inside themes/themes.md |
| **root-themes / marketplace API** | `/api/root_themes*` | theme-marketplace |
| **DAM API (dam-v0)** | `/api/dam/assets`, `/api/dam/assets/{code}/variants`, `/api/dam/query` | dam-upload-endpoints; DAM-picker SDK backend |
| **Global Embeds** | `/api/global_embeds` CRUD | google-analytics-droplet |
| **Drop zones** | drop-zone config/placement API | drop-zone-external-usage |
| **Mobile Widgets + users v2025-06** | `/api/company/mobile_widgets`, `/api/v2025-06/users/{token}` | mobile-widget-implementation |
| **mobile-playlists** | (thin; SDK-doc pointer) | mobile-app/playlists |
| **Web Builder component API** | undefined ("TBD" in source) | adding-components-for-web-builder |
| **tokens-v2025-06** | `/api/v2025-06/{partner_tokens,tokens/public\|partner}` | authentication guide's token-mgmt claims (expected gap — house rules allow `/api/v2025-06/tokens/*`) |
| **fluid_orchestration** | `/api/fluid_orchestration/*` | payment-processing guide (see 9.5b note) |
| **legacy carts / catalog / admin** | `/api/carts` (carts-v0), `company/v1`, `catalog-v1`, `admin-v0`, `/v1/...` | build-shopping-cart, headless-commerce, targeted-marketing — all discarded (superseded by synced-spec rewrites); do not resync |

### Newly confirmed structural facts

- **The FairShare SDK's REST surface is entirely unsynced — including cart mutations.** Verified
  against `origin/main` SDK source (`packages/api-client/src/generated/routes/**`): **every** REST
  call the `@fluid-app` SDK makes is `/api/public/v2025-06/*` (30 paths) or `/api/v202506/carts/*`
  (13 gateway-callback paths), and `grep -r '2026-04' packages/` returns **nothing** — the SDK has
  **zero** v2026-04 references. Cart mutations are **not** an exception: they target
  `/api/public/v2025-06/commerce/carts/*`. So the unsynced surface gates the REST-backed claims of
  effectively **all ~57 FairShare SDK pages**, not a handful. The owning spec
  (`public-v2025-06.yaml`, 67 paths, regenerated 2026-07-23) is live and current — materially unlike
  `company/v1` — but is not in `.github/synced-specs.json`. No `public-v2026-04` successor exists or
  is in flight.
- **`checkout-v2026-04` is the surface for a *direct REST* cart integration, not for the SDK.** Its
  path form `/api/checkout/v2026-04/carts/{cart_token}/...` is legitimately different from the
  storefront/company `/api/v202604/<resource>` house-rule form; both are valid per their own specs,
  and prose should link to the generated reference rather than hand-type a path so the form is not
  mistaken for a banned version. This is what `api/guides/headless-commerce.mdx` and
  `guides/build-shopping-cart.mdx` correctly document. Consequence: **two full cart lifecycles ship
  in parallel** (`public-v2025-06`, 30 paths, what the SDK calls; `checkout-v2026-04`, 58 paths, what
  a direct integrator calls). Publishing both without explicit framing would be actively confusing.
  (Complements gap #8, which covers the checkout cart auth model.)
- **Four already-published SDK facts diverge from verified SDK truth** — re-verified against
  `origin/main` **and** the live production CDN bundle after an initial pass against a stale checkout
  produced one false negative (see the caveat below). All four are confirmed wrong on the published
  pages; corrections tracked on CURRENT-2708:
  - `captureLead` payload is `{message?, contact:{name?,email?,phone?}}`, **not**
    `{first_name,…}`. Severity is **data loss, not cosmetic**: the server ignores the unknown keys,
    so following the published shape silently drops all contact data. No field union is enforced.
  - The media widget attribute is `playlist-id`/`media-id`. `library-id` has **no alias and is
    silently ignored**. The registered tag is `<fluid-media-widget>`, not `<fluid-media>`.
  - `trackFairshareEvent` takes `{eventName, data}` and returns `void` (do not await). The valid
    `eventName` set is exactly **`"CHECKOUT_STARTED"`**; `{event, properties}` is a silent no-op.
  - Lead-capture `contact-method` is `"email" | "phone"` (default `"email"`) — the published
    `email|phone|both` third value does not exist.
  Root cause is upstream: the SDK's own `packages/web-widgets/README.md` still documents the wrong
  `captureLead` and `trackFairshareEvent` shapes on `origin/main`, so fixing Mintlify alone will let
  this regress. Filed against `fluid-commerce/fluid-npm`.
- **Verification caveat (method, not content).** The local `fluid-fairshare` checkout was 24 commits
  behind `origin/main` during the 9.6a census, which produced a false "0 hits — doc ahead of code"
  finding for the cart-feedback / cart-operation-events surface. That API is in fact **live in
  production** (verified in the CDN bundle) and needs only one corrected default: the button-loading
  spinner has been **on by default** since `web-widgets` 0.16.0, making `data-fluid-button-loading`
  a kill switch (`!== "false"`), not an enable switch. Every SDK finding was subsequently re-run
  against `origin/main`; cart-feedback was the only false negative. **Verify SDK claims against
  `origin/main` or the shipped bundle, never a local working tree.**
- **`crm/v202506` does not exist.** The seven mobile-app CRM pages were deferred on a "CRM/rep-v0"
  surface that is in **no OpenAPI document and no Rails route** (`grep 'crm' config/routes/` yields
  only the `draw` line; `catch_ups` actually live at `/api/catch_ups`). Syncing `rep-v0` would not
  unblock them — it documents a different unversioned shape. Those rows are not sync-unblockable and
  should be re-classified toward discard / rewrite-from-routes pending a product owner confirming
  whether a rep CRM API is public at all.
- **No real changelog/release-notes source exists.** The only changelog in the corpus is fictional
  Redocly starter-template content ("Warp API"); a genuine release-notes page is net-new content, not
  a migration.

## Phase 9.6b — claim verification and contract corrections (CURRENT-2709)

The 60-claim queue from Phase 9.6a has a complete disposition. Detailed run evidence belongs on
CURRENT-2709; this section records only decisions that later migration phases must preserve.

| Verdict | Claims | Meaning |
| ------- | -----: | ------- |
| supported | 21 | The claim may advance with its verified scope intact. |
| corrected | 27 | Only the corrected form may advance. |
| deferred | 9 | Publication waits on a named contract, owner, or follow-up phase. |
| discarded | 3 | The claim is false, fictional, or unsuitable for technical documentation. |

Six deferred claims (`#6`, `#7`, `#16`, `#17`, `#26`, `#27`) are deliberately owned by
CURRENT-2724. The other deferred claims are locale fallback behavior (`#39`), the
`getAuthenticatedUser()` return contract (`#41`), and current legal entity/address text (`#57`).

### Corrected published contracts

- The four published FairShare corrections from 9.6a are now applied to `sdk/components.mdx` and
  `sdk/cart-api.mdx`: the nested `captureLead` contact payload, `playlist-id`/`media-id`, the
  `{eventName, data}` event shape, and the two-value lead-capture `contact-method`.
- FairShare registers four web components, including `<fluid-banner-widget>`. Generated widget
  manifests are authoritative for tag and prop discovery; the production entry script is only a
  loader and is not sufficient evidence for that inventory.
- `getAuthenticatedUser()` currently stores an object but reads it through the string storage API.
  Do not publish either an object-return or serialized-return contract until the SDK implementation
  and type contract agree.
- `checkout-v2026-04` cart access is cart-token scoped. Of its 25 cart operations, 22 are public and
  three require a Bearer token: sync, volume-rep assignment, and manual discount creation. The
  source contract normalizes the cart path parameter to `{cart_token}` without changing operation
  IDs.
- The checkout Add Items operation is a batch mutation, not an unconditional
  `{variant_id, quantity}` pair. It also accepts `cart_item_id` with `quantity: 0` to remove a
  specific line. Removing an already-absent item from an existing cart is idempotent and returns the
  current cart with `200`.

### Migration decisions

- Keep the direct `checkout-v2026-04` lifecycle distinct from the FairShare
  `public-v2025-06` lifecycle. `bundleSelections` is sent as `bundle_selections`; nested
  `bundled_items` are a different level of that payload.
- `refreshCart()` clears local cart state after a `410`; `setCartToken()` rejects a completed token
  without clearing it. Do not generalize either behavior to every cart method.
- Theme schema and variable references must be rebuilt from runtime variable builders and Drops.
  Do not migrate the legacy JSON catalogs or unsupported selector types. The storefront cart route
  is `/cart`, not `/:credit/cart`.
- Affiliate lookup is a wrapped `POST` response, not a plain-object `GET`. Droplet exchange
  responses are nested under `droplet_installation` and `credentials`. Publish either only after
  its owning unsynced contract is adopted.
- Both subscription surfaces are real. The legacy unversioned surface and
  `checkout-v2026-04` have different authentication and pagination contracts; handwritten prose
  must not import the legacy surface's offset terminology.
- The webhook inventory guide is discarded: neither `inventory.updated` nor
  `/webhooks/subscriptions` exists. The legacy changelog and unverified marketing promises are also
  discarded.
- DAM upload limits are 200 MB for images and 2 GB for videos. Token, Droplet, DAM, orchestration,
  and mobile-widget claims remain publication-gated on their unsynced owning contracts.
