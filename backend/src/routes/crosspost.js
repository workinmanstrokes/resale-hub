// Resale Hub -> post-everywhere hub (free-to-list sites only).
//
// Seller routes (Firebase Auth, uid must be STORE_SELLER_UID):
//   GET  /crosspost/sites            the 6 free-to-list sites, how each one
//                                    is reached, and what it costs (nothing
//                                    to list — a fee only if the item sells)
//   GET  /crosspost/listings         the seller's own listings, for picking
//                                    one to cross-post
//   POST /crosspost/:id/prepare      build an identical, per-site formatted
//                                    listing for the sites the seller ticked.
//                                    Returns status 'ready_to_publish' —
//                                    NEVER 'posted'. Nothing is posted here.
//   POST /crosspost/:id/mark-posted  the seller records that THEY published
//                                    a prepared listing on a site themselves.
//
// Honesty rules (do not weaken these):
// - Only eBay has an official API publish path, and it lives in the
//   Resale Hub mobile app (My Listings -> eBay, per-user OAuth). This
//   backend does NOT post to eBay and never claims to.
// - Facebook Marketplace has NO general public listings API from Meta.
//   Poshmark, Mercari, OfferUp and Whatnot have NO public seller API.
//   For those five, this hub prepares the listing and gives a copy
//   button + a deep link into that site's own create flow. The seller
//   taps Publish there, in their own signed-in session.
// - Etsy is OUT — it charges a listing fee just to list, and Mike
//   skipped it (and any site like it). It is not in the site list.
// - No fee percentages are quoted anywhere here. Every site is
//   "free to list, fee only on sale" in general terms.
// - Nothing here invents a listing, a price, or a posted status.
const express = require('express');
const { db, FieldValue } = require('../lib/firebase');
const { HttpError, wrap } = require('../lib/errors');
const { requireAuth } = require('../middleware/auth');
const { limits } = require('../middleware/rateLimit');
const { getStoreConfig } = require('../lib/stripe');

const router = express.Router();
const listingsCol = () => db.collection('listings');

// ---- Site catalogue ---------------------------------------------------------
//
// method:
//   'api'     — an official API publish path exists (eBay, in the mobile
//               app only — see the note on that entry).
//   'prefill' — no public API. The hub formats the listing and deep-links
//               into the site's own create flow; the seller publishes it.
// titleMax: the hub's per-site title cap, applied with an ellipsis and a
//   note when the title is cut. The site may still ask the seller to
//   shorten or change a field — the seller reviews it before publishing.
const SITES = [
  {
    id: 'facebook',
    name: 'Facebook Marketplace',
    method: 'prefill',
    freeToList: true,
    feeNote: 'Free to list; a fee only applies if the item sells.',
    titleMax: 140,
    deepLink: 'https://www.facebook.com/marketplace/create/item',
    note: 'No public Marketplace API from Meta. Opens the Marketplace create form — paste the prepared text, add your photos, and tap Publish yourself.',
  },
  {
    id: 'whatnot',
    name: 'Whatnot',
    method: 'prefill',
    freeToList: true,
    feeNote: 'Free to list; a fee only applies if the item sells.',
    titleMax: 100,
    deepLink: 'https://www.whatnot.com/seller',
    note: 'No public seller API. Use a Quality Listing (stays active after the show) — not a Temporary Listing, which disappears when the show ends. Open the seller hub and create the listing there.',
  },
  {
    id: 'poshmark',
    name: 'Poshmark',
    method: 'prefill',
    freeToList: true,
    feeNote: 'Free to list; a fee only applies if the item sells.',
    titleMax: 80,
    deepLink: 'https://poshmark.com/listings/create',
    note: 'No public seller API. Opens the Poshmark create-listing page — paste the prepared text, add your photos, and publish yourself.',
  },
  {
    id: 'mercari',
    name: 'Mercari',
    method: 'prefill',
    freeToList: true,
    feeNote: 'Free to list; a fee only applies if the item sells.',
    titleMax: 80,
    deepLink: 'https://www.mercari.com/sell/',
    note: 'No public seller API. Opens the Mercari sell page — paste the prepared text, add your photos, and publish yourself.',
  },
  {
    id: 'offerup',
    name: 'OfferUp',
    method: 'prefill',
    freeToList: true,
    feeNote: 'Free to list; a fee only applies if the item sells.',
    titleMax: 80,
    deepLink: 'https://offerup.com/post/',
    note: 'No public seller API. Opens the OfferUp post-an-item page — paste the prepared text, add your photos, and publish yourself. OfferUp listings are local-pickup first.',
  },
  {
    id: 'ebay',
    name: 'eBay',
    method: 'api',
    freeToList: true,
    feeNote: 'Free to list within your monthly allowance; a fee only applies if the item sells.',
    titleMax: 80,
    deepLink: 'https://www.ebay.com/sl/sell',
    note: 'Auto via API — but only from the Resale Hub mobile app (My Listings -> eBay, per-user OAuth). This web API does not post to eBay. Open the app to publish, or use the link to eBay’s sell page.',
  },
];

function siteById(id) {
  return SITES.find((s) => s.id === id) || null;
}

function publicSite(s) {
  return { ...s };
}

// ---- Helpers ----------------------------------------------------------------

async function requireSeller(req, res, next) {
  const cfg = getStoreConfig();
  if (!cfg.sellerUid) {
    return res.status(503).json({ error: 'The shop is not set up yet.' });
  }
  if (req.uid !== cfg.sellerUid) {
    return res.status(403).json({ error: 'Only the shop owner can cross-post listings' });
  }
  next();
}

async function loadOwnListing(cfg, id) {
  const snap = await listingsCol().doc(id).get();
  if (!snap.exists) return null;
  const d = snap.data();
  if (d.userId !== cfg.sellerUid) return null;
  return { id: snap.id, data: d };
}

function iso(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  return v;
}

function sellerListing(id, d) {
  return {
    id,
    title: d.title,
    description: d.description || '',
    price: d.price,
    condition: d.condition || 'used',
    category: d.category || '',
    photos: d.photos || [],
    thumbnail: d.thumbnail || null,
    stock: typeof d.stock === 'number' ? d.stock : 1,
    storefront: d.storefront === true,
    crossposts: d.crossposts || {},
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  };
}

// Truncate a title to a site's cap, with an ellipsis, and say so.
// Returns { title, truncated }.
function capTitle(title, max) {
  const t = String(title || '').trim();
  if (t.length <= max) return { title: t, truncated: false };
  return { title: t.slice(0, Math.max(0, max - 1)).trimEnd() + '…', truncated: true };
}

// Tags cleaned for hashtag-style sites: lowercase, spaces to nothing,
// capped at 5, each 20 chars max. Never invented — only from the listing.
function hashTags(listing) {
  const tags = Array.isArray(listing.tags) ? listing.tags : [];
  const seen = new Set();
  const out = [];
  for (const raw of tags) {
    const t = String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push('#' + t.slice(0, 20));
    if (out.length >= 5) break;
  }
  return out;
}

function moneyDollars(dollars) {
  return '$' + Number(dollars || 0).toFixed(2);
}

// Build the per-site prepared listing. Pure function — easy to test.
function prepareForSite(site, listing, storeUrl) {
  const { title, truncated } = capTitle(listing.title, site.titleMax);
  const price = Number(listing.price);
  if (!listing.title || !String(listing.title).trim()) {
    throw new HttpError(400, 'This listing has no title, so it cannot be cross-posted.');
  }
  if (!Number.isFinite(price) || price <= 0) {
    throw new HttpError(400, 'This listing has no valid price, so it cannot be cross-posted.');
  }
  const tags = hashTags(listing);
  const description = String(listing.description || '').trim();
  const lines = [
    title,
    moneyDollars(price) + ' · ' + (listing.condition || 'used'),
    listing.category ? 'Category: ' + listing.category : null,
    '',
    description,
    tags.length ? '' : null,
    tags.length ? tags.join(' ') : null,
    '',
    'Listed on Resale Hub' + (storeUrl ? ': ' + storeUrl : '') + ' — also available there while stock lasts.',
  ].filter((l) => l !== null);
  const copyText = lines.join('\n');
  return {
    site: site.id,
    name: site.name,
    method: site.method,
    freeToList: site.freeToList,
    feeNote: site.feeNote,
    title,
    titleTruncated: truncated,
    titleNote: truncated
      ? `Title was shortened to fit ${site.name}'s ${site.titleMax}-character limit — check it reads right before you publish.`
      : null,
    description,
    price,
    condition: listing.condition || 'used',
    category: listing.category || '',
    tags,
    photos: listing.photos || [],
    thumbnail: listing.thumbnail || null,
    stock: typeof listing.stock === 'number' ? listing.stock : 1,
    copyText,
    deepLink: site.deepLink,
    status: 'ready_to_publish',
    note: site.note,
  };
}

function cleanPrepareBody(body = {}) {
  const sites = body.sites;
  if (!Array.isArray(sites) || sites.length === 0) {
    throw new HttpError(400, 'Pick at least one site to prepare a listing for.');
  }
  if (sites.length > 6) {
    throw new HttpError(400, 'Pick at most 6 sites.');
  }
  const cleaned = [];
  for (const raw of sites) {
    const id = String(raw || '').trim().toLowerCase();
    const site = siteById(id);
    if (!site) throw new HttpError(400, `Unknown site: ${String(raw || '').slice(0, 40)}`);
    if (!cleaned.includes(id)) cleaned.push(id);
  }
  return cleaned;
}

// ---- Routes -----------------------------------------------------------------

router.get(
  '/sites',
  requireAuth,
  requireSeller,
  limits.general,
  wrap(async (req, res) => {
    res.json(SITES.map(publicSite));
  }),
);

router.get(
  '/listings',
  requireAuth,
  requireSeller,
  limits.general,
  wrap(async (req, res) => {
    const cfg = getStoreConfig();
    const snap = await listingsCol().where('userId', '==', cfg.sellerUid).get();
    const rows = snap.docs.map((d) => sellerListing(d.id, d.data()));
    rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    res.json(rows.slice(0, 100));
  }),
);

router.post(
  '/:id/prepare',
  requireAuth,
  requireSeller,
  limits.general,
  wrap(async (req, res) => {
    const cfg = getStoreConfig();
    const siteIds = cleanPrepareBody(req.body);
    const found = await loadOwnListing(cfg, req.params.id);
    if (!found) throw new HttpError(404, 'Listing not found');
    const d = found.data;
    const prepared = siteIds.map((id) => prepareForSite(siteById(id), d, cfg.storeUrl));
    res.json({
      listingId: found.id,
      title: d.title,
      price: d.price,
      preparedAt: new Date().toISOString(),
      sites: prepared,
    });
  }),
);

router.post(
  '/:id/mark-posted',
  requireAuth,
  requireSeller,
  limits.general,
  wrap(async (req, res) => {
    const cfg = getStoreConfig();
    const body = req.body || {};
    const siteId = String(body.site || '').trim().toLowerCase();
    const site = siteById(siteId);
    if (!site) throw new HttpError(400, 'Pick a valid site to mark as posted.');
    let url = null;
    if (body.url != null && String(body.url).trim() !== '') {
      url = String(body.url).trim();
      if (!/^https?:\/\//i.test(url)) {
        throw new HttpError(400, 'The listing URL must start with http:// or https://');
      }
      if (url.length > 500) throw new HttpError(400, 'The listing URL is too long.');
    }
    const found = await loadOwnListing(cfg, req.params.id);
    if (!found) throw new HttpError(404, 'Listing not found');
    const existing = (found.data.crossposts || {})[siteId];
    if (existing && existing.status === 'posted_by_seller') {
      return res.json({
        listingId: found.id,
        site: siteId,
        already: true,
        crosspost: existing,
      });
    }
    const record = {
      status: 'posted_by_seller',
      url,
      postedAt: FieldValue.serverTimestamp(),
    };
    await listingsCol()
      .doc(found.id)
      .update({
        [`crossposts.${siteId}`]: record,
        updatedAt: FieldValue.serverTimestamp(),
      });
    const after = await listingsCol().doc(found.id).get();
    res.json({
      listingId: found.id,
      site: siteId,
      already: false,
      crosspost: (after.data().crossposts || {})[siteId] || record,
    });
  }),
);

module.exports = router;
module.exports.SITES = SITES;
module.exports.prepareForSite = prepareForSite;
module.exports.capTitle = capTitle;
