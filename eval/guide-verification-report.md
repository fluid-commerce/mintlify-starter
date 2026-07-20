# Guide truth-gate verification report — Categories/Collections pilot

**Linear:** CURRENT-2587 (Phase 3.5) · **Date:** 2026-07-20 · **Spec:** `api-reference/storefront-v2026-04.yaml` (7,028 lines)
**Guides covered:** the four pilot task guides in `api/guides/` (find-and-create, rename-publish-and-schedule, country-availability, category-hierarchy)

## Result

| Gate | Outcome |
| ---- | ------- |
| Claims registry | **258 claims** committed (`eval/guide-claims.json`): 159 mechanical, 99 semantic |
| Mechanical checker | **PASS** — 0 failures, 0 warnings (`node eval/check-guide-claims.mjs`); self-test 46/46 |
| Adversarial semantic verification | **99/99 CONFIRMED** after fixes — 0 REFUTED, 0 UNSUPPORTED |
| Reverse omission sweep | 38 facts triaged: 25 already covered, **4 fixed**, 9 explicitly accepted |
| CI blocking demo | Contradicting spec change **blocked** (transcript below) |

## Process

1. **Blind extraction** — 246 atomic typed claims extracted from the four guides with no
   spec access (claims record what the guides *say*). 12 more were added alongside the
   fixes below → 258 final.
2. **Mechanical check** — every structural claim validated against the spec (endpoint,
   parameter, request/response field, enum, required list, auth mode, status code,
   example payloads), plus quote-presence anchoring every claim to live guide text.
3. **Adversarial verification** — two independent refutation-prompted verifiers ruled on
   every semantic claim; disagreements and subtle-flagged claims went to a targeted
   third vote (12 claims); majority holds.
4. **Omission sweep** — a spec-only reviewer (no guide access) listed reader-trapping
   facts per guide topic; each was diffed against the guides and fixed or accepted.

## Findings that led to fixes

### Caught by the mechanical checker (1)

- **rename-publish-017** — the guide says `custom_slug` is omitted from the public
  catalog. The spec's *shared* Category schema structurally includes it on public
  responses; the omission exists only in description prose ("Omitted from the public
  surface", spec ~L483-485). Extraction had over-mechanized the claim; re-typed to
  semantic (where it is CONFIRMED from the prose). Also flagged upstream (below).

### Caught by adversarial verification (2)

- **country-021 — REFUTED (2/2 verifiers)** — "public catalog and public slug endpoints
  also return `countries`, but only for live rows" was false for the public *collection*
  slug, which resolves draft/scheduled/inactive rows (404s only archived, spec
  L6614-6619) and still returns `countries` (required field, L2871/L2926-2934).
  **Fixed:** the country-availability guide now states exposure per surface; the
  corrected sentence is registered as country-021 (rewritten) + country-039, both
  supported by the verifiers' citations above.
- **country-031 — disputed (A: UNSUPPORTED, B: CONFIRMED-with-caveat)** — "availability
  is *controlled* and queried with `filter[country]`" overreached: writes go through
  `country_isos` (L547-553); `filter[country]` only queries (L140-147). Both verifiers
  independently flagged the same imprecision, so the guide was reworded ("written with
  `country_isos` and queried with `filter[country]`"), mooting adjudication.

### Caught by the omission sweep (4 fixes, all in find-and-create)

1. The company index accepts neither `filter[parent_id]` nor `filter[source_type]`
   (public-catalog-only filters) — now stated explicitly (mechanical claims
   find-create-124/125 verify the absence).
2. Write bodies are strict (`additionalProperties: false`): unknown keys → 422, so
   don't echo response objects (`countries`, `seo`) into writes (find-create-126/127/128).
3. SEO write/read key asymmetry: write `search_engine_optimizer_attributes`, read
   `seo`; round-tripping doesn't apply (find-create-129/130).
4. Error body shape varies by status: 401 bare `{message}`, 403 bare `{error}`/`{message}`,
   only 404/422 wrapped (find-create-131..134).

## Omission-sweep facts explicitly accepted (not fixed)

| Fact (severity) | Rationale |
| --------------- | --------- |
| Delete semantics: category soft-delete vs collection hard-delete; child cascade undocumented (HIGH) | Deletion is outside all four pilot guide topics; the spec itself doesn't document cascade behavior. Flagged upstream; revisit when a delete guide is authored. |
| `filter[status]` matching stored vs resolved status for past-due scheduled rows (MED) | Spec is silent; guides must not assert either way. Flagged upstream for spec clarification. |
| `sort=position` offered on collections, which expose no `position` field (LOW) | Spec quirk, not a guide trap (guides already say collections omit position). Flagged upstream. |
| Metafields `id` present in CollectionWrite but absent in CategoryWrite (LOW) | Spec asymmetry; guides don't document per-item metafield updates. Flagged upstream. |
| Past `publish_at` with `status: scheduled` resolves published immediately (LOW) | Implied by the read-time resolution rule the guides already state. |
| ISO code validation unspecified; cycle/self-parent protection unspecified; `CategoryWrite.source_type` not enum-validated (LOW) | Spec is silent — nothing assertable without inventing behavior. |
| Misc envelope details: `seo` always present, `meta.request_id` nullable, lighthouse/compliance 202 envelope quirks (LOW) | Outside the four topics' task flows. |

## Third-vote record (12 subtle claims)

Two-verifier CONFIRMED claims flagged subtle went to a third refutation vote:

| Claims | Third vote | Final |
| ------ | ---------- | ----- |
| position semantics (hierarchy-012, -022) | CONFIRMED — pinned by Sort prose ("Default `position` then `id`", "manual position") | CONFIRMED 3-0 |
| strict bodies + SEO round-trip (find-create-126, -130) | CONFIRMED — forced by `additionalProperties: false` + documented 422 + write/read key split | CONFIRMED 3-0 |
| no publish endpoint / no unpublish-at / scheduled takedown (rename-publish-022, -037, -039) | CONFIRMED — forced by complete path enumeration + bounded write schema | CONFIRMED 3-0 |
| scope mapping (find-create-005, rename-publish-003) | CONFIRMED — bearer scheme prose L45-50 | CONFIRMED 3-0 |
| **has_children semantics (hierarchy-010, -027, -030)** | **UNSUPPORTED** — `has_children` has no description anywhere in the spec; "true = ≥1 child" rests on the field name alone, and a live-children-only reading is plausible on the public surface | **CONFIRMED 2-1** (majority holds; dissent recorded, upstream fix requested) |

## CI blocking demonstration

Simulated the hourly GCS sync delivering a spec where `page[limit]` max dropped 100 → 50
(contradicting the guide's documented pagination cap):

```
$ node eval/check-guide-claims.mjs --spec spec-mutated.yaml
[FAIL] find-create-058 api/guides/find-and-create-categories-and-collections.mdx:101 — param 'page[limit]' maximum 50 != asserted 100

=== SUMMARY ===
claims checked:            257
mechanical validated:      159
semantic (quote-only):     98
failures:                  1

VERDICT: FAIL — see failures above
```

Exit code 1 → the checker detects the contradiction and names the exact claim. In
`validate.yml` this blocks PRs that edit a guide without updating the registry
(quote-presence) or contradict the spec — that PR-level blocking is unchanged.
*Routing note:* at verification time the hourly spec sync also **quarantined** on
this failure. The sync has since moved to a **flow-and-flag** model — a valid spec
now commits and publishes to `main` unconditionally, and a claim conflict is
surfaced as a `guide-spec-conflict` issue plus a deliberately-red `main` CI (the
`validate.yml` run above, failing on the synced commit) rather than blocking the
sync. Only a `mint validate` failure still quarantines (on `spec-sync-blocked`). See
`eval/guide-truth.md` for current semantics; the detection demonstrated above is
unchanged.

## Upstream spec flags (for the backend contract owners)

1. **`custom_slug`** is structurally present in public response schemas (shared Category
   schema) while prose says it's omitted from the public surface — split the public and
   company response schemas or the generated reference will show a field public callers
   never receive.
2. **`has_children` and `position`** have no field descriptions; one line each would pin
   semantics the guides currently carry on a 2-1 vote (does `has_children` count
   non-live children?).
3. **`filter[status]`** — stored vs resolved status matching for past-due scheduled rows
   is undefined.
4. **Delete behavior** — child handling on category delete undocumented; category
   soft-delete vs collection hard-delete is easy to miss.
5. **Metafields write asymmetry** — CollectionWrite models `id` for update/destroy;
   CategoryWrite doesn't.
6. **`sort=position` on collections** — offered by the shared Sort param but collections
   expose no `position`.

## Reuse

The mechanism (schema, checker semantics, verification + sweep procedures, adoption
checklist for Phases 5–9) is documented in [`eval/guide-truth.md`](guide-truth.md).
One-off verifier verdict files are scratch artifacts; this report is the durable record.
