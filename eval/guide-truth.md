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
| Delete semantics (category soft-delete vs collection hard-delete; child cascade) | Outside all four pilot guide topics; the spec itself doesn't document cascade behavior. Revisit when a delete guide is authored. |
| `filter[status]` stored-vs-resolved matching for past-due scheduled rows | Spec is silent; guides must not assert either way. |
| `sort=position` offered on collections (which expose no `position`) | Spec quirk, not a guide trap — guides already say collections omit position. |
| Metafields `id` in CollectionWrite but not CategoryWrite | Spec asymmetry; guides don't document per-item metafield updates. |
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

- **`has_children` semantics** (hierarchy-010/-027/-030): **still low-confidence
  (split 2-1).** Phase 9.5a added a `has_children` field description to the spec —
  "`true` when the category has at least one child category; `false` when it is a
  leaf. Use it to decide whether to fetch a level deeper when walking the tree." —
  but that text was authored this pass from the same guide source
  (`category-hierarchy.mdx`) these claims already rest on, so it is not independent
  evidence and does not upgrade their confidence. The residual doubt is unchanged:
  on the live-only public catalog, whether `has_children` counts *non-live* child
  categories is established by neither the guide, the spec, nor any claim. Clearing
  it needs a contract-owner/backend confirmation of the counting semantic, not a
  restatement of the guide. Claims stay `check: semantic`; anchors unchanged.

## Known upstream spec gaps (flagged to the backend contract owners)

1. `custom_slug` structurally present in public response schemas while prose says
   it's omitted from the public surface (shared-schema modeling).
   **Deferred (9.5a)** — resolving it is a schema-shape change (split public vs
   authenticated schema), out of this description-only pass; tracked as a follow-up.
2. `has_children` and `position` have no field descriptions.
   **Resolved (9.5a)** — field descriptions were added to both on the `Category`
   schema this pass, so this gap (missing descriptions) is closed. Note this does
   **not** re-verify the low-confidence `has_children` claims: the new text is
   sourced from the same guide, so hierarchy-010/-027/-030 remain low-confidence
   pending contract-owner confirmation (see Low-confidence claims above).
3. `filter[status]` stored-vs-resolved matching undefined for past-due scheduled rows.
   **Deferred (9.5a)** — the param got a general description this pass, but the
   specific stored-vs-resolved semantic is still not established by any guide, claim,
   or spec source (the param description explicitly flags it `needs_confirmation`).
   Documenting it would be fabrication; needs contract-owner confirmation.
4. Delete behavior undocumented (child cascade; category soft- vs collection hard-delete).
   **Deferred (9.5a)** — child-category cascade remains unspecified anywhere; needs
   contract-owner confirmation.
5. Metafields write asymmetry (CollectionWrite models `id`; CategoryWrite doesn't).
   **Documented (9.5a)** — the asymmetry is now noted in both
   `metafields_attributes` descriptions (each cross-references the other). Structural
   alignment of the two schemas is deferred (schema-shape change; follow-up).
6. `sort=position` offered on collections, which expose no `position` field.
   **Deferred (9.5a)** — the fix is an enum/shape change (swap the shared `Sort` for a
   `SortNoPosition` on the collection ops), out of description-only scope; follow-up.
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
