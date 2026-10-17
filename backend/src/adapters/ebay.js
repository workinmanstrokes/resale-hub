// eBay adapter.
//  - Search: Browse API with an app (client-credentials) token.
//  - Categories: Taxonomy API getCategorySuggestions (app token).
//  - Publish: Inventory API with the *seller's own* OAuth token, using the seller's own
//    business policies and inventory location (fetched with the Account/Inventory APIs
//    after they connect, stored per user in Firestore — never a shared server config).
//
// Docs: https://developer.ebay.com/api-docs/buy/browse/overview.html
//       https://developer.ebay.com/api-docs/commerce/taxonomy/overview.html
//       https://developer.ebay.com/api-docs/sell/inventory/overview.html
//       https://developer.ebay.com/api-docs/sell/account/overview.html
//       https://developer.ebay.com/api-docs/commerce/media/overview.html (photo hosting)
//
//  - Photos: Media API createImageFromFile uploads each photo to eBay Picture Services
//    (EPS) with the seller's token. EPS hosting is free, so the app needs no Firebase
//    Storage bucket (which would require the Blaze plan).
const { env } = require('../lib/secrets');

const MARKETPLACE_ID = 'EBAY_US';

const USER_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
  'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
];

function cfg() {
  const sandbox = (process.env.EBAY_ENV || 'production').toLowerCase() === 'sandbox';
  const host = (name) => `https://${name}${sandbox ? '.sandbox' : ''}.ebay.com`;
  // Tests point every eBay host at a local fake server. Never set this in production.
  const override = (process.env.EBAY_BASE_URL_OVERRIDE || '').replace(/\/+$/, '');
  const pick = (name) => override || host(name);
  return {
    sandbox,
    environment: sandbox ? 'sandbox' : 'production',
    api: pick('api'),
    apiz: pick('apiz'),
    apim: pick('apim'),
    auth: pick('auth'),
    web: override || host('www'),
    clientId: env('EBAY_CLIENT_ID'),
    clientSecret: env('EBAY_CLIENT_SECRET'),
    ruName: env('EBAY_RUNAME'),
  };
}

function isConfigured() {
  const c = cfg();
  return Boolean(c.clientId && c.clientSecret);
}

function canConnect() {
  return isConfigured() && Boolean(cfg().ruName);
}

class EbayError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'EbayError';
    this.status = status;
    this.body = body;
  }
}

// Turn eBay's error JSON into one readable sentence for the app.
function describeEbayError(text) {
  try {
    const data = JSON.parse(text);
    const errs = data.errors || data.warnings || [];
    if (errs.length) {
      return errs
        .map((e) => e.longMessage || e.message)
        .filter(Boolean)
        .join(' ');
    }
    return data.error_description || data.error || text;
  } catch {
    return text;
  }
}

async function ebayFetch(path, { method = 'GET', token, body, headers = {}, okStatuses = [], base } = {}) {
  const c = cfg();
  const res = await fetch(`${base || c.api}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json', 'Content-Language': 'en-US' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok && !okStatuses.includes(res.status)) {
    throw new EbayError(describeEbayError(text) || `eBay request failed (${res.status})`, res.status, text);
  }
  return { status: res.status, data: text ? safeJson(text) : null };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function tokenRequest(params) {
  const c = cfg();
  const basic = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64');
  const res = await fetch(`${c.api}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
  });
  const text = await res.text();
  if (!res.ok) throw new EbayError(`eBay token request failed: ${describeEbayError(text)}`, res.status, text);
  return JSON.parse(text);
}

// ---- App token (search + taxonomy) -------------------------------------------------
let appToken = null; // { token, expiresAt }
async function getAppToken() {
  if (appToken && appToken.expiresAt > Date.now() + 60_000) return appToken.token;
  const data = await tokenRequest({
    grant_type: 'client_credentials',
    scope: 'https://api.ebay.com/oauth/api_scope',
  });
  appToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return appToken.token;
}

// ---- Search ------------------------------------------------------------------------
function mapCondition(ebayCondition) {
  if (!ebayCondition) return 'unknown';
  const n = ebayCondition.toLowerCase();
  if (n.includes('refurb')) return 'refurbished';
  if (n.includes('new')) return 'new';
  if (n.includes('used') || n.includes('pre-owned')) return 'used';
  return n;
}

async function search(query, { maxPrice, condition } = {}) {
  if (!isConfigured()) return [];
  const token = await getAppToken();
  const params = new URLSearchParams({ q: query, limit: '25' });
  if (maxPrice) params.set('filter', `price:[..${maxPrice}],priceCurrency:USD`);

  const { data } = await ebayFetch(`/buy/browse/v1/item_summary/search?${params}`, {
    token,
    headers: { 'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE_ID },
  });

  return (data?.itemSummaries || [])
    .map((item) => {
      const price = Number(item.price?.value ?? NaN);
      const ship = Number(item.shippingOptions?.[0]?.shippingCost?.value ?? 0);
      const shipping = Number.isFinite(ship) ? ship : 0;
      return {
        marketplace: 'ebay',
        title: item.title,
        price,
        currency: item.price?.currency || 'USD',
        condition: mapCondition(item.condition),
        shippingPrice: shipping,
        shippingKnown: Boolean(item.shippingOptions?.length),
        totalPrice: Number.isFinite(price) ? price + shipping : null,
        url: item.itemWebUrl,
        imageUrl: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || null,
        sourceId: item.itemId,
      };
    })
    .filter((r) => Number.isFinite(r.totalPrice))
    .filter((r) => !condition || r.condition === condition);
}

// ---- Categories (Taxonomy API) -----------------------------------------------------
let categoryTreeId = null;
async function getCategoryTreeId(token) {
  if (categoryTreeId) return categoryTreeId;
  const { data } = await ebayFetch(
    `/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${MARKETPLACE_ID}`,
    { token }
  );
  categoryTreeId = data.categoryTreeId;
  return categoryTreeId;
}

async function suggestCategories(query) {
  if (!isConfigured()) throw new EbayError('eBay is not configured on the server.', 503);
  const q = String(query || '').trim().slice(0, 350);
  if (!q) return [];
  const token = await getAppToken();
  const treeId = await getCategoryTreeId(token);
  const { data } = await ebayFetch(
    `/commerce/taxonomy/v1/category_tree/${treeId}/get_category_suggestions?q=${encodeURIComponent(q)}`,
    { token, okStatuses: [204] }
  );
  return (data?.categorySuggestions || []).slice(0, 10).map((s) => ({
    categoryId: s.category.categoryId,
    categoryName: s.category.categoryName,
    path: [...(s.categoryTreeNodeAncestors || [])]
      .reverse()
      .map((a) => a.categoryName)
      .concat(s.category.categoryName)
      .join(' > '),
  }));
}

// ---- Seller OAuth ------------------------------------------------------------------
function getAuthorizationUrl(state) {
  const c = cfg();
  const params = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.ruName,
    response_type: 'code',
    state,
    scope: USER_SCOPES.join(' '),
  });
  return `${c.auth}/oauth2/authorize?${params}`;
}

function exchangeCodeForToken(code) {
  return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: cfg().ruName });
}

function refreshAccessToken(refreshToken) {
  return tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: USER_SCOPES.join(' '),
  });
}

// eBay user id/username (Commerce Identity API) so Marketplace Account Deletion
// notifications can be matched to the Resale Hub user who connected that account.
async function getIdentity(token) {
  const res = await fetch(`${cfg().apiz}/commerce/identity/v1/user/`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return { userId: data.userId || null, username: data.username || null };
}

// ---- Seller account setup (Account API + Inventory locations) -----------------------
async function fetchSellerOptions(token) {
  const q = `marketplace_id=${MARKETPLACE_ID}`;
  const [fulfillment, payment, returns, locations] = await Promise.all([
    ebayFetch(`/sell/account/v1/fulfillment_policy?${q}`, { token, okStatuses: [404] }),
    ebayFetch(`/sell/account/v1/payment_policy?${q}`, { token, okStatuses: [404] }),
    ebayFetch(`/sell/account/v1/return_policy?${q}`, { token, okStatuses: [404] }),
    ebayFetch('/sell/inventory/v1/location?limit=100', { token, okStatuses: [404] }),
  ]);
  const pick = (list, idKey) =>
    (list || []).map((p) => ({ id: p[idKey], name: p.name || p[idKey] }));
  return {
    fulfillmentPolicies: pick(fulfillment.data?.fulfillmentPolicies, 'fulfillmentPolicyId'),
    paymentPolicies: pick(payment.data?.paymentPolicies, 'paymentPolicyId'),
    returnPolicies: pick(returns.data?.returnPolicies, 'returnPolicyId'),
    locations: (locations.data?.locations || [])
      .filter((l) => (l.merchantLocationStatus || 'ENABLED') === 'ENABLED')
      .map((l) => ({ id: l.merchantLocationKey, name: l.name || l.merchantLocationKey })),
  };
}

// Keep the user's current choice if it still exists, else default to the first option.
function chooseDefaults(options, current = {}) {
  const keep = (list, id) => (list.some((x) => x.id === id) ? id : list[0]?.id || null);
  return {
    fulfillmentPolicyId: keep(options.fulfillmentPolicies, current.fulfillmentPolicyId),
    paymentPolicyId: keep(options.paymentPolicies, current.paymentPolicyId),
    returnPolicyId: keep(options.returnPolicies, current.returnPolicyId),
    merchantLocationKey: keep(options.locations, current.merchantLocationKey),
  };
}

function missingSettings(settings = {}) {
  const labels = {
    fulfillmentPolicyId: 'shipping (fulfillment) policy',
    paymentPolicyId: 'payment policy',
    returnPolicyId: 'return policy',
    merchantLocationKey: 'item location',
  };
  return Object.keys(labels)
    .filter((k) => !settings[k])
    .map((k) => labels[k]);
}

async function createLocation(token, key, { postalCode, country }) {
  await ebayFetch(`/sell/inventory/v1/location/${encodeURIComponent(key)}`, {
    method: 'POST',
    token,
    body: {
      name: 'Resale Hub',
      location: { address: { postalCode, country } },
      locationTypes: ['WAREHOUSE'],
      merchantLocationStatus: 'ENABLED',
    },
    okStatuses: [204],
  });
}

// ---- Photos (Media API -> eBay Picture Services) -----------------------------------
// Returns { url, expiresAt }. EPS keeps images used in a live listing; unused ones
// expire on their own (eBay reports the date), so there is nothing for us to delete.
async function uploadImage(token, buffer, { mimeType = 'image/jpeg', filename = 'photo.jpg' } = {}) {
  const form = new FormData();
  form.append('image', new Blob([buffer], { type: mimeType }), filename);
  const res = await fetch(`${cfg().apim}/commerce/media/v1_beta/image/create_image_from_file`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    body: form, // fetch sets multipart/form-data with the boundary
  });
  const text = await res.text();
  if (!res.ok) {
    throw new EbayError(describeEbayError(text) || `eBay photo upload failed (${res.status})`, res.status, text);
  }
  let data = safeJson(text) || {};
  if (!data.imageUrl) {
    // Some responses only carry the Location header -> getImage for the URL.
    const location = res.headers.get('location');
    const imageId = location ? location.split('/').pop() : null;
    if (!imageId) throw new EbayError('eBay did not return a photo URL', 502, text);
    ({ data } = await ebayFetch(`/commerce/media/v1_beta/image/${encodeURIComponent(imageId)}`, {
      token,
      base: cfg().apim,
    }));
  }
  const url = data.imageUrl || data.maxDimensionImageUrl;
  if (!/^https:\/\//.test(url || '')) throw new EbayError('eBay did not return a photo URL', 502, text);
  return { url, expiresAt: data.expirationDate || null };
}

// ---- Publish -----------------------------------------------------------------------
// Inventory API condition enums (https://developer.ebay.com/api-docs/sell/inventory/types/slr:ConditionEnum)
const CONDITION_ENUM = {
  new: 'NEW',
  used: 'USED_GOOD',
  refurbished: 'SELLER_REFURBISHED',
};

function skuFor(listing) {
  return `RH-${listing.id}`.slice(0, 50);
}

async function publish(listing, { token, settings }) {
  const missing = missingSettings(settings);
  if (missing.length) {
    throw new EbayError(
      `Your eBay account is missing a ${missing.join(', ')}. Set it up in eBay Seller Hub (or add an item location in the app), then tap "Refresh eBay settings" on the Account tab.`,
      400
    );
  }
  if (!listing.ebayCategoryId) {
    throw new EbayError('Pick an eBay category for this listing first.', 400);
  }
  const imageUrls = (listing.photos || []).filter((u) => /^https:\/\//.test(u)).slice(0, 24);
  if (!imageUrls.length) {
    throw new EbayError('eBay requires at least one photo (hosted on https).', 400);
  }

  const sku = skuFor(listing);
  const description = (listing.description || listing.title).slice(0, 4000);

  await ebayFetch(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
    method: 'PUT',
    token,
    body: {
      condition: CONDITION_ENUM[listing.condition] || 'USED_GOOD',
      product: { title: listing.title.slice(0, 80), description, imageUrls },
      availability: { shipToLocationAvailability: { quantity: 1 } },
    },
    okStatuses: [204],
  });

  const offerBody = {
    sku,
    marketplaceId: MARKETPLACE_ID,
    format: 'FIXED_PRICE',
    availableQuantity: 1,
    categoryId: String(listing.ebayCategoryId),
    listingDescription: description,
    pricingSummary: { price: { value: Number(listing.price).toFixed(2), currency: 'USD' } },
    merchantLocationKey: settings.merchantLocationKey,
    listingPolicies: {
      fulfillmentPolicyId: settings.fulfillmentPolicyId,
      paymentPolicyId: settings.paymentPolicyId,
      returnPolicyId: settings.returnPolicyId,
    },
  };

  // Re-publishing (e.g. after an edit) updates the existing offer instead of failing
  // with "offer already exists".
  const existing = await ebayFetch(
    `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${MARKETPLACE_ID}`,
    { token, okStatuses: [404] }
  );
  let offerId = existing.data?.offers?.[0]?.offerId;
  if (offerId) {
    await ebayFetch(`/sell/inventory/v1/offer/${offerId}`, {
      method: 'PUT',
      token,
      body: offerBody,
      okStatuses: [204],
    });
  } else {
    const created = await ebayFetch('/sell/inventory/v1/offer', { method: 'POST', token, body: offerBody });
    offerId = created.data.offerId;
  }

  const { data: published } = await ebayFetch(`/sell/inventory/v1/offer/${offerId}/publish`, {
    method: 'POST',
    token,
  });

  return {
    externalId: published.listingId,
    offerId,
    sku,
    url: `${cfg().web}/itm/${published.listingId}`,
  };
}

// Deleting the inventory item also deletes its offers and ends any live listing.
async function endListing(token, sku) {
  await ebayFetch(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
    method: 'DELETE',
    token,
    okStatuses: [204, 404],
  });
}

module.exports = {
  key: 'ebay',
  label: 'eBay',
  get configured() {
    return isConfigured();
  },
  get capabilities() {
    return isConfigured() ? ['search', 'publish'] : [];
  },
  note: null,
  cfg,
  canConnect,
  EbayError,
  search,
  suggestCategories,
  getAuthorizationUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  fetchSellerOptions,
  getIdentity,
  chooseDefaults,
  missingSettings,
  createLocation,
  uploadImage,
  publish,
  endListing,
  skuFor,
};
