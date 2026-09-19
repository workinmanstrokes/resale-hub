// Etsy adapter: Open API v3, search only. Third-party apps aren't granted a
// listing-creation scope by default, so there's no honest "publish" to offer here.
// Docs: https://developer.etsy.com/documentation/reference/#operation/findAllActiveListings

const API_KEY = process.env.ETSY_API_KEY;
const configured = Boolean(API_KEY);

const BASE_URL = 'https://openapi.etsy.com/v3/application';

async function search(query, { maxPrice } = {}) {
  if (!configured) return [];

  const params = new URLSearchParams({
    keywords: query,
    limit: '25',
  });
  if (maxPrice) params.set('max_price', String(maxPrice));

  const res = await fetch(`${BASE_URL}/listings/active?${params.toString()}`, {
    headers: { 'x-api-key': API_KEY },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Etsy search failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const results = data.results || [];

  return results.map((item) => {
    const price = Number(item.price?.amount ?? 0) / Number(item.price?.divisor ?? 100);
    return {
      marketplace: 'etsy',
      title: item.title,
      price,
      currency: item.price?.currency_code || 'USD',
      condition: 'unknown',
      shippingPrice: 0,
      totalPrice: price,
      url: item.url,
      imageUrl: null,
      sourceId: String(item.listing_id),
    };
  });
}

module.exports = {
  key: 'etsy',
  label: 'Etsy',
  capabilities: configured ? ['search'] : [],
  configured,
  search,
};
