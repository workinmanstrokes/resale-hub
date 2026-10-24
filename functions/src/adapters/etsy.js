// Etsy adapter: Open API v3, search only. Third-party apps aren't granted a
// listing-creation scope by default, so there's no honest "publish" to offer here.
// Since Feb 9, 2026 every request needs `x-api-key: <keystring>:<shared secret>`.
// Docs: https://developer.etsy.com/documentation/reference/#operation/findAllListingsActive
//       https://developer.etsy.com/documentation/reference/#operation/getListingsByListingIds
const { env } = require('../lib/secrets');

const BASE_URL = 'https://openapi.etsy.com/v3/application';

function apiKeyHeader() {
  const key = env('ETSY_API_KEY');
  const secret = env('ETSY_SHARED_SECRET');
  if (!key || !secret) return null;
  return key.includes(':') ? key : `${key}:${secret}`;
}

function money(m) {
  if (!m) return null;
  const v = Number(m.amount) / Number(m.divisor || 100);
  return Number.isFinite(v) ? { value: v, currency: m.currency_code || 'USD' } : null;
}

// Cheapest first-item shipping price to the US from the listing's shipping profile.
// Returns null when the profile has no US (or worldwide) destination.
function usShipping(profile) {
  const dests = profile?.shipping_profile_destinations || [];
  const candidates = dests.filter(
    (d) => d.destination_country_iso === 'US' || (!d.destination_country_iso && d.destination_region === 'none')
  );
  const prices = candidates.map((d) => money(d.primary_cost)?.value).filter((v) => Number.isFinite(v));
  return prices.length ? Math.min(...prices) : null;
}

async function etsyFetch(path, key) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: { 'x-api-key': key } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Etsy request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function search(query, { maxPrice } = {}) {
  const key = apiKeyHeader();
  if (!key) return [];

  const params = new URLSearchParams({ keywords: query, limit: '25' });
  if (maxPrice) params.set('max_price', String(maxPrice));
  const active = await etsyFetch(`/listings/active?${params}`, key);
  const ids = (active.results || []).map((r) => r.listing_id);
  if (!ids.length) return [];

  // The search endpoint returns neither images nor shipping, so hydrate in one batch call.
  let details = {};
  try {
    const batch = await etsyFetch(
      `/listings/batch?listing_ids=${ids.join(',')}&includes=Images,Shipping`,
      key
    );
    details = Object.fromEntries((batch.results || []).map((l) => [l.listing_id, l]));
  } catch (err) {
    console.warn('Etsy batch hydrate failed', err.message);
  }

  return (active.results || [])
    .map((item) => {
      const full = details[item.listing_id] || item;
      const price = money(full.price);
      const shipping = usShipping(full.shipping_profile);
      const image = full.images?.[0];
      return {
        marketplace: 'etsy',
        title: full.title,
        price: price?.value ?? null,
        currency: price?.currency || 'USD',
        condition: 'unknown',
        shippingPrice: shipping ?? 0,
        shippingKnown: shipping != null,
        totalPrice: price ? price.value + (shipping ?? 0) : null,
        url: full.url,
        imageUrl: image?.url_570xN || image?.url_fullxfull || null,
        sourceId: String(item.listing_id),
      };
    })
    // Totals are only comparable in one currency; this app ranks USD prices.
    .filter((r) => Number.isFinite(r.totalPrice) && r.currency === 'USD');
}

module.exports = {
  key: 'etsy',
  label: 'Etsy',
  get configured() {
    return Boolean(apiKeyHeader());
  },
  get capabilities() {
    return apiKeyHeader() ? ['search'] : [];
  },
  note: 'Etsy is search-only: Etsy does not grant listing-creation access to apps like this one.',
  search,
  usShipping,
};
