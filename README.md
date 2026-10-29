# Fluid documentation

This repository is the source for [docs.fluid.app](https://docs.fluid.app): Fluid's Help Center, developer docs, theme docs and API reference. It's built with [Mintlify](https://mintlify.com).

## Read these first

- [`AGENTS.md`](AGENTS.md): the house rules for everyone who edits these docs, people and AI tools alike. It covers where pages go, terminology, style, and what must never be hand-edited.
- [`eval/guide-truth.md`](eval/guide-truth.md): how the guide-claims gate works, the verification decisions already made, and what to do when the API sync reports a conflict.
- [`eval/README.md`](eval/README.md): what each check in `eval/` does.

## Where pages go

The site has four tabs. A page's URL is its file path, and `docs.json` decides where it appears in the navigation. Every new page needs a `docs.json` entry in the same PR.

| Tab | Audience | Where the files live |
| -- | -- | -- |
| **Help Center** | Merchants, admins and reps | `help/**`, plus `introduction.mdx`, the site's landing page |
| **Developer Platform** | Developers building on Fluid | `quickstart.mdx`, `platform-overview.mdx`, `concepts/`, `guides/`, `storefront/`, `setup/`, `sdk/`, `mist-apps/`, `portal-widgets/` and `migration/` |
| **Themes** | Theme developers | `themes/**` |
| **API Reference** | API integrators | `api/**`, plus the generated `api-reference/**` |

A few pages appear in a different tab from most of their folder, so `docs.json` is the final word. `AGENTS.md` has the detailed rules, such as how Help Center URLs mirror admin routes and where hub pages sit.

## Preview locally

You need Node.js 22. From the repository root, where `docs.json` is:

```bash
npx --yes mint@4.2.930 dev
```

Then open `http://localhost:3000`. The version matches the one CI uses, so what you see matches what CI checks.

## Run the checks before you open a PR

CI runs `.github/workflows/validate.yml` on every pull request and on every push to `main`. Run the same gating steps locally, from the repository root:

```bash
npx --yes mint@4.2.930 validate
node eval/generate-api-nav.mjs --check
node eval/check-guide-claims.mjs --self-test
node eval/check-advertised-docs-links.mjs
(cd eval && node --test)
node eval/check-guide-claims.mjs
node eval/check-broken-links.mjs
```

These steps check:

- **`mint validate`:** the site configuration and the generated API references.
- **`generate-api-nav.mjs --check`:** the API Reference sidebar matches its rules.
- **`check-advertised-docs-links.mjs`:** every docs URL the Fluid admin links to still points at a page in the navigation. Those URLs are pinned in `eval/advertised-docs-links.json`. To move one, see "Pinned URLs" in `AGENTS.md`.
- **The claims checks:** the guide-claims self-test and the claims check itself. See the next section.
- **`check-broken-links.mjs`:** internal links, anchors, snippets and redirect destinations.

CI also reports broken external links (`node eval/check-broken-links.mjs --external`), but that step never fails the build.

## The guide-claims gate

The task guides under `api/guides/` and `storefront/`, and the guided setup pages, make factual claims about the API. Each claim is registered in `eval/guide-claims.json`, and `eval/check-guide-claims.mjs` checks every one against the synced API specs. If you change one of these guides without updating the registry, or the other way around, CI fails. Read [`eval/guide-truth.md`](eval/guide-truth.md) before you edit them.

Help Center pages aren't covered by the gate. Check each one against the current product before you publish it.

## Generated files: never edit them by hand

- **`api-reference/*.yaml`** (OpenAPI specs) and **`sdk-artifacts/`** (TypeDoc files) are copied in from public mirrors. To add or remove one, edit [`.github/synced-api-references.json`](.github/synced-api-references.json).
- **The API Reference tab in `docs.json`** is generated from the synced specs, following the rules in [`.github/api-reference-nav.json`](.github/api-reference-nav.json). To change it, edit those rules and run `node eval/generate-api-nav.mjs`.

The [sync workflow](.github/workflows/sync-generated-api-references.yml) runs every hour, and you can also run it manually. It:

1. fetches every reference listed in `.github/synced-api-references.json`;
2. regenerates the API Reference sidebar;
3. runs `mint validate` and, if it passes, commits the changes to `main`;
4. checks the guide claims against the new specs, and opens or updates an issue labeled `guide-spec-conflict` if any claim no longer holds.

If validation fails, the change is held on a `reference-sync-blocked` pull request instead of reaching `main`, and the run fails. Read "CI wiring" and "Resolving a conflict" in [`eval/guide-truth.md`](eval/guide-truth.md) before you change the sync or resolve a conflict.

## How changes go live

1. Open a pull request. The validate workflow runs on it.
2. Once it's reviewed and the checks pass, merge it into `main`.
3. Mintlify's GitHub app deploys `main` to docs.fluid.app automatically.

There's no separate release step.

## Pull request conventions

- **Commit messages and PR titles** use [Conventional Commits](https://www.conventionalcommits.org/) with a scope, for example `docs(help): add the Contacts guide` or `docs(api): explain which cart operations need a token`.
- **Linear issues** go in the PR description, for example "Part of ENG-1234". Keep issue IDs out of branch names and PR titles: Linear can move the issue to Done when such a PR merges.
- **Say how you checked the change,** for example which checks you ran and which pages you looked at in the local preview.
- **This repository is public.** Keep customer names and data, internal code names and file paths, and security details out of pages, commits and PR descriptions.
- **One topic per PR** where you can, so reviews stay quick. If another open PR also edits `docs.json`, whichever merges second merges `main` in first.
