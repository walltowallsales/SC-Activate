# SellerChamp Item - Activate Listing V1.1

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

## V1.1 fix
- Corrected the activation request to SellerChamp's documented Product PUT format:
  `PUT /api/products/PRODUCT_ID.json?relist=true`
- Sends the required JSON wrapper: `{ "product": {} }`.
- Activation errors now display SellerChamp's returned error details instead of only a generic message.
- The app still rereads the Product and reports success only after `marketplace_status` verifies as `active`.
