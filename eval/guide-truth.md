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
12. **RESOLVED — `checkout-v2026-04` offset pagination is real, and the house rule was
    wrong.** Found by the first `check-hosted-docs.mjs` run (CURRENT-2711), then verified
    against the Rails implementation rather than the spec, which changed the conclusion
    twice and is worth recording as written.

    **Seven** operations are genuinely offset-paginated — `list_customer_addresses`,
    `list_customer_payment_methods`, `list_customer_points`, `list_reps`,
    `get_store_drop_zones`, `list_subscriptions`, `list_users` — each backed by a Kaminari
    `.page(...).per(...)` call, with a response shape matching
    `ControllerAction#pagination_meta`. There is **zero drift**: every one of the seven
    matches its spec exactly, and `fluid/docs/openapi/checkout-v2026-04.yaml` is
    byte-identical to the synced copy. It is a deliberate design choice, not an oversight:
    cursor support exists on the very base class these actions inherit
    (`ControllerAction#cursor_pagination_meta`) and was not used, and
    `payment_methods_action.rb` additionally declares
    `optional(:per_page).value(:integer, gt?: 0, lteq?: 100)`.

    **`list_customer_orders` is not one of them.** It is genuinely cursor-paginated
    (`Rotulus::Page…at!(params.dig(:page, :cursor))`) and its spec correctly declares
    `page[cursor]` / `page[limit]`. The earlier count of eight came from reading the spec's
    `per_page` occurrences without separating request parameters from response metadata:
    this endpoint's cursor response also emits `per_page`, `current_page`, and
    `total_pages`, and `current_page` is hardcoded to `1`. Never present those three as
    working offset controls on it.

    **Passing `page[cursor]` to one of the seven returns 422, not page 1.** An earlier note
    claimed silent first-page behaviour, and a first correction claimed a 500 from
    Kaminari; both were wrong. `ControllerAction` validates against `Pagination.schema`
    (`optional(:page).value(:integer, gt?: 0)`) before the action runs, so the cursor form
    fails the `int?` predicate and returns `errors: {page: ["must be an integer"]}`.
    Kaminari never receives it. The failure is loud and safe, and the comparison drawn to
    the `captureLead` silent-data-loss defect does not hold. Established by reading the
    dry-schema and dry-types sources and tracing the call path, not by executing a request;
    a request spec asserting 422 would settle it conclusively.

    **Resolution:** AGENTS.md now carries a second pagination exception naming the seven,
    and `check-hosted-docs.mjs` sanctions exactly those pages plus
    `customer-orders/list-customer-orders` (for its response metadata, not its request
    contract). Sanctioning is page-by-page rather than by tag, because `directory`,
    `store`, and `subscriptions` also contain operations that do not paginate this way and
    a tag-wide carve-out would forgive a real leak on a neighbouring page.

    The general lesson, since it cost two wrong answers: the spec describes the contract,
    but only the implementation settles behaviour, and a single layer read in isolation
    produces confident wrong conclusions. The Kaminari reasoning was correct about code
    that never executes.

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

## Phase 9.6c — verified Redocly workflow migration (CURRENT-2710)

Phase 9.6c migrates only claims that survived the 9.6b verification pass and do not depend on an
unsynced API surface. The migration adds client-side FairShare workflows and theme-authoring
workflows; it does not add endpoint contracts to hand-written prose. The API guide claims registry
therefore remains unchanged.

### Migrated and consolidated workflows

- Affiliate hydration, GitHub integration, linked CSS-variable presets, root-theme configuration,
  and supported storefront paths have dedicated theme pages. Affiliate hydration omits the
  nonexistent `rescanForSentinels()` API, and the canonical cart route remains `/cart`.
- The CLI guide includes the verified theme-skill installation workflow.
- FairShare media events and client-side CTA configuration have a dedicated SDK page. Cart operation
  events, custom checkout handlers, initialization boundaries, reset behavior, session errors, and
  event flushing are consolidated into the existing SDK pages.
- Existing theme and SDK overview pages link to the migrated workflows. Legacy Redocly URLs are not
  carried into the new pages; redirect continuity belongs to Phase 9.6e.

| Redocly source group | Mintlify disposition |
| -------------------- | --------------------- |
| `themes/affiliate-hydration.md` + SDK affiliate-hydration page | Consolidated into `themes/affiliate-hydration.mdx` |
| Base, Fluid, and Vox theme-configuration pages | Consolidated into `themes/root-theme-configuration.mdx`; volatile per-theme token catalogs discarded |
| GitHub integration, linked CSS presets, supported paths | Migrated to dedicated `themes/*.mdx` pages |
| Theme CLI | Consolidated into `themes/cli.mdx` |
| Theme authoring guides | Existing overview/developer/page-editor pages retain parity; custom layouts and corrected History review/compare/publish workflows added |
| SDK media/playlist event and CTA pages | Consolidated into `sdk/media.mdx` |
| SDK cart-operation, cart adoption, refresh, variant, enrollment, and checkout-handler pages | Consolidated into `sdk/cart-api.mdx` at SDK altitude |
| SDK initialization, reset, session, and flush pages | Consolidated into installation/components pages |
| Theme reusable option groups | Assigned to CURRENT-2724 schema-components coverage |

### Publication boundaries

- The eight fast-path corrections assigned to CURRENT-2724 remain outside this phase:
  blocks/components, theme variables, image transformations, media tags, cart feedback, product
  bundles, schema components, and bundled `addCartItems()` fields.
- FairShare REST workflows remain gated on adoption of `public-v2025-06`. Client SDK prose must not
  imply that those methods use the direct `checkout-v2026-04` lifecycle.
- The custom catch-ups guide remains gated on syncing its owning `company-v0` contract. Do not add a
  `GET /{id}` workflow: neither the source spec nor the controller implements a show operation.
- Other census entries tied to unsynced Droplet, DAM, theme-admin, mobile-widget, orchestration, and
  token surfaces retain their Phase 9.6a deferrals. Discarded CRM, inventory, changelog, and
  marketing pages do not regain eligibility through this migration.

## Phase 9.6c.1 — consumer-blocked theme and SDK fast path (CURRENT-2724)

CURRENT-2724 publishes eight narrowly scoped theme and SDK corrections without adopting the
unsynced FairShare REST surface. The following bundle decisions are durable:

- The synced storefront Product show response exposes bundle data as the top-level
  `product.bundle_groups[]` field. The legacy `product.product_bundle_groups[]` shape is absent.
  The new product-bundles guide is registered against `storefront-v2026-04`, with that field shape
  and its workflow-critical group fields mechanically gated.
- Product-bundles legitimately touches two synced contracts. Storefront supplies the bundle
  definition; checkout consumes the selection. Because the claims checker resolves one spec per
  guide, storefront facts remain mechanical and checkout facts are explicit semantic cross-spec
  claims verified against `checkout-v2026-04`. This follows the existing narrow multi-spec pattern
  and avoids a checker redesign for one guide.
- Checkout Add Items accepts `bundled_items[]` on a parent item. Each child requires `variant_id`
  and `quantity`, and can carry `product_bundle_group_id`, `subscription`, and
  `subscription_plan_id`. `mutually_exclusive_groups_selected` is absent from the synced checkout
  request schema and is deliberately omitted from the guide and SDK examples.
- The FairShare SDK remains a separate cart lifecycle from direct checkout. Its runtime mapping
  preserves extra nested bundle-child fields, so JavaScript can send `product_bundle_group_id`.
  The public TypeScript bundled-item declaration currently lists `variant_id`, `quantity`,
  `display_to_customer`, `subscription`, and `subscription_plan_id` but can omit
  `product_bundle_group_id`; the docs call out the local type-extension workaround instead of
  claiming complete type support.
- The omission sweep accepted exhaustive bundle pricing, inventory, country, and administrative
  configuration as reference territory. The guide keeps only the render → select → submit workflow
  and links to generated endpoint references for the full contracts.

## Phase 9.6d — migration closure reconciliation (CURRENT-2711)

Closure gate for the Redocly migration: every authored page reconciled to a final outcome, and every
migrate / rewrite / consolidate outcome checked against a page that actually exists in the published
nav. The full 127-row ledger is a run record and lives on CURRENT-2711; only the settled outcomes are
recorded here.

### Corrected disposition tally (supersedes the Phase 9.6a tally)

The 9.6a tally above was never re-rolled-up after later phases changed individual dispositions. These
are the final counts; 11 of the 127 rows changed.

| Disposition | 9.6a | Final | Meaning |
| ----------- | ---- | ----- | ------- |
| migrate | 10 | **12** | verified, unique, API surface synced |
| rewrite | 14 | **13** | valuable workflow, prose drifted / violated house rules |
| consolidate | 57 | **56** | merge into an existing Mintlify page |
| defer | 19 | **11** | owning API surface not synced yet |
| discard | 27 | **35** | false / obsolete / duplicate / out-of-scope |

The changed rows, with the phase whose evidence moved them:

- **The eight `mobile-app/*` CRM pages** (activities, catch-ups, contacts, events, notes, overview,
  tasks, use-cases) moved **defer → discard**. `crm/v202506` was never a surface, so these pages are
  not sync-unblockable: none of their 62 endpoint rows is correct as written, and the catch-up and
  user-scoped event writes they document have no route at all (9.6b/9.6c).
- **`guides/custom-catch-ups-guide.md`** moved **defer → migrate as current content** — its URLs,
  auth, and route are verbatim correct and owned by `company-v0` (9.6c). Publication stays gated on
  that sync, so it is the one eligible page with no published home (see the reconciliation gap
  below). Do not add a `GET /{id}` workflow: neither the spec nor the controller implements one.
- **`sdk/fairshare/cart/cart-operation-events.md`** moved **rewrite (hard blocker) → migrate**. The
  doc-ahead-of-code blocker was a false negative produced by a 24-commit-stale local
  `fluid-fairshare` checkout; the API is live in the shipped CDN bundle (9.6a corrections, 9.6b
  claim 21). This is the origin of the binding rule that SDK claims are verified against
  `origin/main` or the shipped bundle, never a local working tree.
- **`sdk/fairshare/components/getAuthenticatedUser.md`** moved **consolidate → defer**. Claim 41
  deferred its return contract (the SDK writes an object but reads through string storage), and the
  dependency is an upstream SDK/type fix rather than a spec sync.

Rows #60–#85 keep their dispositions but their spec attribution was wrong: those SDK pages were
mapped to `checkout-v2026-04`, a surface the SDK never calls. They belong to the unsynced
`fairshare-public-v2025-06` surface. The dispositions hold because 9.6c published them at SDK
altitude only — verified by grep-absence of `public/v2025-06`, `v202506`, and `crm/v202506` from
every published `.mdx`.

### Reconciliation result

81 rows are in scope (12 migrate + 13 rewrite + 56 consolidate). **80 of 81 targets are present**,
and navigation is whole: 41 `.mdx` files, all 41 in `docs.json`, no orphans and no nav entries
pointing at absent files. Deferred content is correctly absent — neither `lookupAffiliate` nor
`custom_catch_ups` appears in any published page.

The single gap is `guides/custom-catch-ups-guide.md`, which is a **deferred-unsynced exception, not
a coverage failure**: its disposition is migrate, but it stays unpublished until `company-v0` syncs.

### Accepted omissions (deliberate — do not re-litigate without cause)

- `themes/schema-components.md` (182 KB of source) ships as one page rather than the split that was
  originally sketched. Reusable option groups are covered; the exhaustive per-component reference is
  accepted reference territory, consistent with the 9.6c.1 omission sweep.

### The graded eval is retired; the hosted check is deterministic and key-free

`eval/run-eval.mjs` and its tests are deleted, replaced by `eval/check-hosted-docs.mjs`. The old
harness paid a model to answer each prompt from the docs and graded the answer, so both of its modes
required an `ANTHROPIC_API_KEY`. The replacement calls Mintlify's unauthenticated `/mcp`
`search_fluid` tool with each prompt's own text. Nothing in `eval/` calls a model or needs a
credential now.

The checker grades in **two separable stages**, and the separation is the load-bearing design
decision. `search_fluid` returns a truncated slice of each matching page, so asserting a full
contract against that slice measures snippet luck, not discoverability — and a failure could not be
read as either a ranking problem or a docs problem. So:

- **Stage 1 — retrieval:** does search return the page that documents the answer? For API prompts
  that page is resolved mechanically from `llms-full.txt` by matching the generated contract line
  `<method> <path>`, so no hand-maintained prompt-to-page mapping exists to drift. Workflow prompts
  declare `target_page` (a string, or an array where a workflow legitimately spans a guide plus the
  reference it points at) because a workflow is not one operation and nothing in the corpus identifies
  its owning page mechanically.
- **Stage 2 — contract:** fetch that page's full markdown (`<base>/<page>.md`, cache-busted the same
  way the llms files are) and check the contract there. A generated reference page inlines the
  operation's OpenAPI fragment, which is what makes this richer than prose matching.

What a green run now means:

- **Proven:** the answer is published, discoverable through the hosted agent surface, and correct in
  its contract detail — method, path, auth, query-parameter names, and request-body fields for API
  prompts; required and forbidden vocabulary for workflow prompts. Also per run: `llms.txt` and
  `llms-full.txt` are live and non-trivial, and no unsanctioned legacy marker appears in the corpus,
  in retrieved content, or on any fetched target page.
- **No longer proven:** that a model given those docs produces the correct answer. The ≥ 90% /
  zero-legacy acceptance metric described a model's answers and does not transfer; the checker
  requires everything to pass instead.
- **`auth` is checked, from the spec and never from prose.** Every hosted `.md` page opens with an
  agent-instructions banner reading "Authenticate with the header `Authorization: Bearer <token>`", so
  any prose-based check would report bearer for all 57 API prompts. The check reads the inlined
  security requirement (`- bearer_auth: []`); the `securitySchemes` definition renders without the
  leading dash, which is what distinguishes a requirement from a declaration.
- **That same banner had to be stripped before the legacy scan.** It names `per_page` (in order to
  forbid it) and lists every spec filename including `webhooks-v0.yaml`. Left in, it produced a
  `per_page` hit on all 57 fetched pages *and* satisfied the webhooks-v0 sanction on all 57 — a check
  that fires everywhere and forgives everywhere. `stripAgentBanner` removes the leading block quote so
  each page is scanned on its own content.
- **`forbidden_terms` are page-scoped, which restored them as real assertions.** Scanned against a
  ten-page search dump, a term was unusable if it appeared anywhere in the corpus, including in a
  "use X, not Y" correction. Scoped to the page that owns the workflow, absence is meaningful again.
  Two of the four terms dropped earlier are restored: `product_bundles_attributes` (verified absent
  from both of `product-bundle-read-shape`'s target pages) and `bundleSelections` on
  `product-bundle-direct-cart-write` (verified absent from `api-reference/cart-items/add-items-to-cart`).
  Two stay dropped, deliberately: `data-fluid-button-loading="true"` is printed on
  `themes/cart-feedback` in a corrective sentence, and `bundleSelections` on
  `sdk-add-cart-items-bundled-payload` is correctly documented on that prompt's owning page,
  `sdk/cart-api`. Retargeting an SDK question to a theme guide to make a negative assertion pass would
  misattribute ownership, so it was not done.
- **The two stages are gated differently, because they are not equally stable.** Stage 2 must be
  **100%** — it applies fixed assertions to a fetched page, so any failure is a real docs gap or a
  wrong expectation. Stage 1 is gated as a **rate, ≥ 90%**, reusing the project's own documented
  success metric ("pass rate ≥ 90%, zero legacy-endpoint answers") now applied to retrieval rather
  than to a model's answers; gating a live search engine's ranking per prompt would make the build a
  coin flip on borderline queries. Every stage-1 miss is named in the output regardless of the rate,
  so a regression stays visible rather than being absorbed by the tolerance. A prompt that misses
  stage 1 but passes stage 2 is reported as `MISS`, not `FAIL`.
- **There is no retry-until-green.** One query per prompt decides the verdict, the way a real agent
  asks once. Retrying until a page ranks would launder a discoverability weakness into a pass. The
  optional `--repeat N` flag issues N queries and reports per-prompt hit rates as a **diagnostic
  only** — the verdict always comes from the first query, so the gate is identical with or without it.
- **Fetching whole pages removed most of the observed flakiness.** Under the old snippet-based
  assertion, API passes moved 37 → 40 → 40 across three runs and one prompt reported 1 then 4 missing
  terms. At page granularity, four consecutive full runs returned the same 60/63 with the same three
  misses, and each of those three reproduces 0/5 under `--repeat 5` — they are stable ranking facts,
  not noise. Confirm a stage-1 miss with a targeted re-run anyway; it costs one query.

### Citation hygiene: operationIds and literal declarations, never line numbers

Auditing `prompts.json` during the CURRENT-2711 rebuild found that **every checkable line citation in
the file was stale — 32 of 32.** Each note that named both an `operationId` and a spec line range
pointed at the wrong place, typically by 90–500 lines, because the specs re-sync hourly and grow as
descriptions are enriched. Two examples of what a reader following them hit: `checkout-add-cart-items`
cited a range whose lines held a price-discount block from a different operation, and
`checkout-apply-discount-code` cited a range ending on a different operation's `operationId`. A
citation that lands on the wrong operation is worse than no citation, because it invites confirming
the wrong fact.

So line numbers are the wrong instrument for this repo regardless of whether they start correct, and
all 47 affected notes were rewritten to drop them. **Cite only things that survive a re-sync:** the
`operationId`, the schema name, the literal declaration (`security: []`, `required: - items`), or the
published page path. The same audit found one fabricated pair of schema names —
`AddItemsRequest` / `BundleChildInput` in `product-bundle-direct-cart-write`, neither of which exists
in any synced spec, because that request body is defined inline with no named schema — now corrected
to the real `items[].bundled_items[]` structure.

Every `operationId` named across the 63 notes was re-verified present in the spec the note names, and
because stage 2 now checks `auth` mechanically against each page's inlined security requirement, all
57 API notes' auth claims are confirmed against the spec by the run itself rather than by prose.

### `product-bundle-read-shape` expectations corrected

The prompt could never pass, for two independent reasons, and its notes now carry the evidence.

- It required `product_bundle_groups` — the **legacy shape `themes/product-bundles` explicitly
  disavows** ("Use `product.bundle_groups[]`, not the legacy `product.product_bundle_groups[]`
  shape"). It scored as satisfied only because the page names the legacy shape inside that warning.
  The required term is now the dotted `product.bundle_groups`, which the legacy name does not
  contain as a substring, so the current shape is what actually gets checked. The legacy name is
  deliberately **not** added to `forbidden_terms`: the corrective warning would trip it, and the
  subscriptions spec legitimately exposes `subscription.variant.product.product_bundle_groups[]`.
- It required `pricing_type` and `country_pricing`, which appear in no published `.mdx`, not in
  `api-reference/storefront-v2026-04.yaml`, and not in `llms-full.txt`. Phase 9.6c.1 above accepted
  exhaustive bundle pricing and country configuration as reference territory, so those requirements
  contradicted a durable decision. Both are removed, and the prompt no longer asks for them.

The kept group fields are verified in the storefront `ProductBundleGroup` schema: `group_type`,
`min_selections`, `max_selections`, `selection_type`, `bundle_group_items`, and the item's
`bundled_variant_id`. `group_type` is **spec-only** — it reaches readers through the spec-driven
Product show reference, not the prose page. That is why this prompt declares two target pages: the
theme guide supplies the render shape, the generated storefront Product show reference supplies
`group_type`, and Phase 9.6c.1 already records that this workflow spans two synced contracts.

### Three checkout `auth` expectations corrected against the spec

Enabling the `auth` check surfaced three prompts whose expectations the synced spec contradicts. All
three claimed `security: bearer_auth` in their notes; all three are now `"none"`:

- `checkout-apply-discount-code` — `checkout_v2026_04_apply_cart_discount` declares an explicit
  `security: []`.
- `checkout-magic-link-returning-buyer-probe` — `checkout_v2026_04_send_cart_magic_link` declares an
  explicit `security: []`.
- `checkout-add-cart-items` — the operation declares no `security` key and `checkout-v2026-04.yaml`
  carries no top-level `security`, so by OpenAPI semantics there is no requirement.

This is not a downgrade of the contract: these cart endpoints are credentialed by the opaque cart
token in the path, which the spec models as no security scheme and the generated page states as
"cart-token authentication carried in the path, with no bearer token or API key". The eval's `auth`
field only distinguishes `none` from `bearer`, so `none` is the correct value. The stale notes are
corrected in place rather than deleted, so the disagreement stays visible.

### Spec line numbers are not usable as evidence — do not add more

`prompts.json` notes carry roughly 83 spec line citations accumulated across earlier phases, and they
are unreliable. Three were spot-checked against the current specs and all three pointed at unrelated
operations: `webhooks-register` cites `webhooks-v0.yaml` line 1562 for registering a webhook, but that
line is `summary: Delete company event`. This is not carelessness by whoever wrote them — the specs
re-sync hourly from the source-of-truth mirror, so a line number is correct only until the next sync
touches anything above it. A rotted pointer is worse than none, because a reader who follows it lands
on a different operation and can "confirm" the wrong fact.

All 83 were removed in this phase. What remains is the stable evidence that was already alongside them
and does not rot: `operationId` for the 51 notes that carry one, and for the rest a schema name
(`AddItemsRequest`, `BundleChildInput`, `LangWrite`, `CategoryWrite`), a camelCase operation name, a
field name, or the owning page. Cite those, plus the literal declaration where it matters — for example
`security: []`. Do not reintroduce line numbers: they are unusable as evidence against an hourly-synced
artifact, however accurate they are the moment they are written.

### Scope caveat carried forward

"Zero pages unaccounted for" covers the 127 authored Markdown pages only. The legacy site also served
37 `/docs/openapi/<spec>` reference routes, a `_spec/*` OpenAPI-JSON family, and a 20-link landing
page — none censused. `/docs/openapi/rep-v0` (10 inbound internal links) and `/docs/openapi/carts-v0`
(8) are the corpus's most-linked targets and have no Mintlify page. URL continuity for that namespace
is CURRENT-2719.

## Phase 9.6e — URL continuity for the legacy Redocly namespace (CURRENT-2719)

Mintlify serves `docs.fluid.app` directly, so a `docs.json` `redirects` array covers the whole legacy
namespace with no DNS, edge, or proxy change. The shipped map is **225 entries**, using only
`source`/`destination`/`permanent`. Only settled outcomes are recorded here; the map is the diff and
the run record is on the issue.

### Every entry is `permanent: false`, deliberately

`permanent: true` emits **308** and `false` emits **307** — verified against the entries that were
already live: `/docs/themes/theme-variables`, `/docs/themes/template-types`,
`/docs/sdk/fairshare/cart/addcartitems`, and `/` all returned 308 in production. Note `mint dev`
returns 307 for *everything* regardless of the flag, so the permanent/temporary semantics cannot be
observed locally — only the fact that an entry fires and where it points.

An earlier revision of this map marked 156 entries permanent on the reasoning that a verified,
genuine final home deserves a 308. That was the wrong default, for three reasons:

- **The risk is asymmetric and one direction is irreversible.** 307 → 308 is always available later.
  308 → 307 is not: a 308 is cacheable by default and browsers hold it more or less indefinitely, so
  a client that hits a wrong permanent redirect keeps being sent to the wrong place after the config
  is corrected, until its cache is cleared. There is no server-side retraction.
- **This project's own record shows destinations churn.** 11 of the 127 dispositions changed between
  9.6a and 9.6d; `a2056ea` deleted two redirect entries that 9.6e restored; four slugs were renamed
  after publication (`paged-editor`, `themes-cli`, `github_integration`, `template-types`). Two
  further phases will still move content — CURRENT-2725 adopts `public-v2025-06`, and CURRENT-2722
  creates two pages that shipped code already advertises. Declaring a destination final now bets
  against the observed base rate in this very corpus.
- **The usual argument for 308 barely applies here.** Permanent redirects are standard in a migration
  to transfer link equity and retire the old URLs from the index. But these URLs had been **404ing**
  since the Redocly cutover, and search engines drop 404s, so most of that equity is already gone.
  308 buys much less than it would in a live-to-live cutover, while costing the irreversibility above.

The residual cost is accepted: search engines will not consolidate legacy URLs onto their successors,
so any that are still indexed will linger. That is recoverable by promoting to 308 later; a poisoned
client cache is not.

Promotion is therefore a deliberate, evidence-led step rather than a default — see CURRENT-2738. The
gate should be that destinations have held still across the remaining phases *and* that an analytics
cycle shows which legacy URLs are actually being hit.

One limitation worth stating plainly: the 9 entries that shipped in earlier phases were already
serving 308 in production, so any browser that already cached them keeps that permanent redirect.
Flipping them to 307 changes behaviour only for clients that had not yet hit them.

### The legacy URL surface is larger than the 127-page census

The scope caveat above named the gap; this phase measured it. The census counted authored Markdown
only, and its own group figures (sdk 67 + guides 33 + themes 21) sum to **121, not 127** — six pages
were omitted, all of which served 200: `/docs/about-us` and its two children, `/docs/legal/terms`,
`/docs/legal/responsible-use`, and `/docs/changelog`.

The full legacy HTML surface is **172 routes**: 127 authored pages + 37 `/docs/openapi/<spec>` (one
per `apis:` entry in `redoc/redocly.yaml`) + 7 `/docs/apis/client/<name>.client` + the homepage.
Two of those families were invisible to every prior count because they are derived, not authored:

- **`/docs/apis/*` is an older generation of API-reference URL, and it is the one shipped code links
  to.** Every `fluid-admin` link uses `/docs/apis/swagger[/…]` or `/docs/apis/fluid.api/…`, never
  `/docs/openapi/*`. Both generations were live. A map built from the authored corpus covers none of
  them, which is why they were the most urgent entries in this phase despite appearing in no census.
- **`/docs/apis/client/<name>.client`** — OpenAPI JSON under `docs/` auto-routed, with `.client` part
  of the slug. `components.json` did *not* route; it is a shared-components file.

### Redocly Realm lowercased every route slug — no legacy URL contained an uppercase character

This was recorded as undocumented and hedged around with dual-case entries. It is settled: running
the engine against the corpus and probing all 127 routes both ways returned **200 for all 127
lowercase forms and 404 for all 47 mixed-case forms**, and `routesBySlug` applies `toLowerCase()` in
`@redocly/realm/dist/server/store.js`. So the "47 of 127 uppercase" figure counts mixed-case
**filenames**; the count is right and the classification was not.

Case-folding is the only transformation. Underscores and dots survive and there is **no kebab
conversion** — the distinction between a working entry and a dead one:

| served (200) | never served (404) |
| --- | --- |
| `/docs/themes/base_theme_configuration` | `/docs/themes/base-theme-configuration` |
| `/docs/sdk/fairshare/cart/addcartitems` | `/docs/sdk/fairshare/cart/add-cart-items` |

Sources therefore use the lowercase-with-underscores form. Mixed-case twins are kept because
Mintlify's own `source` case-sensitivity is still undocumented and the legacy corpus authored
mixed-case links — three such links in `themes/developer-guide.md` were already 404ing on the legacy
site for exactly this reason.

Routing was purely file-path derived: no frontmatter `slug`/`permalink` override exists anywhere in
the corpus, and `redocly.yaml` carries no path-prefix directive. The `/docs/` prefix existed only
because the content folder is named `docs/`. Trailing slashes 301'd to the bare path.

`.md`-suffixed sources are also carried, and they are **not** legacy-URL continuity: Realm stripped
the extension when routing, so `/docs/themes/theme-variables.md` never served. They are defensive
coverage for link strings that demonstrably exist in the wild.

### Slug renames need explicit entries — there were more than the two tracked

A path-preserving rule silently 404s every one of these: `themes/paged-editor` → `themes/page-editor`;
`themes/themes-cli` → `themes/cli`; `themes/github_integration` → `themes/github-integration`
(underscore → hyphen); `themes/template-types` → `themes/blocks-and-components`;
`guides/creating-and-using-droplets` → `guides/creating-droplets`; `guides/dam-file-picker-guide` and
`guides/dam-picker-sdk-guide` → `guides/dam-picker` (two → one); `guides/authentication-guide` →
`api/authentication`.

### The generated-path rule is fully determined, and it matches Realm's

Generated reference pages are addressed `/api-reference/<tag>/<summary>`, and both segments get the
same treatment: **case is folded**, **underscores are preserved**, **spaces become hyphens**.
Established from the `mint export` path inventory with negative evidence in both directions:
`tags: [Gateways]` serves at `gateways` and `api-reference/Gateways/` has zero entries;
`tags: [order_edits]` stays `order_edits` and `order-edits` has zero entries. `Merchant
Configuration` → `merchant-configuration`; `summary: Undo_skip subscription` →
`undo_skip-subscription`. This is the same rule Realm applied, which is why the legacy and current
namespaces share a case-folded, underscore-preserving shape.

Seven of the 37 legacy `/docs/openapi/*` routes reach a generated page — `storefront-v2026-04` →
`storefront/public-product-by-slug`, `checkout-v2026-04` and `carts-v0` → `carts/create-a-cart`,
`webhooks-v0` → `webhooks/create-a-webhook`, `payment-v2026-04` → `gateways/list-gateways`,
`auth-v0` → `auth-token/create-auth-token`, `payments-v2026-04` →
`payments/set-the-cart-payment-method`. Every one was confirmed present in the export inventory
*before* being written, not derived and hoped for. The other 30 reach `/api/overview` by policy, not
by failure.

`commerce-v2025-06` routes to `/api/overview` deliberately, even though
`order_edits/atomically-apply-one-or-more-edits-to-an-existing-order` resolves: the Commerce group
holds only the two `commerce-v2026-04` order-edit operations while the legacy surface was broader, so
pointing there would assert coverage that does not exist. `commerce-v2026-04.yaml` is on disk but
absent from `apis:`, so it never had a legacy route.

For `/docs/openapi/*` and `/docs/apis/*` the durable fix is per-surface landing pages, so these are
the last entries that should ever be considered for promotion to 308.

### The `themes-cli` anchor re-maps by reader need, not heading name

Legacy `themes-cli.md:171` `## Start Up Guide` opened with an `### Installation` subsection offering
RubyGems and Homebrew. `themes/cli.mdx` has no "Start Up Guide"; its `## Installation` carries those
same two options, while `## Getting Started Workflow` is the closer match by *name* but different
content near the page end. The live consumer links that anchor from copy about installing the CLI and
uninstalling an older `fluid_cli`, so the destination is `/themes/cli#installation`.

A Mintlify `source` cannot carry an anchor — only a `destination` can. So an anchored legacy URL
cannot be routed separately from its unanchored twin, and all `themes-cli` traffic lands on
`#installation`, including the unanchored "Master the CLI" consumer. Accepted deliberately.

### A redirect to a page that does not document the content is a regression, not continuity

Deferred and discarded content is verifiably absent from published pages by design, so pointing a
reader at a plausible neighbour would assert coverage that does not exist. **19 legacy URLs are
recorded accepted 404s** rather than nearest-conceptual redirects:

- `sdk/fairshare/components/getAuthenticatedUser`, `sdk/fairshare/settings/lookupAffiliate` —
  deferred; absent from every published page.
- The eight `guides/mobile-app/*` CRM pages including `overview` — discarded because false.
  `crm/v202506` was never a surface and none of their 62 endpoint rows is correct.
- `guides/mobile-app/native-widgets`, `guides/mobile-app/playlists`, `sdk/mobile-sdk` — stubs and
  placeholders.
- `guides/data-dashboard`, `guides/inventory-management`, `guides/targeted-marketing`,
  `legal/terms`, `legal/responsible-use`, `changelog` — fictional, disproven, or out of scope.

No blanket catch-all wildcard is added, and the map contains **no wildcards at all**. A catch-all
would hide which URLs are actually being hit; one analytics cycle of real 404 data is the cheaper way
to decide the long tail. A consequence worth recording: because there are no wildcards, the
undocumented precedence between a specific entry and an overlapping wildcard is moot here, so a
passing build says nothing about that precedence.

### Consumers outside this repo cannot be fixed by redirects

`/_spec/*.json` is a build-time JSON fetch surface and Mintlify serves no JSON there; five distinct
`_spec` URLs are fetched by committed codegen across seven `fluid-mono` packages, which need editing
rather than redirecting. Two shipped runtime emitters advertise Mintlify-namespace paths that do not
exist — `/api/public/forms` in a `Link: rel="successor-version"` response header and
`/migration/server-side-attribution` in a browser deprecation warning. Creating those pages is
tracked separately, and aiming a successor-version pointer at an approximate page is worse than its
404. No SDK-generated output file contains a `docs.fluid.app` URL: every reference in the workspace is
hand-written source, prose, or a test fixture.

### Two count corrections to earlier phases

- The 9.6a SDK sub-split above ("cart 31 + components/events/settings 36") is a mis-roll-up. Actual:
  cart 26, components 19, events 11, settings 6, top-level 5 = **67**. The 67 total and the 127 /
  guides 33 / themes 21 tallies are correct.
- `guides/mobile-app/` holds **10** pages, not 11 — the eight CRM pages plus `native-widgets` and
  `playlists`, with no `index.md`. `mobile-app` was never a first-level segment, so no
  `/docs/mobile-app/*` namespace existed.

### Verification, and a footgun that made one check silently vacuous

Four instruments, each proving something the others do not: `mint validate` for schema (CI runs it);
`mint broken-links --check-anchors --check-redirects --check-snippets` for destination liveness and
anchor resolution; `mint export` to confirm a generated destination exists *before* writing it; and
`mint dev` for runtime proof that entries actually fire, since a schema-valid array that never matches
would satisfy the first two.

`mint broken-links` was **aborting on this repo before checking anything**, because this file's own
line 877 carried a bare `<token>` in prose that MDX parsed as a JSX tag and `eval/` is not in
`.mintignore`. The run looked like tooling flakiness while verifying nothing. Backticking the header
fixed it; no `.mintignore` change was needed. `mint export` had tolerated the same file and emits no
`/eval/guide-truth` or `/AGENTS` page, so nothing internal was ever published — this was a
build-parser fault, not a content leak. **Prose in this file is MDX-parsed: fence or backtick every
inline angle-bracket placeholder.**
