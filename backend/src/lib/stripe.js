// Stripe client + store configuration for the Resale Hub direct-sale website.
//
// All secrets come from environment variables only — nothing secret is ever
// stored in code or in a file in this repo:
//   STRIPE_SECRET_KEY        Stripe secret key (sk_test_... while testing,
//                            sk_live_... when selling for real)
//   STRIPE_WEBHOOK_SECRET    Signing secret for the /storefront/webhook endpoint
//   STORE_SELLER_UID         Firebase Auth UID of the seller (Mike)
//   STORE_URL                Public URL of the storefront, e.g.
//                            https://resale-hub-6a648.web.app (no trailing /)
//   STORE_SHIPPING_FLAT_CENTS  Optional flat shipping charge in cents, e.g. 899.
//                            If unset, no shipping is charged at checkout and
//                            the order is marked shipping "to arrange".
//   STORE_SHIP_COUNTRIES     Optional comma list, default "US".
//
// The Stripe SDK is required lazily so the API still boots when Stripe is
// not installed or not configured yet; checkout then answers 503 with a
// plain-English message instead of crashing or faking a checkout.
let stripeClient = null;

function isCheckoutConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function getStripe() {
  if (!isCheckoutConfigured()) return null;
  if (!stripeClient) {
    // Lazy require: `npm install stripe` adds the dependency; the rest of
    // the API works without it.
    stripeClient = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

function getStoreConfig() {
  const flat = Number(process.env.STORE_SHIPPING_FLAT_CENTS || 0);
  return {
    sellerUid: process.env.STORE_SELLER_UID || '',
    storeUrl: (process.env.STORE_URL || '').replace(/\/$/, ''),
    shippingFlatCents: Number.isFinite(flat) && flat > 0 ? Math.round(flat) : 0,
    shipCountries: (process.env.STORE_SHIP_COUNTRIES || 'US')
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean),
  };
}

module.exports = { isCheckoutConfigured, getStripe, getStoreConfig };
