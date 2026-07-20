# Agent-eval harness — CURRENT-2424 (Categories/Collections pilot)

This directory holds the agent-eval harness for the **Categories/Collections pilot on
Mintlify** (Linear CURRENT-2424).

It also holds the **guide truth gate** (Linear CURRENT-2587): `guide-claims.json`
(claims registry for the task guides) and `check-guide-claims.mjs` (deterministic
checker that runs in CI). See [guide-truth.md](guide-truth.md) for how the mechanism
works, the durable verification decisions, and how new guides adopt it. One-off run
records (adversarial verification, omission sweeps) live on the phase's Linear
issue, not in the repo.

## Purpose

The bet behind CURRENT-2424 is that publishing the Fluid Storefront API docs to a
Mintlify site — with a hosted agent surface (`llms.txt`, `llms-full.txt`, and a
search `/mcp` endpoint) — lets a coding agent pick the **correct canonical API call**
for a natural-language task, without ever seeing the OpenAPI spec directly.

The success metric: on a natural-language eval set, an agent using **only** the
published docs surface must select the correct canonical call —

- **pass rate ≥ 90%**, and
- **zero legacy-endpoint answers** (no `company/v1`, `/api/v1/`, `v2025-06`/`v202506`,
  or `per_page`).

`eval/prompts.json` is the **pilot subset** (10 prompts, Categories + Collections
only) of an eventual **fixed 25-prompt** set. Every expected answer was verified
against `api-reference/storefront-v2026-04.yaml` in this repo.

## Prerequisites

- **Node ≥ 20** (uses built-in `fetch`; zero npm dependencies).
- An **Anthropic API key** (`ANTHROPIC_API_KEY`).
- A **deployed Mintlify site** that exposes the agent surface. The `llms.txt`,
  `llms-full.txt`, and `/mcp` endpoints exist **only on the hosted deploy**, not in
  the local working tree — so the runner takes the deploy's base URL as config
  (`EVAL_DOCS_BASE_URL`). You cannot run the eval end-to-end until the pilot site is
  deployed.

## Configuration (environment variables)

| Var                 | Required | Default          | Notes |
| ------------------- | -------- | ---------------- | ----- |
| `ANTHROPIC_API_KEY` | yes      | —                | Anthropic Messages API key. |
| `EVAL_DOCS_BASE_URL`| yes      | —                | Deploy base URL, no trailing slash (e.g. `https://fluid-docs.mintlify.app`). |
| `EVAL_MODE`         | no       | `mcp`            | `mcp` (hosted search MCP connector) or `llms` (fetch `llms-full.txt`). |
| `EVAL_MODEL`        | no       | `claude-sonnet-5`| The agent-under-test model. |
| `EVAL_CONCURRENCY`  | no       | `2`              | Parallel prompts in flight. |

## Usage

```bash
# MCP mode (default) — agent answers using the hosted docs search MCP tools
ANTHROPIC_API_KEY=sk-ant-... \
EVAL_DOCS_BASE_URL=https://fluid-docs.mintlify.app \
node eval/run-eval.mjs

# llms mode — agent answers from llms-full.txt (fallback llms.txt) as context
ANTHROPIC_API_KEY=sk-ant-... \
EVAL_DOCS_BASE_URL=https://fluid-docs.mintlify.app \
EVAL_MODE=llms \
node eval/run-eval.mjs

# Override model / concurrency
EVAL_MODEL=claude-opus-4-8 EVAL_CONCURRENCY=4 \
ANTHROPIC_API_KEY=sk-ant-... EVAL_DOCS_BASE_URL=https://fluid-docs.mintlify.app \
node eval/run-eval.mjs
```

### The two modes

- **`mcp`** — calls the Anthropic Messages API with the **MCP connector**
  (`mcp_servers: [{type:"url", url:"<base>/mcp", name:"fluid-docs"}]`, beta header
  `anthropic-beta: mcp-client-2025-04-04`). The connector runs the docs search
  tool-use loop server-side; the runner reads the final text block. This is the
  closest match to how a real coding agent consumes the hosted docs.
- **`llms`** — fetches `<base>/llms-full.txt` (falling back to `<base>/llms.txt`),
  truncates to ~150k chars, and passes it as context in the user message. A cheaper,
  MCP-independent sanity check of the same docs content.

Both modes use the same system prompt: the model is a coding agent that must answer
**only** from the docs surface, search before answering, and reply with strict JSON.

## Expected-answer schema (`prompts.json`)

Each prompt entry:

```jsonc
{
  "id": "cat-public-list",
  "prompt": "<natural-language developer question>",
  "expected": {
    "method": "GET|POST|PATCH|PUT|DELETE",
    "path": "/api/v202604/company/categories/{id}",   // templated
    "auth": "none" | "bearer",
    "required_query_params": ["filter[country]", "..."],  // optional
    "required_body_fields": ["title", "..."]              // optional
  },
  "notes": "<spec citation / rationale>"
}
```

The model is asked to reply with:

```json
{"method": "...", "path": "...", "query_params": {}, "body": {}, "auth": "none|bearer"}
```

## Grading rules (pure code — no LLM judge)

A prompt **PASSES** when all of the following hold:

1. **method** matches (case-insensitive).
2. **path** matches the template: static segments must match exactly; each
   `{placeholder}` segment accepts any non-empty segment in the answer (a concrete
   value such as `summer-sale`/`4821`, or the placeholder echoed back). Host and
   trailing slash are ignored.
3. **auth** matches (`none` vs `bearer`, normalized).
4. **all `required_query_params`** are present as names in the answer's
   `query_params`. Names are collected recursively, so both `{"filter[country]":…}`
   and `{"filter":{"country":…}}` satisfy a required `filter[country]`.
5. **all `required_body_fields`** are present as names anywhere in the answer's
   `body` (collected recursively, so a `category`/`collection` wrapper is fine).

Separately, the harness scans the **entire raw response** for legacy patterns:
`company/v1/`, `/api/v1/`, `v2025[-_]?06`, `v202506`, `per_page`. Any hit flags the
prompt as a **legacy answer** — a hard fail counted separately from correctness.

On an API error after retries (2 retries with exponential backoff on 429/5xx/network
errors), the prompt is marked **ERRORED** (not failed) and the run continues.

## Output & exit code

- **stdout** — one line per prompt (`id`, `PASS`/`FAIL`/`ERROR`, `+LEGACY` when
  flagged, expected vs got), then a summary with pass rate, legacy count, and
  explicit verdict lines:
  - `pass rate >= 90%: yes/no`
  - `legacy answers == 0: yes/no`
- **`results/<timestamp>-<mode>.json`** — full per-prompt detail (raw JSON, reasons,
  stop reason). `results/` is git-ignored (root `.gitignore`).
- **exit code** — `0` only when pass rate ≥ 90% **and** legacy answers == 0 **and**
  no prompt ERRORED; `1` otherwise.

## Unit tests

The pure grading and parsing helpers in `run-eval.mjs` (`normalizePath`,
`isParamSegment`, `pathMatches`, `flattenNames`, `normalizeAuth`, `scanLegacy`,
`gradeOne`, `extractJson`, `parseAnyObject`, `extractFinalText`, `isRetryableStatus`)
are exported and characterized by `run-eval.test.mjs` using Node's built-in test
runner (`node:test` + `node:assert/strict`) — zero dependencies. `run-eval.mjs` only
runs its `main()` when executed directly, so importing it for tests has no side
effects.

```bash
cd eval && node --test               # scans eval/, runs only *.test.mjs
node --test eval/run-eval.test.mjs   # or target the file directly
```

CI runs this in `validate.yml` (with `eval/` as the working directory — a bare
`node --test eval/` directory positional is not supported on Node 22.x). The
network/orchestration layer (Anthropic requests, MCP connector, retry pool) is
deliberately untested here — it needs a live deploy and is exercised by real eval runs.

## Growing to the full 25-prompt set

The pilot is 10 prompts scoped to Categories + Collections. Later phases extend
`prompts.json` toward the fixed 25-prompt set by adding coverage for the other
published surfaces, following the same `expected`-schema and spec-verification
discipline:

- **auth-v0** — token/session acquisition and the bearer-auth flow.
- **webhooks** — `categories.deleted` / `collections.deleted` subscription and
  payload-shape tasks.
- **checkout surfaces** — cart, payments, and subscription canonical calls.

Each new prompt must be verified against the authoritative spec before it is added,
and the acceptance criteria (≥ 90% correct, zero legacy answers) hold for the full
set, not just the pilot.
