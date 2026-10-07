---
name: fluid
description: Use when building on or helping someone use Fluid, the We-Commerce platform for direct sales teams. Covers the REST API, the FairShare SDK, storefront themes, portal widgets, Droplets and the Fluid admin portal, and points to the right docs page for each.
metadata:
  author: fluid-commerce
  version: "1.2"
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
| Use Fluid's public Mist skills and workflows, in Mist or another agent | https://docs.fluid.app/guides/mist-skills |
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
| Upline, downline | Genealogy | `/api/company/v2026-10/genealogy/...` |

## Use the current endpoint

Some areas have more than one generation of endpoints, and search can rank an older one first.

- **Members:** use the member APIs. The older `/reps` endpoints are being retired, and only member management returns `member_type`.
- **Themes:** list and read themes with `/api/v202604/themes` and `/api/v202604/themes/active`. Use `/api/application_themes/*` and `/api/application_theme_templates/*` only for templates and theme resources, which v2026-04 doesn't cover. `/api/application_theme_templates/mysite_themes` is for MySite themes only. Don't use `/api/legacy_themes`.

## Platform pitfalls

- **Storefront themes already load the FairShare SDK** from a Global Embed that Fluid manages. Never add, move or remove the SDK script in a theme.
- **Checkout is a separate app.** A theme renders the storefront and cart; nothing in it can change checkout.
- **Order totals across currencies:** each order's `amount` is in its own `currency_code`. Sum `amount_in_base`, which is always US dollars, converted at the rate saved on the order: https://docs.fluid.app/concepts/order-currency
- **Theme facts** that break a storefront without an error (block rendering, which settings Fluid resolves, `localization` instead of `request`): https://docs.fluid.app/themes/common-pitfalls

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
- **Attribution:** `FairShareSDK.getAttribution()`.
- **Signatures and options:** https://docs.fluid.app/sdk/cart-api

## Fluid CLI

Use only commands the CLI reference pages list. If a command isn't on those pages, it doesn't exist.

- **Themes** (https://docs.fluid.app/themes/cli): `fluid login`, `fluid theme init`, `fluid theme pull`, `fluid theme dev`, `fluid theme push`.
- **Portal Definitions** (https://docs.fluid.app/portal-widgets/portal-definitions/cli-reference): `fluid portal pull`, `fluid portal dev`, `fluid portal doctor` (reports drift in generated project files), `fluid portal push`, `fluid portal version`.
- **Widget Packages** (https://docs.fluid.app/portal-widgets/widget-packages/cli-reference): `fluid widget create`, `fluid widget dev`, `fluid widget validate`, `fluid widget build`, `fluid widget publish`.

## Admin portal help

- Help Center URLs mirror admin routes: the admin's `/settings/taxes` screen is documented at https://docs.fluid.app/help/admin/settings/taxes.
- Settings open from the **Settings** gear in the admin's top bar. The Settings sidebar groups screens under **Company**, **Commerce**, **Payments** and **System**.
