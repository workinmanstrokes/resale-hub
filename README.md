# Resale Hub

A mobile "selling hub" that combines two things:

1. **Sell**: create a listing once, then publish it out to multiple marketplaces from one dashboard.
2. **Search**: search a product and see results aggregated across marketplaces, ranked by total price, to find the best deal.

## What's real vs. what's not (important)

This app only talks to marketplaces that actually publish free, accessible developer APIs:

| Marketplace | Search | Publish (list an item) | Why |
|---|---|---|---|
| **eBay** | ✅ real (Browse API) | ✅ real (Sell API, needs OAuth) | Free developer program |
| **Etsy** | ✅ real (Open API v3) | ❌ | Etsy doesn't grant listing-creation scope to typical third-party apps |
| Facebook Marketplace, Poshmark, Mercari, OfferUp, Depop | ❌ | ❌ | No public developer API exists |

The unsupported marketplaces are **not** faked with sample data — they show up in the app clearly labeled "not available" with the reason why. The adapter architecture (`server/src/adapters/`) makes it straightforward to plug one in for real if you ever get partner/API access to one of them.

Search and publish both degrade gracefully: if you haven't added an API key for a marketplace, it's just skipped (and the UI tells you which sources were skipped and why) instead of erroring out.

## Project layout

```
server/   Node/Express API: auth, listings, marketplace adapters, search aggregation
mobile/   Expo (React Native) app: Search, Sell, My Listings, Account tabs
```

## Running it

### 1. Server

```
cd server
npm install
cp .env.example .env
```

Edit `.env`:
- `JWT_SECRET`: any long random string.
- `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET`: free at https://developer.ebay.com — sign up, create an application keyset. Use `EBAY_ENV=sandbox` while testing, `production` for real listings/search.
- `EBAY_REDIRECT_URI`: register this exact URL in your eBay app's OAuth settings (the "Your auth accepted URL" / RuName config). Defaults to `http://localhost:4000/api/ebay/oauth/callback`.
- `ETSY_API_KEY`: free at https://www.etsy.com/developers — register an app to get a keystring.

Then:
```
npm run dev
```
The server listens on `http://localhost:4000` and logs which marketplaces are configured on startup.

To actually publish a listing to eBay, the seller's eBay account also needs **business policies** (payment/return/fulfillment) set up once on eBay's side, and you'll need to set `EBAY_MERCHANT_LOCATION_KEY`, `EBAY_FULFILLMENT_POLICY_ID`, `EBAY_PAYMENT_POLICY_ID`, `EBAY_RETURN_POLICY_ID` in `.env` (find these via eBay's Account API or Seller Hub). This is an eBay-side requirement, not something this app can automate. If they're missing, the app surfaces eBay's own error message.

### 2. Mobile app

```
cd mobile
npm install
npx expo start
```

Open it in **Expo Go** on your phone (scan the QR code) — make sure your phone is on the same Wi-Fi network as the machine running the server, since the app auto-detects the dev machine's LAN IP from the Expo dev server connection (see `mobile/src/api/config.js`). If you're using an Android emulator or iOS simulator on the same machine as the server, that also works out of the box.

### Try it without any API keys

The app runs fine with zero marketplace keys configured:
- **Search** will show "Skipped: eBay, Etsy" with the reason (not configured) and an empty result list.
- **Sell → Publish** will let you pick any marketplace and will report an honest status for each (`not configured`, `not available`, etc.) rather than pretending it worked.

Add `ETSY_API_KEY` and/or eBay credentials to `.env` and restart the server to see real search results flow in.

## Data storage

The server uses a small JSON-file store (`server/data/*.json`, gitignored) — enough for an MVP with no native build dependencies. Swap in Postgres/Prisma before this goes anywhere near production or multiple concurrent users.
