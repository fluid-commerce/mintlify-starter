---
name: fluid
description: Use when building on or helping someone use Fluid, the We-Commerce platform for direct sales teams. Covers the REST API, the FairShare SDK, storefront themes, portal widgets, Droplets and the Fluid admin portal, and points to the right docs page for each.
metadata:
  author: fluid-commerce
  version: "1.0"
---

# Fluid

Fluid is a We-Commerce platform for merchants and direct sales teams. It connects the storefront, rep attribution (FairShare), payments, checkout and customer identity in one system.

The docs at https://docs.fluid.app are the source of truth. When this file and a docs page differ, follow the docs page. When the docs don't cover something, say so instead of guessing.

## Where to look

| Task | Start here |
| --- | --- |
| Use the admin portal: Settings screens, the page editor | https://docs.fluid.app/help/admin |
| Contact Fluid support | https://docs.fluid.app/help/getting-help |
| Build a first integration | https://docs.fluid.app/quickstart |
| Understand the platform: We-Commerce, FairShare, Droplets, checkout | https://docs.fluid.app/platform-overview |
| Add attribution and a cart to a website (FairShare SDK) | https://docs.fluid.app/sdk/overview |
| Build or customize a storefront theme (Liquid) | https://docs.fluid.app/themes/overview |
| Build Portal Definitions and Widget Packages | https://docs.fluid.app/portal-widgets/overview |
| Call the REST API | https://docs.fluid.app/api/overview, then the task guides under https://docs.fluid.app/api/guides |

## REST API conventions

- **Hosts:** company endpoints use `https://api.fluid.app`, where the token identifies the company. Public storefront endpoints use `https://{company}.fluid.app`.
- **Version:** the label is `v2026-04` in prose; the path segment is `/api/v202604/...`.
- **Authentication:** send `Authorization: Bearer <token>`. Token types are company API tokens, partner tokens, and public tokens, which start with `pub-` and are for client-side use.
- **Pagination:** lists use cursor pagination with `page[cursor]` and `page[limit]`. Follow `meta.pagination.next_cursor` until it's null. The generated reference names the few operations that paginate differently.
- **Parameters and schemas:** read the generated API Reference page for the operation. Don't infer fields.
- **Legacy paths:** never use `company/v1` or `/api/v1/` paths; no current docs cover them.

## FairShare SDK

Install with one script tag. `data-fluid-shop` is the only required attribute:

```html
<script
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
