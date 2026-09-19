// eBay adapter: Browse API for search (app-level client-credentials token, no user
// login needed) and Sell API for publishing to a seller's own account (needs the
// 3-legged OAuth consent flow completed via routes/ebayOAuth.js).
//
// Docs: https://developer.ebay.com/api-docs/buy/browse/overview.html
//       https://developer.ebay.com/api-docs/sell/inventory/overview.html

const ENV = (process.env.EBAY_ENV || 'production').toLowerCase();
const IS_SANDBOX = ENV === 'sandbox';

const HOSTS = IS_SANDBOX
  ? {
      api: 'https://api.sandbox.ebay.com',
      auth: 'https://auth.sandbox.ebay.com',
    }
  : {
      api: 'https://api.ebay.com',
      auth: 'https://auth.ebay.com',
    };

const CLIENT_ID = process.env.EBAY_CLIENT_ID;
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const REDIRECT_URI = process.env.EBAY_REDIRECT_URI;

const configured = Boolean(CLIENT_ID && CLIENT_SECRET);

let cachedAppToken = null; // { token, expiresAt }

async function getAppToken() {
  if (cachedAppToken && cachedAppToken.expiresAt > Date.now() + 30_000) {
    return cachedAppToken.token;
  }

  const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${HOSTS.api}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`eBay app token request failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  cachedAppToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedAppToken.token;
}

function mapCondition(ebayCondition) {
  if (!ebayCondition) return 'unknown';
  const normalized = ebayCondition.toLowerCase();
  if (normalized.includes('new')) return 'new';
  if (normalized.includes('refurb')) return 'refurbished';
  if (normalized.includes('used')) return 'used';
  return normalized;
}

async function search(query, { maxPrice, condition } = {}) {
  if (!configured) return [];

  const token = await getAppToken();
  const params = new URLSearchParams({ q: query, limit: '25' });

  const filters = [];
  if (maxPrice) filters.push(`price:[..${maxPrice}]`, 'priceCurrency:USD');
  if (filters.length) params.set('filter', filters.join(','));

  const res = await fetch(
    `${HOSTS.api}/buy/browse/v1/item_summary/search?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`eBay search failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const items = data.itemSummaries || [];

  return items
    .map((item) => {
      const price = Number(item.price?.value ?? NaN);
      const shipping = Number(
        item.shippingOptions?.[0]?.shippingCost?.value ?? 0
      );
      const itemCondition = mapCondition(item.condition);
      return {
        marketplace: 'ebay',
        title: item.title,
        price,
        currency: item.price?.currency || 'USD',
        condition: itemCondition,
        shippingPrice: Number.isFinite(shipping) ? shipping : 0,
        totalPrice: Number.isFinite(price) ? price + (Number.isFinite(shipping) ? shipping : 0) : null,
        url: item.itemWebUrl,
        imageUrl: item.image?.imageUrl || null,
        sourceId: item.itemId,
      };
    })
    .filter((r) => Number.isFinite(r.totalPrice))
    .filter((r) => !condition || r.condition === condition);
}

function getAuthorizationUrl(state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    state,
    scope: [
      'https://api.ebay.com/oauth/api_scope',
      'https://api.ebay.com/oauth/api_scope/sell.inventory',
      'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
    ].join(' '),
  });
  return `${HOSTS.auth}/oauth2/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${HOSTS.api}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`eBay code exchange failed (${res.status}): ${body}`);
  }
  return res.json(); // { access_token, refresh_token, expires_in, ... }
}

async function refreshUserToken(refreshToken) {
  const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${HOSTS.api}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: 'https://api.ebay.com/oauth/api_scope/sell.inventory',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`eBay token refresh failed (${res.status}): ${body}`);
  }
  return res.json(); // { access_token, expires_in, ... }
}

async function publish(listing, userAuth) {
  if (!configured) {
    throw new Error('eBay is not configured (missing EBAY_CLIENT_ID/SECRET).');
  }
  if (!userAuth?.refreshToken) {
    throw new Error(
      'This account has not connected eBay yet. Complete the "Connect eBay" step first.'
    );
  }

  const { access_token: accessToken } = await refreshUserToken(userAuth.refreshToken);
  const sku = `RH-${listing.id}`;

  const inventoryRes = await fetch(
    `${HOSTS.api}/sell/inventory/v1/inventory_item/${sku}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Language': 'en-US',
      },
      body: JSON.stringify({
        condition: (listing.condition || 'USED').toUpperCase(),
        product: {
          title: listing.title,
          description: listing.description,
          imageUrls: listing.photos || [],
        },
        availability: {
          shipToLocationAvailability: { quantity: 1 },
        },
      }),
    }
  );
  if (!inventoryRes.ok) {
    const body = await inventoryRes.text();
    throw new Error(`eBay createOrReplaceInventoryItem failed (${inventoryRes.status}): ${body}`);
  }

  // Creating an offer requires business policies (fulfillment/payment/return) that
  // the seller must have already set up on their eBay account. We surface eBay's
  // own error verbatim if that's missing, rather than guessing policy IDs.
  const offerRes = await fetch(`${HOSTS.api}/sell/inventory/v1/offer`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Content-Language': 'en-US',
    },
    body: JSON.stringify({
      sku,
      marketplaceId: 'EBAY_US',
      format: 'FIXED_PRICE',
      availableQuantity: 1,
      categoryId: listing.ebayCategoryId || '99',
      listingDescription: listing.description,
      pricingSummary: { price: { value: String(listing.price), currency: 'USD' } },
      merchantLocationKey: process.env.EBAY_MERCHANT_LOCATION_KEY,
      listingPolicies: {
        fulfillmentPolicyId: process.env.EBAY_FULFILLMENT_POLICY_ID,
        paymentPolicyId: process.env.EBAY_PAYMENT_POLICY_ID,
        returnPolicyId: process.env.EBAY_RETURN_POLICY_ID,
      },
    }),
  });
  if (!offerRes.ok) {
    const body = await offerRes.text();
    throw new Error(`eBay createOffer failed (${offerRes.status}): ${body}`);
  }
  const offer = await offerRes.json();

  const publishRes = await fetch(
    `${HOSTS.api}/sell/inventory/v1/offer/${offer.offerId}/publish`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!publishRes.ok) {
    const body = await publishRes.text();
    throw new Error(`eBay publishOffer failed (${publishRes.status}): ${body}`);
  }
  const published = await publishRes.json();

  return {
    externalId: published.listingId,
    url: `https://www.${IS_SANDBOX ? 'sandbox.' : ''}ebay.com/itm/${published.listingId}`,
  };
}

module.exports = {
  key: 'ebay',
  label: 'eBay',
  capabilities: configured ? ['search', 'publish'] : [],
  configured,
  search,
  publish,
  getAuthorizationUrl,
  exchangeCodeForToken,
  refreshUserToken,
};
