# Hosted docs checks

This directory holds the checks for Fluid's hosted Mintlify docs. It started as the
CURRENT-2424 Categories/Collections pilot and now covers the published API, SDK, and
theme surfaces.

Two independent things live here:

- **The guide truth gate** (Linear CURRENT-2587): `guide-claims.json` (claims registry
  for the task guides) and `check-guide-claims.mjs` (deterministic checker that runs in
  CI). See [guide-truth.md](guide-truth.md) for how the mechanism works, the durable
  verification decisions, and how new guides adopt it.
- **The hosted-docs checker** (`check-hosted-docs.mjs`): a deterministic, credential-free
  check that the answers to the natural-language prompts in `prompts.json` are
  discoverable through the hosted agent surface *and* correct where they are documented.

One-off run records (adversarial verification, omission sweeps, hosted-check runs) live
on the phase's Linear issue, not in the repo. Durable decisions go in `guide-truth.md`.

## No API key, anywhere

There was previously a graded eval (`run-eval.mjs`) that paid a model to sit the exam:
it called the Anthropic Messages API in both of its modes and required
`ANTHROPIC_API_KEY`. It has been deleted. Nothing in this directory calls a model or
needs a credential of any kind. Mintlify's `/mcp` endpoint is plain unauthenticated
HTTP, and every expectation in `prompts.json` is machine-checkable, so the check needs
no model and no key.

If you find yourself adding one, the change belongs somewhere else.

## The two stages, and why they are separate

Each prompt is graded twice, and the two results are counted and reported separately.

**Stage 1 — retrieval. Is the documenting page discoverable?** The checker calls the
hosted search tool with the prompt's own natural-language text:

```
POST <base>/mcp
content-type: application/json
accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":1,"method":"tools/call",
 "params":{"name":"search_fluid","arguments":{"query":"<the prompt>"}}}
```

The response is SSE; the checker concatenates the text entries from `result.content[]`.
(The endpoint also exposes `query_docs_filesystem_fluid` and `submit_feedback`; only
`search_fluid` is used. No session id or handshake is needed.) Stage 1 passes when the
page that documents the answer is among the returned pages.

**Stage 2 — contract. Is what that page documents correct?** The checker fetches the
page's full markdown at `<base>/<page>.md` and asserts against that.

Why not assert the contract against the search result directly? Because `search_fluid`
returns a **truncated slice** of each matching page. On a generated reference page the
`METHOD /path` contract line lives only in the page's opening chunk, so a query that
matches a deeper section gets back the right page with a slice that omits the path.
Asserting on the slice measures snippet luck rather than discoverability, and a failure
could not be read as either a ranking problem or a docs problem. Splitting the stages
makes every failure legible: stage 1 red is a discoverability problem, stage 2 red is a
correctness problem.

### How the documenting page is identified

- **API prompts** resolve mechanically. Every generated reference page carries its
  operation on one contract line — `/api-reference/payment-v2026-04.yaml post
  /api/payment/v2026-04/gateways` — so matching lowercase-method plus path against
  `llms-full.txt` names the owning page. There is no hand-maintained prompt-to-page
  mapping to drift. The method matters: `get` and `post` on one path are different pages.
  A templated path can legitimately resolve to more than one candidate (`{id}` wildcards
  over a literal sub-resource segment), and stage 1 passes on any of them.
- **Workflow prompts** declare `target_page` — a string, or an array where a workflow
  legitimately spans a guide plus the reference it points at. A workflow is not one
  operation, so nothing in the corpus identifies its owning page mechanically.

### What stage 2 checks

For API prompts, against the page's full markdown:

| Expectation | How it is matched |
| ----------- | ----------------- |
| `method`, `path` | Present on the page; `{template}` segments match one path segment. |
| `auth` | The inlined security requirement `- bearer_auth: []` ⇒ `bearer`, else `none`. |
| `required_query_params` | The inlined spec's parameter form, `name: page[limit]`. |
| `required_body_fields` | The schema-property form, `country_isos:`. |

A generated page inlines the operation's whole OpenAPI fragment, which is what makes
this stronger than prose matching. Two consequences worth knowing:

- **Auth is read from the spec, never from prose.** Every hosted page opens with an
  agent-instructions banner reading "Authenticate with the header `Authorization: Bearer
  <token>`", so a prose-based check would report `bearer` for all 57 API prompts. Only a
  security *requirement* counts, and it is distinguishable because the `securitySchemes`
  declaration renders without the leading dash.
- **Params and body fields are matched in their spec shapes**, not as bare words. `name:
  page[limit]` is evidence the operation declares the parameter; the words "the
  `page[limit]` parameter" in prose are not.

For workflow prompts, stage 2 checks `required_terms` and `forbidden_terms` as
case-insensitive literal substrings against the declared target page(s).

## How the two stages are gated — and why differently

They are not equally stable, so they are not gated the same way.

| | Gate | Why |
| --- | ---- | --- |
| **Stage 2 — contract** | **100%, no tolerance** | Deterministic: fixed assertions against a fetched page. Any failure is a real docs gap or a wrong expectation. |
| **Stage 1 — retrieval** | **Rate ≥ 90%** | Measures a live search engine's ranking, which can vary between runs. Gating per prompt would make the build a coin flip on borderline queries. |
| **Legacy leakage** | **Zero unsanctioned hits** | — |
| **Agent surface** | **All checks pass** | — |

The ≥ 90% floor is the project's own documented success metric ("pass rate ≥ 90%,
zero legacy-endpoint answers"), now applied to retrieval rather than to a model's
answers. **Every stage-1 miss is named in the output regardless of the rate**, so a
real regression stays visible instead of being absorbed by the tolerance — read the
`missed:` line on every run, not just the verdict.

A prompt that misses stage 1 but passes stage 2 is reported as `MISS`, not `FAIL`: the
answer is published and correct, search just did not rank its canonical page. A
stage-2 failure is always `FAIL`.

### Confirming a stage-1 miss before acting on it

Retrieval is the one part of this harness that is not fully deterministic, so **treat a
single stage-1 miss as a lead, not a verdict.** Re-run it on its own first:

```bash
node eval/check-hosted-docs.mjs --base https://docs.fluid.app --only checkout-create-subscription
```

To characterize the variance properly, `--repeat N` issues N queries per prompt and
reports each prompt's hit rate across them:

```bash
node eval/check-hosted-docs.mjs --base https://docs.fluid.app --only bundle --repeat 5
```

`--repeat` is **diagnostic only and never part of the gate.** The verdict always comes
from the first query of each prompt — one question per prompt, the way a real agent
would ask. This is deliberate: retrying until a page happens to rank would launder a
genuine discoverability weakness into a pass.

What the variance actually looks like today: the earlier snippet-based assertion was
visibly flaky (API passes moved 37 → 40 → 40 across three runs, and one prompt reported
1 then 4 missing terms). Fetching whole pages removed almost all of it. Four consecutive
full runs have returned the same 60/63 with the same three misses, and each of those
three misses reproduces 0/5 under `--repeat 5`. So a miss you see is far more likely to
be a stable ranking fact than noise — but confirm it anyway, because the cost is one
targeted run.

## Legacy leakage

`llms-full.txt`, every prompt's retrieved content, and every fetched target page are
scanned for `company/v1/`, `/api/v1/`, `v2025[-_]?06`, `v202506`, and `per_page`. Each
hit is attributed to the page carrying it. Four exceptions are sanctioned, each straight
out of AGENTS.md and each **scoped to one marker and one set of pages** — never to a
whole tag or a whole marker:

| Sanctioned | Marker | Scope |
| ---------- | ------ | ----- |
| The `llms-full.txt` agent-instructions banner | any | It names the legacy markers in order to forbid them. |
| `webhooks-v0` reference sections | `per_page` | That surface's list endpoints are genuinely offset-paginated. Prose pages get no such licence. |
| The seven verified offset `checkout-v2026-04` list pages, plus `customer-orders/list-customer-orders` for its response metadata | `per_page` | `OFFSET_PAGINATED_PAGES` — exact pages, because `directory`, `store`, and `subscriptions` also hold operations that do not paginate that way. |
| The 69 generated `public-v2025-06` reference pages and two framing pages | `v2025-06` / `v202506` only | `PUBLIC_SDK_V2025_06_PAGES` and `PUBLIC_SDK_V2025_06_PROSE_PAGES` — exact pages. The references carry the version in their contracts; the prose pages distinguish the SDK surface from the unrelated admin/partner API. |

Any other hit fails the run. Two properties of the last one are load-bearing. It is keyed
on the exact page, not a `v2025-06` pattern class, so the legacy admin/partner surface
(`admin-v2025-06`, `/api/v2025-06/*` — a different API) keeps failing. And three of that
spec's tags are **shared** with the v2026-04 surfaces — `carts` also holds 12
`checkout-v2026-04` pages, `orders` one, `paypal` four — so a `carts/` prefix would have
forgiven a real leak on 17 current pages. The page list is the `mint export` path
inventory (the regeneration command is in the source comment); an upstream summary edit
renames a page and drops it out of the set, which fails loudly rather than silently.

Two things this check learned the hard way:

- **The per-page agent banner has to be stripped first.** It says "Never use …
  `page`/`per_page` params" *and* lists every spec filename including
  `webhooks-v0.yaml`. Left in, it produced a `per_page` hit on all 57 fetched pages and
  simultaneously satisfied the webhooks-v0 sanction on all 57 — a check that fires
  everywhere and forgives everywhere. `stripAgentBanner` removes the leading block quote
  so each page is judged on its own content.
- **Coverage is bounded by the prompt set.** The scan sees `llms-full.txt` plus only the
  pages the 63 prompts retrieve or target — not the whole site. And `llms-full.txt` is
  terse for generated reference pages: one contract line and a description, without the
  parameter detail. That is why the two `per_page` leaks on `checkout-v2026-04` list
  operations surfaced only through `/mcp` and the fetched pages, and why more of that
  surface is likely affected than the two pages currently reported. See upstream spec
  gap #12 in `guide-truth.md`.

Leakage is reported once for the whole run rather than against the prompt whose search
happened to surface the offending page — a prompt should not fail for something it does
not test — but it still fails the run, and every hit prints with its page.

## Agent-surface checks

`llms.txt` must return 200 and list at least one page entry (the count is reported, so a
stub index is obvious). `llms-full.txt` must return 200 and be at least
`EVAL_LLMS_MIN_CHARS` long. Both report their size and `last-modified`.

## What this harness does NOT prove

- **It does not prove a model gets the answer right.** The old harness asked a model to
  answer each prompt from the docs and graded the answer. This one proves the answer is
  published, correct, and findable. Whether an agent reading it chooses correctly is out
  of scope.
- **Stage 1 is about the canonical page, not about "an answer being reachable."** A
  prompt fails stage 1 when the resolved documenting page does not rank, even if a
  different page that did rank happens to document the same operation. That is
  deliberate — but so the report stays honest, a stage-1 failure also says whether any
  page that *did* rank carries the contract, which distinguishes "search ranked the
  wrong page" from "nothing retrieved documents this".
- **The method check is weak in isolation.** An uppercase `GET` appears all over a docs
  corpus; the path carries the real signal. (The checker refuses to match a lowercase
  method as an English word — `\bget\b` would pass everything — and accepts lowercase
  only in the `…yaml get /api/…` contract form.)
- **Term matching is by substring.** Requiring `bundle_groups` is satisfied by
  `product_bundle_groups`; requiring `product.bundle_groups` is not. Expectations that
  must distinguish a current name from a legacy one have to spell out the distinguishing
  prefix.
- **`forbidden_terms` are only as good as the target page.** Page scoping made them
  meaningful again, but a term still cannot be forbidden on a page that legitimately
  prints it in a correction — see the two such cases recorded in `prompts.json` notes.
- **Stage 1 is a rate, so it tolerates up to 10% of prompts missing.** That is a
  deliberate trade against ranking variance, not a claim that every page is findable.
  The `missed:` line is the part to read. See "How the two stages are gated" above.

## Prerequisites

- **Node ≥ 20** (built-in `fetch`; zero npm dependencies).
- A **deployed Mintlify site**. `llms.txt`, `llms-full.txt`, `/mcp`, and the `.md` page
  endpoints exist **only on the hosted deploy**, not in the local working tree, so the
  checker takes the deploy's base URL as config. You cannot run it against an undeployed
  branch.

## Usage

```bash
# Full run against the production deploy
node eval/check-hosted-docs.mjs --base https://docs.fluid.app

# Cheap targeted run — only prompts whose id contains the substring
node eval/check-hosted-docs.mjs --base https://docs.fluid.app --only bundle
node eval/check-hosted-docs.mjs --base https://docs.fluid.app --only cart-payment

# Base URL from the environment instead
EVAL_DOCS_BASE_URL=https://fluid-docs.mintlify.app node eval/check-hosted-docs.mjs
```

| Setting | Kind | Default | Notes |
| ------- | ---- | ------- | ----- |
| `--base <url>` / `EVAL_DOCS_BASE_URL` | required | — | Deploy base URL. Trailing slashes are stripped. |
| `--only <substring>` | optional | — | Filter prompts by id substring. |
| `--repeat <n>` | optional | `1` | Query each prompt n times and report ranking variance. Diagnostic only — never gated. |
| `EVAL_CONCURRENCY` | optional | `4` | Parallel searches in flight. |
| `EVAL_LLMS_MIN_CHARS` | optional | `100000` | Size floor for `llms-full.txt`. |

Target pages are fetched once each and shared across prompts, so a full run makes 63
search calls plus roughly 57 page fetches.

## The CDN cache trap

Hosted `llms` files and `.md` pages are served with `cache-control: max-age=86400`, so a
plain request can return a copy generated **before** the most recent deploy. Grading that
copy reports failures against pages that are already live. Every fetch therefore sends
no-cache headers plus a cache-busting query parameter, and the llms responses log their
`last-modified` so each run records which revision it checked. **Check that timestamp
before trusting a failure.** Verifying by byte size alone will fool you: a cached copy
and a fresh one can differ while looking equally plausible.

The old harness had an `EVAL_LLMS_CHAR_BUDGET`, because it fed `llms-full.txt` to a model
and had to bound the context window. That is gone: this checker only scans the document,
and truncating a scan would silently reduce coverage. What replaces it is a floor rather
than a ceiling — `EVAL_LLMS_MIN_CHARS`, failing loudly if the document comes back shorter
than expected, since that means the leakage scan covered less than the published corpus.
The document's size is still reported on every run (~412k characters as of the Phase 9.6
migrations).

## Where this runs — local only, never CI

The hosted checker is a **manual check you run locally. It is not wired into CI and must
not be**, because it depends on a live deploy: on a pull request the content under test
has not shipped yet, so a run would grade the previous revision. Run it after a deploy,
typically once per migration phase, and record the run on the phase's Linear issue.

CI (`.github/workflows/validate.yml`) runs only deterministic, offline checks that need
no credentials and no deploy: `mint validate`, `check-guide-claims.mjs` and its self-test,
and this directory's unit tests (`*.test.mjs`). **Nothing in CI requires an API key** —
and now nothing in this directory does either.

## Expected-answer schema (`prompts.json`)

API-call prompts omit `expected.type`; every field is checked:

```jsonc
{
  "id": "cat-public-list",
  "prompt": "<natural-language developer question>",
  "expected": {
    "method": "GET|POST|PATCH|PUT|DELETE",
    "path": "/api/v202604/company/categories/{id}",   // templated
    "auth": "none" | "bearer",
    "required_query_params": ["filter[country]"],      // optional
    "required_body_fields": ["title"]                  // optional
  },
  "notes": "<spec citation / rationale>"
}
```

Workflow prompts declare their target page and use required and forbidden terms:

```jsonc
{
  "id": "sdk-enrollment-bundle-selections",
  "prompt": "<natural-language workflow question>",
  "expected": {
    "type": "workflow",
    "target_page": "sdk/cart-api",         // or ["page-a", "page-b"]
    "required_terms": ["addEnrollmentPack", "bundleSelections", "bundled_items"],
    "forbidden_terms": ["bundle_selections"]
  },
  "notes": "<evidence / rationale>"
}
```

The set currently holds 63 prompts: 57 API-call prompts and 6 workflow prompts.

## Output & exit code

- **stdout** — the agent-surface checks, the legacy scan, stage-1 and stage-2 counts,
  then every failure tagged with the stage that failed and its precise reason. A stage-1
  failure also names the resolved page it wanted, the pages search actually returned, and
  whether any of those returned pages documents the operation anyway.
- **`results/<timestamp>-hosted.json`** — full per-prompt detail. `results/` is
  git-ignored (root `.gitignore`); **never** write run output anywhere else in the repo.
- **exit code** — `0` only when **all four** gates hold: stage 2 is 100%, the stage-1
  retrieval rate is at or above 90%, every surface check passed, and there are no
  unsanctioned legacy hits. `1` otherwise. An errored prompt counts as a stage-2 failure,
  since its contract was never checked.

## Unit tests

The pure helpers in `check-hosted-docs.mjs` are exported and characterized by
`check-hosted-docs.test.mjs` using Node's built-in test runner (`node:test` +
`node:assert/strict`) — zero dependencies, no network, no credentials.
`check-hosted-docs.mjs` only runs its `main()` when executed directly, so importing it
for tests has no side effects.

```bash
cd eval && node --test                        # scans eval/, runs only *.test.mjs
node --test eval/check-hosted-docs.test.mjs   # or target the file directly
```

CI runs this with `eval/` as the working directory — a bare `node --test eval/` directory
positional is not usable on Node 22.x. The network layer (the `/mcp` POST, the page and
agent-file fetches, the retry pool) is deliberately untested here: it needs a live deploy
and is exercised by real runs.

## Maintaining the prompt set

Verify every new API prompt against its authoritative synced spec. Verify SDK and theme
workflow prompts against the published target plus the durable evidence in
`guide-truth.md`, and give each one a `target_page` you have confirmed carries every
required term.

**Never cite spec line numbers in a note.** The specs re-sync hourly, so a line reference
rots even when it starts correct, and a stale one lands the next reader on the wrong
operation — which is worse than no citation, because it invites confirming the wrong
fact. An audit during the CURRENT-2711 rebuild found every checkable line citation in
this file stale (32 of 32) and rewrote all 47 affected notes. Cite what survives a
re-sync: the `operationId`, the schema name, the literal declaration (`security: []`,
`required: - items`), or the published page path. Keep required terms specific enough to prove discovery without requiring
incidental prose, and specific enough to distinguish a current name from a legacy one.
Use forbidden terms only for names genuinely absent from the target page — a page that
prints a name in order to correct it cannot forbid it.
