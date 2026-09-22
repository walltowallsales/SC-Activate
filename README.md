# SellerChamp Item - Activate Listing V1.3

A completely independent SellerChamp app for finding a Product by SKU and relisting it when SellerChamp reports the marketplace listing as inactive.

## Workflow
1. Scan or enter SKU.
2. The app reads the SellerChamp Product and shows photo, SKU, title, quantity/location when available, and marketplace status.
3. Active listings are clearly marked ACTIVE.
4. Inactive listings get an ACTIVATE LISTING button.
5. Activation requires a confirmation.
6. The server sends SellerChamp's relist request and then rereads the Product several times.
7. Success is shown only after SellerChamp reports `marketplace_status` as `active`.

## SellerChamp API
- Lookup: `/api/products.json?sku=SKU`
- Product detail: `/api/products/PRODUCT_ID.json`
- Relist: `PUT /api/products/PRODUCT_ID?relist=true`
- SellerChamp token is server-side only.

## GitHub / Render
This is intentionally independent. Put only this folder's contents into its own GitHub repository and create a separate Render Web Service/Blueprint.

Render environment variables:
- `SELLERCHAMP_API_TOKEN` — your SellerChamp API token.
- `APP_PIN` — optional app PIN. When configured, successful browser authorization lasts 30 days.

The included `render.yaml` uses:
- Build: `npm install`
- Start: `npm start`

Do not put your SellerChamp API token in `public/`.

## V1.3 fix
- Corrected the activation request to SellerChamp's documented Product PUT format:
  `PUT /api/products/PRODUCT_ID.json?relist=true`
- Sends the required JSON wrapper: `{ "product": {} }`.
- Activation errors now display SellerChamp's returned error details instead of only a generic message.
- The app still rereads the Product and reports success only after `marketplace_status` verifies as `active`.

## V1.3 diagnostic activation build
This release is intentionally an isolated diagnostic test bed.

When Activate Listing is pressed, the server tests several relist request shapes one at a time.
After every attempt it rereads the SellerChamp Product. It STOPS immediately if
`marketplace_status` becomes `active`.

The phone UI displays:
- diagnostic method name
- HTTP result
- SellerChamp response body
- marketplace status after the attempt
- which method, if any, verified ACTIVE

This is designed to identify the exact SellerChamp request format before activation code is
copied into any other app.

## V1.3 timed diagnostic behavior
- Rejected request (HTTP error such as 400): record the response and move to the next request shape.
- Accepted request (2xx): STOP sending relist requests immediately.
- After an accepted request, reread marketplace status every 10 seconds for up to 5 minutes.
- If ACTIVE appears, record the activation time and successful method.
- If still inactive after 5 minutes, report Pending/Not Yet Active and do not send another relist request.
- Diagnostic display includes accepted/rejected state and the timed status-check history.

This avoids accidentally issuing several relist requests while SellerChamp/eBay is still processing the first accepted request.

## V1.4 critical relist correction
SellerChamp's current API reference documents `PUT /api/products/PRODUCT_ID.json?relist=true`
with a `product` JSON object. V1.3 also echoed `marketplace_status: "inactive"` in that
payload. V1.4 removes marketplace_status entirely from activation requests.

Method A sends only the existing SKU inside `product` with `relist=true`.
If A is immediately rejected, Method B tests SellerChamp's documented bulk product update
with top-level `relist: true`. Once any request is accepted, no second relist is sent and
the app polls status every 10 seconds for up to five minutes.
