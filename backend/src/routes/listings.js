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
function clean(body = {}, { partial }) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  if (!partial || has('title')) {
    const title = String(body.title || '').trim();
    if (!title) throw new HttpError(400, 'Title is required');
    if (title.length > 80) throw new HttpError(400, 'Title must be 80 characters or fewer (eBay limit)');
    out.title = title;
  }
  if (!partial || has('price')) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) {
      throw new HttpError(400, 'Price must be a positive number');
    }
    out.price = Math.round(price * 100) / 100;
  }
  if (!partial || has('description')) out.description = String(body.description || '').trim().slice(0, 4000);
  if (!partial || has('condition')) {
    out.condition = CONDITIONS.includes(body.condition) ? body.condition : 'used';
  }
  if (!partial || has('category')) out.category = String(body.category || '').trim().slice(0, 100);
  if (!partial || has('ebayCategoryId')) {
    const id = body.ebayCategoryId == null ? '' : String(body.ebayCategoryId).trim();
    if (id && !/^\d{1,10}$/.test(id)) throw new HttpError(400, 'Invalid eBay category');
    out.ebayCategoryId = id || null;
    out.ebayCategoryName = id ? String(body.ebayCategoryName || '').slice(0, 300) : null;
  }
  if (!partial || has('photos')) {
    const photos = Array.isArray(body.photos) ? body.photos : [];
    if (photos.length > MAX_PHOTOS) throw new HttpError(400, `Up to ${MAX_PHOTOS} photos per listing`);
    for (const p of photos) {
      if (typeof p !== 'string' || !/^https?:\/\//.test(p) || p.length > 2048) {
        throw new HttpError(400, 'Photos must be http(s) URLs');
      }
    }
    out.photos = photos;
  }
  if (!partial || has('thumbnail')) {
    const t = body.thumbnail == null ? '' : String(body.thumbnail);
    if (t && (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(t) || t.length > MAX_THUMBNAIL_CHARS)) {
      throw new HttpError(400, 'Thumbnail must be a small base64 JPEG/PNG/WebP data URL');
    }
    out.thumbnail = t || null;
  }
  return out;
}

async function getOwned(uid, id) {
  const snap = await col().doc(id).get();
  if (!snap.exists || snap.data().userId !== uid) throw new HttpError(404, 'Listing not found');
  return snap;
}

router.get(
  '/',
  wrap(async (req, res) => {
    const snap = await col().where('userId', '==', req.uid).limit(500).get();
    const rows = snap.docs.map((d) => serialize(d.id, d.data()));
    rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json(rows);
  })
);

router.get(
  '/:id',
  wrap(async (req, res) => {
    const snap = await getOwned(req.uid, req.params.id);
    res.json(serialize(snap.id, snap.data()));
  })
);

router.post(
  '/',
  wrap(async (req, res) => {
    const data = clean(req.body, { partial: false });
    const ref = col().doc();
    await ref.set({
      ...data,
      userId: req.uid,
      targets: {},
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const snap = await ref.get();
    res.status(201).json(serialize(snap.id, snap.data()));
  })
);

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const snap = await getOwned(req.uid, req.params.id);
    const before = snap.data();
    const patch = clean(req.body, { partial: true });
    const update = { ...patch, updatedAt: FieldValue.serverTimestamp() };
    // Live marketplace copies are now stale until the user republishes.
    for (const [key, t] of Object.entries(before.targets || {})) {
      if (t.status === 'published') update[`targets.${key}.outOfDate`] = true;
    }
    await snap.ref.update(update);
    const after = await snap.ref.get();
    res.json(serialize(after.id, after.data()));
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    const snap = await getOwned(req.uid, req.params.id);
    const listing = snap.data();
    const result = { deleted: true, ebayEnded: false, ebayError: null };

    // Also end the eBay listing unless the app asked to keep it (?endOnEbay=false).
    const ebayTarget = listing.targets?.ebay;
    if (ebayTarget?.sku && req.query.endOnEbay !== 'false') {
      try {
        const token = await ebayAccount.getUserAccessToken(req.uid);
        await ebay.endListing(token, ebayTarget.sku);
        result.ebayEnded = true;
      } catch (err) {
        result.ebayError = err.message;
      }
    }

    // Photos are hosted by eBay (EPS), not by us: unused ones expire on eBay's side.
    await snap.ref.delete();
    res.json(result);
  })
);

// Resolve the free-text Category (+ title) to a real eBay leaf category via the
// Taxonomy API when the user didn't pick one explicitly.
async function ensureEbayCategory(ref, listing) {
  if (listing.ebayCategoryId) return listing;
  const query = [listing.category, listing.title].filter(Boolean).join(' ');
  const [top] = await ebay.suggestCategories(query);
  if (!top) {
    throw new HttpError(400, 'Could not match an eBay category. Pick one on the edit screen.');
  }
  await ref.update({ ebayCategoryId: top.categoryId, ebayCategoryName: top.path });
  return { ...listing, ebayCategoryId: top.categoryId, ebayCategoryName: top.path };
}

router.post(
  '/:id/publish',
  limits.publish,
  wrap(async (req, res) => {
    const snap = await getOwned(req.uid, req.params.id);
    let listing = { id: snap.id, ...snap.data() };

    const requested = Array.isArray(req.body?.marketplaces) ? [...new Set(req.body.marketplaces)] : [];
    if (!requested.length) return res.status(400).json({ error: 'marketplaces[] is required' });

    const results = [];
    for (const key of requested.slice(0, 10)) {
      const adapter = adapters.get(key);
      if (!adapter || !adapter.capabilities.includes('publish')) {
        // Not stored: the app only offers marketplaces that can really publish.
        results.push({
          marketplace: key,
          status: 'unsupported',
          error: adapter?.note || `${adapter?.label || key} does not support publishing`,
        });
        continue;
      }

      let target;
      try {
        // Only eBay can publish today.
        const token = await ebayAccount.getUserAccessToken(req.uid);
        const settings = await ebayAccount.getSettings(req.uid);
        listing = await ensureEbayCategory(snap.ref, listing);
        const published = await adapter.publish(listing, { token, settings });
        target = { status: 'published', ...published, error: null, outOfDate: false };
      } catch (err) {
        const notConnected = err.extra?.code === 'not_connected';
        target = {
          ...(listing.targets?.[key] || {}),
          status: notConnected ? 'not_connected' : 'failed',
          error: err.message,
        };
      }
      target.updatedAt = FieldValue.serverTimestamp();
      await snap.ref.update({ [`targets.${key}`]: target });
      results.push({ marketplace: key, status: target.status, error: target.error, url: target.url || null });
    }

    const after = await snap.ref.get();
    res.json({ listing: serialize(after.id, after.data()), results });
  })
);

module.exports = router;
module.exports.clean = clean;
