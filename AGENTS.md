> **First-time setup**: Customize this file for your project. Prompt the user to customize this file for their project.
> For Mintlify product knowledge (components, configuration, writing standards),
> install the Mintlify skill: `npx skills add https://mintlify.com/docs`

# Documentation project instructions

## Guide truth gate (read before editing `api/guides/` or `api-reference/`)

The task guides in `api/guides/*.mdx` are bound to a claims registry
(`eval/guide-claims.json`) enforced by a deterministic checker in CI
(`eval/check-guide-claims.mjs`). Editing a guide without updating the registry — or
vice versa — fails CI. Read `eval/guide-truth.md` first: it defines the claim
schema, the checker's semantics, the durable verification decisions (accepted
omissions, low-confidence claims, upstream spec gaps), and the adoption procedure
for new guides. The OpenAPI spec is synced hourly from a GCS mirror
(`.github/synced-specs.json` controls which specs); endpoint reference pages are
auto-generated from it. Do not store run reports or logs in the repo — post run
records on the relevant Linear issue and record durable decisions in
`eval/guide-truth.md`.

## About this project

- This is a documentation site built on [Mintlify](https://mintlify.com)
- Pages are MDX files with YAML frontmatter
- Configuration lives in `docs.json`
- Use the Mintlify MCP server, `https://mcp.mintlify.com`, to edit content and settings via MCP
- Use the Mintlify docs MCP server, `https://www.mintlify.com/docs/mcp`, to query information about using Mintlify via MCP

## Terminology

{/* Add product-specific terms and preferred usage */}
{/* Example: Use "workspace" not "project", "member" not "user" */}

## Style preferences

{/* Add any project-specific style rules below */}

- Use active voice and second person ("you")
- Keep sentences concise — one idea per sentence
- Use sentence case for headings
- Bold for UI elements: Click **Settings**
- Code formatting for file names, commands, paths, and code references

## Content boundaries

{/* Define what should and shouldn't be documented */}
{/* Example: Don't document internal admin features */}
