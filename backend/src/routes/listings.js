const express = require('express');
const adapters = require('../adapters');
const ebay = require('../adapters/ebay');
const { requireAuth } = require('../middleware/auth');
const { limits } = require('../middleware/rateLimit');
const { db, FieldValue } = require('../lib/firebase');
const { HttpError, wrap } = require('../lib/errors');
const ebayAccount = require('../lib/ebayAccount');
const router = express.Router();
router.use(requireAuth, limits.general);

const CONDITIONS = ['new', 'used', 'refurbished'];
const MAX_PHOTOS = 12;
// Small JPEG preview made on the device (about 240 px). Stored on the listing so My
// Listings can show it even after an unused eBay-hosted photo expires.
const MAX_THUMBNAIL_CHARS = 60_000;
const col = () => db.collection('listings');
function iso(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  return v;
}

function serialize(id, d) {
  return {
    id,
    title: d.title,
    description: d.description,
    price: d.price,
    condition: d.condition,
    category: d.category,
    ebayCategoryId: d.ebayCategoryId || null,
    ebayCategoryName: d.ebayCategoryName || null,
    photos: d.photos || [],
    thumbnail: d.thumbnail || null,
    storefront: d.storefront === true,
    stock: typeof d.stock === 'number' ? d.stock : 1,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
    targets: Object.entries(d.targets || {}).map(([marketplace, t]) => ({
      id: `${id}_${marketplace}`,
      marketplace,
      status: t.status,
      externalId: t.externalId || null,
      url: t.url || null,
      error: t.error || null,
      outOfDate: Boolean(t.outOfDate),
      updatedAt: iso(t.updatedAt),
    })),
  };
}

// Validates a create (all fields) or patch (only provided fields) body.
function clean(body = {}, { partial } = {}) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (!partial || has('title')) {
    out.title = String(body.title || '').trim();
    if (!partial && !out.title) throw new HttpError(400, 'title is required');
  }
  if (!partial || has('price')) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) throw new HttpError(400, 'price must be a number >= 0');
    out.price = price;
  }
  if (!partial || has('description')) {
    out.description = String(body.description || '').trim();
  }
  if (!partial || has('condition')) {
    if (!CONDITIONS.includes(body.condition)) throw new HttpError(400, 'condition must be new, used or refurbished');
    out.condition = body.condition;
  }
  if (!partial || has('category')) {
    out.category = String(body.category || '').trim() || null;
  }
  if (!partial || has('ebayCategoryId')) {
    if (body.ebayCategoryId == null) {
      out.ebayCategoryId = null;
      out.ebayCategoryName = null;
    } else {
      const cat = adapters.ebay.categoryById(String(body.ebayCategoryId));
      if (!cat) throw new HttpError(400, 'unknown ebayCategoryId');
      out.ebayCategoryId = String(cat.id);
      out.ebayCategoryName = cat.name;
    }
  }
  if (!partial || has('photos')) {
    if (!Array.isArray(body.photos)) throw new HttpError(400, 'photos must be an array');
    if (body.photos.length > MAX_PHOTOS) throw new HttpError(400, `at most ${MAX_PHOTOS} photos`);
    out.photos = body.photos.map((p) => String(p)).filter(Boolean);
  }
  if (!partial || has('thumbnail')) {
    const thumbnail = String(body.thumbnail || '');
    if (thumbnail.length > MAX_THUMBNAIL_CHARS) throw new HttpError(400, 'thumbnail is too large');
    out.thumbnail = thumbnail || null;
  }
  if (!partial || has('storefront')) {
    out.storefront = body.storefront === true;
  }
  if (!partial || has('stock')) {
    const stock = body.stock == null ? 1 : Number(body.stock);
    if (!Number.isInteger(stock) || stock < 0 || stock > 999) {
      throw new HttpError(400, 'Stock must be a whole number from 0 to 999');
    }
    out.stock = stock;
  }
  return out;
}

router.get('/', wrap(async (req, res) => {
  if (!req.user) {
    const err = new Error('unauthorized'); // keep newer sessions logged in (Firebase)
    err.status = 401;
    throw err;
  }
  // Single-field query only: where() + orderBy() on different fields needs a
  // Firestore composite index that does not exist, and it 500s the page.
  // Sort in memory instead, newest first.
  const snap = await col().where('ownerId', '==', req.user.uid).get();
  const rows = snap.docs.map((d) => serialize(d.id, d.data()));
  rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  res.json(rows);
}));

router.post('/', wrap(async (req, res) => {
  if (!req.user) {
    const err = new Error('unauthorized');
    err.status = 401;
    throw err;
  }
  const data = clean(req.body);
  const postToEbay = req.body.postToEbay === true;
  const targets = {};
  if (postToEbay) {
    const account = await ebayAccount.getEbayAccount(req.user.uid);
    if (!account) throw new HttpError(400, 'eBay account not connected');
    const data2 = data;
    const listing = { ...data2, ownerId: req.user.uid };
    await ebay.createListing(listing, account);
    const url = await ebay.getListingUrl(account, listing);
    targets.ebay = {
      status: 'listed',
      externalId: listing.ebay?.itemId,
      url,
      updatedAt: FieldValue.serverTimestamp(),
    };
  }
  const ref = await col().add({
    ...data,
    ownerId: req.user.uid,
    // The storefront catalog currently keys on ownerId, but userId is the
    // field the catalog has keyed on before: write both so a listing created
    // here is visible in the shop once flagged (storefront: true) and in stock.
    userId: req.user.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    targets,
  });
  res.status(201).json(serialize(ref.id, { ...data, ownerId: req.user.uid, userId: req.user.uid }));
}));

router.get('/:id', wrap(async (req, res) => {
  const d = await getListing(req, res);
  res.json(serialize(req.params.id, d));
}));

router.patch('/:id', wrap(async (req, res) => {
  const d = await getListing(req, res);
  const data = clean(req.body, { partial: true });
  if (Object.keys(data).length === 0) throw new HttpError(400, 'nothing to update');
  await col().doc(req.params.id).update({
    ...data, updatedAt: FieldValue.serverTimestamp(),
  });
  res.json(serialize(req.params.id, { ...d, ...data }));
}));

router.delete('/:id', wrap(async (req, res) => {
  const d = await getListing(req, res);
  if (d.targets?.ebay?.status === 'listed') {
    const message = `Listing ${req.params.id} is already listed on eBay`;
    res.status(409).json({ error: message });
    return;
  }
  await col().doc(req.params.id).delete();
  res.sendStatus(204);
}));

async function getListing(req, res) {
  const snap = await col().doc(req.params.id).get();
  if (!snap.exists) {
    res.status(404).json({ error: 'Listing not found' });
    return null;
  }
  if (snap.data().ownerId !== req.user.uid) {
    res.status(403).json({ error: 'Not your listing' });
    throw new Error('not your listing');
  }
  return snap.data();
}

router.post('/:id/ebay', wrap(async (req, res) => {
  const d = await getListing(req, res);
  if (d.targets?.ebay?.status === 'listed') {
    res.status(409).json({ error: 'Listing is already listed on eBay' });
    return;
  }
  const account = await ebayAccount.getEbayAccount(req.user.uid);
  if (!account) throw new HttpError(400, 'eBay account not connected');
  const listing = { ...d, id: req.params.id };
  const result = await ebay.createListing(listing, account);
  const url = await ebay.getListingUrl(account, listing);
  const target = {
    status: 'listed',
    externalId: result?.ebay?.itemId || listing.ebay?.itemId,
    url,
    updatedAt: FieldValue.serverTimestamp(),
  };
  await col().doc(req.params.id).update({
    targets: { ...d.targets, ebay: target },
    updatedAt: FieldValue.serverTimestamp(),
  });
  res.status(201).json(serialize(req.params.id, {
    ...d,
    targets: { ...d.targets, ebay: target },
  }));
}));

module.exports = router;
