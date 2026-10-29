---
name: fluid
description: Use when building on or helping someone use Fluid, the We-Commerce platform for direct sales teams. Covers the REST API, the FairShare SDK, storefront themes, portal widgets, Droplets and the Fluid admin portal, and points to the right docs page for each.
metadata:
  author: fluid-commerce
  version: "1.5"
---

# Fluid

Fluid is a We-Commerce platform for merchants and direct sales teams. It connects the storefront, rep attribution (FairShare), payments, checkout and customer identity in one system.

The docs at https://docs.fluid.app are the source of truth. When this file and a docs page differ, follow the docs page. When the docs don't cover something, say so instead of guessing.

## Where to look

| Task | Start here |
| --- | --- |
| Use the admin portal: Settings screens, the page editor | https://docs.fluid.app/help/admin |
| Collect extra details at enrollment checkout (forms, after payment, per country) | https://docs.fluid.app/guides/checkout-forms, then https://docs.fluid.app/help/admin/forms |
| Contact Fluid support | https://docs.fluid.app/help/getting-help |
| Sign a merchant up and launch a store as an agent | https://docs.fluid.app/api/agent-signup, then https://docs.fluid.app/api/agent-launch |
| Connect an AI agent: docs MCP server, Fluid CLI, Mist | https://docs.fluid.app/guides/connect-ai-tools |
| Build a first integration | https://docs.fluid.app/quickstart |
| Work with the storefront API: resources, slugs, visibility, SEO, translations | https://docs.fluid.app/storefront/overview |
| Act for one signed-in member, or manage a company's members | https://docs.fluid.app/api/member-apis |
| Understand the platform: We-Commerce, FairShare, Droplets, checkout | https://docs.fluid.app/platform-overview |
| Add attribution and a cart to a website (FairShare SDK) | https://docs.fluid.app/sdk/overview |
| Build or customize a storefront theme (Liquid) | https://docs.fluid.app/themes/overview |
| Use Mist, Fluid's AI assistant desktop app | https://docs.fluid.app/help/mist |
| Build, host or troubleshoot a Mist app: hosting, database, env vars, integration points, domains, billing | https://docs.fluid.app/mist-apps/overview |
| Use Fluid's public Mist skills and workflows, in Mist or another agent | https://docs.fluid.app/guides/mist-skills |
| Call Exigo's API or query its SQL replica from a droplet or Mist app, including through Fluid's egress proxy | https://docs.fluid.app/sdk/exigo-sdk, then https://docs.fluid.app/mist-apps/egress-proxy |
| Decide between a Fluid theme and a headless front end | https://docs.fluid.app/themes/why-fluid-themes |
| Build Portal Definitions and Widget Packages | https://docs.fluid.app/portal-widgets/overview |
| Call the REST API | https://docs.fluid.app/api/overview, then the task guides under https://docs.fluid.app/api/guides |

## Names that differ

Customers use industry words for things Fluid names differently. Search the docs and the API with Fluid's name.

| Someone says | Fluid calls it | Start here |
| --- | --- | --- |
| Promo code, coupon | Discount | `/api/v2025-06/discounts` |
| Autoship | Subscription | `/api/v2025-06/subscriptions` |
| Starter kit | Enrollment pack | `/api/enrollment_packs` |
| Distributor, consultant, affiliate, rep | Member. A company can name one of its member types "Rep". | https://docs.fluid.app/api/member-apis |
| Replicated site | The storefront home page credited to a member: `https://{company}.fluid.app/{username}` | https://docs.fluid.app/themes/supported-paths |
| Rep site | MySite | https://docs.fluid.app/help/admin/settings/default-mysite |
| Upline, downline | Genealogy | `/api/company/v2026-10/genealogy/...`, or the `fluid genealogy` CLI: https://docs.fluid.app/api/genealogy-cli |

## Use the current endpoint

Some areas have more than one generation of endpoints, and search can rank an older one first.

- **Members:** use the member APIs. The older `/reps` endpoints are being retired, and only member management returns `member_type`.
- **Droplets:** find, create, update and install droplets with the company API at `/api/company/v2026-10/droplets` and `/api/company/v2026-10/droplet-installations`. Get or rotate a droplet's webhook secret with `POST /api/company/v2026-10/droplets/{uuid}/webhook-secret-rotations`: it returns the new secret once, and Fluid signs with it from then on. The unversioned `/api/droplets` and `/api/droplet_installations` endpoints will soon be deprecated.
- **Themes:** list and read themes with `/api/v202604/themes` and `/api/v202604/themes/active`. Use `/api/application_themes/*` and `/api/application_theme_templates/*` only for templates and theme resources, which v2026-04 doesn't cover. `/api/application_theme_templates/mysite_themes` is for MySite themes only. `/api/legacy_themes` is the MySite theme API that `fluid mysite` uses, where a saved change goes live at once; never use it for storefront themes.

## Before you build a Droplet

- **Search the app store first.** When someone wants a new capability, `GET /api/company/v2026-10/droplets?q=<the outcome, in plain words>` returns the droplets their company can install, most relevant first. If one fits, offer to install it (`POST /api/company/v2026-10/droplets/{uuid}/installations`, after they approve) instead of building a one-off.
- **Fill in the listing of a droplet you create.** Write a one-line `summary`, an HTML `description` of what it really does, a `logo_url`, and `features` (a `title` with a screenshot `image_url` or a `video_url` each) with `PATCH /api/company/v2026-10/droplets/{uuid}`. A droplet with an empty listing is hard to find: https://docs.fluid.app/guides/creating-droplets

## Ads

- **Start here:** https://docs.fluid.app/api/guides/ads walks the whole flow (connect, choose the ad account, images, launch, results) with every failure type. https://docs.fluid.app/help/mist/run-ads is what the merchant sees; follow its order and wording.
- **Facebook and Instagram ads:** connect Meta once with `fluid channels connect meta --open`; the one login grants catalog, WhatsApp and ads access. Then choose the ad account the company advertises from: `GET /api/v202506/company/ads/meta/ad-accounts` lists the ad accounts and Pages Meta shared, and `PUT /api/v202506/company/ads/meta/ad-account` saves the choice, using only ids from that list: https://docs.fluid.app/setup/sales-channel-meta#choose-the-ad-account-for-ads
- **Google Ads:** the Google connection (`fluid channels connect google --open`) covers Merchant Center and Google Ads in one login. `GET /api/v202506/company/ads/google/ad-accounts` lists the Google Ads accounts it reaches, and `PUT /api/v202506/company/ads/google/ad-account` saves one that is enabled and not a manager account.
- **Ad images:** when the product has no image at a placement's ratio, `POST /api/v202506/company/ads/images` with `prompt`, `aspect_ratio` (`1:1`, `4:5`, `9:16` or `1.91:1`) and `product_id` queues a generation billed to the company's AI credits; poll `GET /api/v202506/company/ads/images/{id}` until `completed`, and use each image's DAM `url` as a Meta ad's `image_url`. Ask before generating.
- **Launching:** after the user approves the ads, `POST /api/v202506/company/ads/meta/launches` creates a paused Traffic campaign with up to five link ads, and `POST /api/v202506/company/ads/google/launches` creates a paused Search campaign with a responsive search ad. Fluid checks every line of copy first and refuses flagged copy (`claims_blocked`). Campaigns are always created paused in the merchant's own ad account, which bills them; the user switches them on in Ads Manager or Google Ads. Never say an ad is live. Send an `idempotency_key` (a hash of the approved ads) so a retry returns the first launch instead of a second campaign; `409` `launch_in_progress` means check the ad account before launching with a new key. Branch on `error.details.type`, never the message. To report how a launch is doing, `GET /api/v202506/company/ads/{meta,google}/launches/{id}/insights` returns its live status, spend, impressions, clicks, CTR and CPC for `since`/`until` (default: launch date to today).

## Platform pitfalls

- **Storefront themes already load the FairShare SDK** from a Global Embed that Fluid manages. Never add, move or remove the SDK script in a theme.
- **Checkout is a separate app.** A theme renders the storefront and cart; nothing in it can change checkout.
- **Order totals across currencies:** each order's `amount` is in its own `currency_code`. Sum `amount_in_base`, which is always US dollars, converted at the rate saved on the order: https://docs.fluid.app/concepts/order-currency
- **Theme facts** that break a storefront without an error (block rendering, which settings Fluid resolves, `localization` instead of `request`, `request.design_mode` to detect the editor): https://docs.fluid.app/themes/common-pitfalls

## REST API conventions

- **Hosts:** company endpoints use `https://api.fluid.app`, where the token identifies the company. Public storefront endpoints use `https://{company}.fluid.app`.
- **Version:** the label is `v2026-04` in prose; the path segment is `/api/v202604/...`. The member API and genealogy use `v2026-10`, with the version after the surface: `/api/member/v2026-10/...` and `/api/company/v2026-10/...`. Write each path exactly as its page shows it.
- **Authentication:** send `Authorization: Bearer <token>`. Token types are company API tokens, partner tokens, public tokens and droplet installation tokens. Public tokens start with `pub-` and are for client-side use. Droplet installation tokens start with `dit_` and let a droplet act for one company that installed it. Member APIs take the member's own credential as the Bearer token instead.
- **Pagination:** lists use cursor pagination with `page[cursor]` and `page[limit]`. Follow `meta.pagination.next_cursor` until it's null. The generated reference names the few operations that paginate differently.
- **Parameters and schemas:** read the generated API Reference page for the operation. Don't infer fields.
- **Legacy paths:** prefer the newest version of an operation. Use an older path, such as `company/v1` or `/api/v1/`, only when no newer version covers the task. The Messaging API is current at `/api/v1/messaging/*`; its operations are in the API Reference.

## FairShare SDK

On a site Fluid doesn't host, install with one script tag. `data-fluid-shop` is the only required attribute, and the script must keep `type="module"`. Fluid storefront themes already load it, so don't add it there.

```html
<script
  type="module"
  id="fluid-cdn-script"
  src="https://assets.fluid.app/scripts/fluid-sdk/latest/web-widgets/index.js"
  data-fluid-shop="your-shop-id"
></script>
```

- **Cart:** add items with `addCartItems()` and change them with `updateCartItems()`, both on `window.FairShareSDK`. Then call `FairShareSDK.checkout()` to send the shopper to Fluid checkout.
- **Carts fill in the background.** `addCartItems()` resolves with the filled cart, or `undefined` if the fill fails. Never use `createCart()` to read data: it creates a new empty cart and replaces the shopper's. Use `getCountryCode()`. A theme with its own cart sidebar follows https://docs.fluid.app/themes/custom-cart-drawer. A custom add button calls `FairShareSDK.cart.control.open()` at the click.
- **Attribution:** `FairShareSDK.getAttribution()`.
- **Signatures and options:** https://docs.fluid.app/sdk/cart-api

## Fluid CLI

Use only commands the CLI reference pages list. If a command isn't on those pages, it doesn't exist.

- **Sign up** (https://docs.fluid.app/api/agent-launch#step-1-sign-up-confirm-the-email-and-sign-in): `fluid signup --email <email> --first-name <first> --last-name <last> --company-name <name> --subdomain <subdomain> --yes --json`. With the merchant's consent only; it creates a real company.
- **Sign in** (https://docs.fluid.app/guides/connect-ai-tools#fluid-cli): `fluid login`. With no terminal, run `fluid login --send-code --email <email> --shop <shop>`, then `FLUID_LOGIN_CODE=<code> fluid login --code --email <email> --yes --json`. `--yes` replaces a CLI profile with the company's name; `--name <profile>` keeps it, as the steps `fluid signup` prints do. Or `FLUID_TOKEN=<token> fluid login`.
- **Products** (https://docs.fluid.app/api/agent-launch#step-5-set-up-the-catalog-and-store-settings): `fluid products create --title <title> --price <price> --yes`, from `@fluid-app/fluid-cli-products`, once signed in. The product stays a draft unless `--publish`.
- **Test order** (https://docs.fluid.app/api/agent-launch#place-a-test-order): `fluid payments test-order --product <id> --yes`, from `@fluid-app/fluid-cli-payments`, signed in as a person (not an API token). If it stops with `AGREEMENTS_NOT_ACCEPTED`, read the agreement titles it lists to the merchant, then rerun with `--accept-agreements`; otherwise that first run placed the order. It pays only the test gateway and stops otherwise, but the order is real: emails, webhooks, and sales reports until refunded. On `ORDER_OUTCOME_UNKNOWN`, check the admin before running it again.

- **Themes** (https://docs.fluid.app/themes/cli): `fluid login`, `fluid theme init`, `fluid theme pull`, `fluid theme dev`, `fluid theme lint`, `fluid theme push`, `fluid theme crawl`. Which theme a push lands on: https://docs.fluid.app/themes/cli#choose-the-theme-a-command-uses
- **MySite themes** (https://docs.fluid.app/themes/mysite-themes#work-on-a-theme-with-the-cli): `fluid mysite list`, `fluid mysite pull`, `fluid mysite dev`, `fluid mysite publish`. A publish changes every MySite on that theme at once.
- **Media** (https://docs.fluid.app/api/dam-upload#upload-from-the-command-line): `fluid assets upload`.
- **Guided setups** (https://docs.fluid.app/setup/overview): `fluid setup list`, `fluid setup show`, `fluid setup run`.
- **Publishing live:** never publish a theme, MySite or portal unless the user asks for that publish: https://docs.fluid.app/guides/connect-ai-tools#keep-agents-from-publishing-on-their-own
- **Portal Definitions** (https://docs.fluid.app/portal-widgets/portal-definitions/cli-reference): `fluid portal pull`, `fluid portal dev`, `fluid portal doctor` (reports drift in generated project files), `fluid portal push` (`--yes --activate` without prompts: https://docs.fluid.app/portal-widgets/portal-definitions/cli-reference#push-without-prompts), `fluid portal version`.
- **Widget Packages** (https://docs.fluid.app/portal-widgets/widget-packages/cli-reference): `fluid widget create`, `fluid widget dev`, `fluid widget validate`, `fluid widget build`, `fluid widget push` (publish with this; it also records your source), `fluid widget publish`.
- **Mist apps** (https://docs.fluid.app/mist-apps/quickstart): `fluid mist create`, `fluid mist clone`, `fluid mist open`, `fluid mist push`, `fluid mist show`, `fluid mist deployments`, `fluid mist logs`, `fluid mist env list`, `fluid mist env set`, `fluid mist env unset`, `fluid mist env pull`, `fluid mist staging`, `fluid mist attach`, `fluid mist droplet repair`, `fluid mist droplet reinstall` (https://docs.fluid.app/mist-apps/troubleshooting#reinstall-a-droplet), `fluid mist droplet egress-proxy`, `fluid mist restore`. Mist app custom domains have no CLI command; `fluid domains` manages storefront domains only.

## Admin portal help

- Help Center URLs mirror admin routes: the admin's `/settings/taxes` screen is documented at https://docs.fluid.app/help/admin/settings/taxes.
- Settings open from the **Settings** gear in the admin's top bar. The Settings sidebar groups screens under **Company**, **Commerce**, **Payments** and **System**.

## Native member widgets

- Native widgets are Fluid supplied Liquid sections rendered on the server; Droplet widgets require the supplying Droplet. Existing member storefront availability, deployed native templates, and supported live actions must be verified before publishing. Preserve the 8px grid, at most two font families / three sizes / three weights across all four variants, theme inset and concentric radii, four cell footprints, visible focus, honest unavailable states, and inert previews. Treat each Purpose/Data/Tap/Adapt entry as design intent until its live source and action are verified. Use the catalog names, sizes, configuration and preview rules at https://docs.fluid.app/themes/member-storefront/native-widgets.

- For the pending independent native bundles, keep Liquid to server-rendered markup/settings and escaped instance data. Each `native/widgets/<key>/` bundle follows the Droplet theme-extension format: `fluid.extension.toml` (`type = "theme"`, required name, optional version), the current catalog primary `sections/<key>/index.liquid` plus arbitrarily named additional sections, optional used blocks/components, and its own assets/locales. Keep existing primary `fluid://native/widgets/<bundle>` aliases; named sections use `fluid://native/widgets/<bundle>/sections/<section>` only when declared and released. Do not create empty placeholder directories; any number and names of CSS, JavaScript, images, fonts, and other files are allowed. The owning section must explicitly reference needed resources through the current bundle's sealed `asset_url` resolution, using `stylesheet_tag` / `script_tag: defer: true` for CSS/JS. API calls and needed helpers/runtime live in that bundle's JavaScript files, with bundle-local state and no cross-bundle assets or dependencies. No automatic inclusion, filename inference, or script-fetch loader. Confirm release and synchronization; preserve supported-action limits. See the native-widget guide above.

- For action-enabled native widgets (pending release; confirm deployment first), follow the conditional usage section in that guide: Photos needs a real authorized Library public UUID in scalar `photoPlaylistId`, then Prepare and a separate Share gesture. Verify each action release, member eligibility, actual persisted result, and inert previews; never infer message delivery, discounts, or reward credit from a success label.

## Private Droplet reads

- Use the common Droplet UUID selector for member-page browser queries and authenticated Member API applications after their backend/SDK releases. Copy the actual management API public `uuid`; do not invent a database UUID or automatically connect a native widget to a Droplet. Browser calls retain cookie/CSRF, site and existing member-storefront flag checks; Member API calls use supported member credentials. Both require an active company-scoped Droplet installation and signed-backend read permissions. Keep bearer credentials out of Liquid. Use canonical `data_url` after deployment, with `widget_data_url` as its deprecated compatibility alias: https://docs.fluid.app/themes/member-storefront/droplet-data.

## Portal worker Droplet reads

- For a Portal widget that reads its member through a Droplet, follow https://docs.fluid.app/portal-widgets/widget-packages/droplet-data first. Use the built-in `queryDropletData({ dropletUuid, operation, params? })`, declare it in `uses`, and verify the SDK release, deployed bound-context backend and package-version capability approval. No custom host project is required once upgraded. Workers must not read host CSRF, fetch the authenticated Portal endpoint directly, persist private results, or use the member-storefront helper. Implement application-owned read-only receiver operations and verify the exact signed member echo.

## Build and troubleshoot Portal widgets

- Start with https://docs.fluid.app/portal-widgets/widget-packages/company-quickstart and use https://docs.fluid.app/portal-widgets/widget-packages/troubleshooting when a stage fails. Work in the Portal project, verify SDK support, and distinguish package publication from screen placement, exact-version capability approval and Portal publication. Test the actual signed-in Portal before claiming completion; report pending authoring steps explicitly.
