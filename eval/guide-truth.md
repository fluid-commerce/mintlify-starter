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
| Adversarial semantic verification | procedure below, report in `eval/guide-verification-report.md` | One-off at guide authoring/major-edit time (LLM; never in CI) |
| Reverse omission sweep | procedure below, findings in the report | One-off at guide authoring/major-edit time |

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

Failure output names the claim id, guide file:line, and the reason, so the fix
(guide, registry, or spec) is obvious.

## CI wiring

- **`validate.yml`** — runs the checker on every PR and push to `main`. A PR that
  edits a guide without updating the registry (or vice versa) fails.
- **`sync-openapi-spec.yml`** — runs the checker against the freshly synced spec
  before committing it to `main`. A synced spec change that contradicts a guide
  claim follows the same quarantine path as a spec that fails `mint validate`: the
  sync is blocked, a `spec-sync-blocked` PR is opened for a human, and the hosted
  docs stay on the last-good spec.

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
4. Verdicts + citations land in `eval/guide-verification-report.md`.

## Reverse omission sweep (one-off, never in CI)

Claims verification catches what guides *say*; the sweep catches what they *hide*.
A spec-only reviewer (no guide access) lists reader-trapping facts per guide topic —
422 conditions, limits, lifecycle edge cases, param gotchas. The list is then
diffed against the guides; every finding is either fixed in the guide or explicitly
accepted (with rationale) in the report.

## Adopting the mechanism for new guides (Phases 5–9)

1. Author the guide as usual.
2. **Blind-extract** claims (no spec access; read only the new guide + this doc) and
   append them to `eval/guide-claims.json` with a new guide prefix; add the guide to
   the `guides` array.
3. Run `node eval/check-guide-claims.mjs` — fix guide or registry until green.
   Mechanical failures at this point are usually real guide errors: the whole point.
4. Run the adversarial semantic pass + omission sweep on the new guide; fix until
   zero REFUTED/UNSUPPORTED; append the run to `eval/guide-verification-report.md`.
5. Commit guide + registry together. CI keeps them honest from then on.

Editing an existing guide: update the affected claims (quotes/lines/anchors) in the
same PR; the quote-presence check fails until you do. Semantic re-verification is
only needed when behavioral statements changed.
