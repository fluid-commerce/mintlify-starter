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
  "spec": "api-reference/storefront-v2026-04.yaml",
  "extraction": {
    "method": "blind — guides only, no spec access",
    "date": "YYYY-MM-DD"
  },
  "guides": ["api/guides/<file>.mdx", ...],
  "claims": [ /* Claim objects, see below */ ]
}
```

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

## Low-confidence claims (survived on a split vote)

- **`has_children` semantics** (hierarchy-010/-027/-030): CONFIRMED 2-1. The field
  has no description anywhere in the spec; "true = ≥1 child" rests on the field name
  alone, and a live-children-only reading is plausible on the public surface. If
  upstream adds a description, re-verify these three claims first.

## Known upstream spec gaps (flagged to the backend contract owners)

1. `custom_slug` structurally present in public response schemas while prose says
   it's omitted from the public surface (shared-schema modeling).
2. `has_children` and `position` have no field descriptions.
3. `filter[status]` stored-vs-resolved matching undefined for past-due scheduled rows.
4. Delete behavior undocumented (child cascade; category soft- vs collection hard-delete).
5. Metafields write asymmetry (CollectionWrite models `id`; CategoryWrite doesn't).
6. `sort=position` offered on collections, which expose no `position` field.
