// Resale Hub direct-sale storefront API.
//
// Public routes (no sign-in):
//   GET  /storefront/listings          catalog: the seller's listings flagged
//                                      for the website, in stock, newest first
//   GET  /storefront/listings/:id      one listing (same visibility rules)
//   POST /storefront/checkout          validate the cart against Firestore
//                                      (prices and stock always come from the
//                                      server, never from the browser) and
//                                      create a Stripe Checkout Session
//   POST /storefront/webhook           Stripe webhook (raw body). Marks paid
//                                      orders and decrements stock.
//   GET  /storefront/order/:sessionId  order confirmation for the buyer who
//                                      just paid (session id is unguessable)
//
// Seller routes (Firebase Auth, uid must be STORE_SELLER_UID):
//   GET  /storefront/orders            all orders, newest first
//   POST /storefront/orders/:id/fulfill  mark an order fulfilled (+ tracking)
//
// Prices in Firestore are dollars (the existing listings schema). Stripe
// takes cents; conversion is Math.round(dollars * 100) here, on the server.
//
// Nothing here invents a price, a listing, or an order. The catalog starts
// empty until the seller flags listings for the website (storefront: true)
// and they have stock > 0. If Stripe is not configured, checkout answers
// 503 with a plain message instead of pretending to work.
const express = require('express');
const { db, FieldValue } = require('../lib/firebase');
const { HttpError, wrap } = require('../lib/errors');
const { requireAuth } = require('../middleware/auth');
const { limits } = require('../middleware/rateLimit');
const { isCheckoutConfigured, getStripe, getStoreConfig } = require('../lib/stripe');

const router = express.Router();
const listingsCol = () => db.collection('listings');
const ordersCol = () => db.collection('orders');

function toCents(dollars) {
  return Math.round(Number(dollars) * 100);
}

function iso(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  return v;
}

// Only the fields a buyer needs. Never ownerId, targets, or eBay internals.
function publicListing(id, d) {
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
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  };
}

function publicOrder(id, d) {
  return {
    id,
    status: d.status,
    items: d.items || [],
    subtotalCents: d.subtotalCents,
    shippingCents: d.shippingCents,
    totalCents: d.totalCents,
    currency: d.currency || 'usd',
    buyerEmail: d.buyerEmail || null,
    buyerName: d.buyerName || null,
    shippingAddress: d.shippingAddress || null,
    shippingStatus: d.shippingStatus || 'to_arrange',
    trackingNote: d.trackingNote || null,
    createdAt: iso(d.createdAt),
    paidAt: iso(d.paidAt),
    fulfilledAt: iso(d.fulfilledAt),
  };
}

function sellerConfigOr503() {
  const cfg = getStoreConfig();
  if (!cfg.sellerUid) {
    throw new HttpError(503, 'The shop is not set up yet. The seller needs to set STORE_SELLER_UID.');
  }
  return cfg;
}

async function loadSellableListing(cfg, id) {
  const snap = await listingsCol().doc(id).get();
  if (!snap.exists) return null;
  const d = snap.data();
  if (d.ownerId !== cfg.sellerUid || d.storefront !== true) return null;
  const stock = typeof d.stock === 'number' ? d.stock : 1;
  if (stock <= 0) return null;
  return { id: snap.id, data: d, stock };
}

// ---- Public catalog ---------------------------------------------------------

router.get(
  '/listings',
  limits.general,
  wrap(async (req, res) => {
    const cfg = sellerConfigOr503();
    // Single-field query only: a second where() on storefront would need a
    // Firestore composite index. Filter storefront in memory below instead.
    const snap = await listingsCol()
      .where('ownerId', '==', cfg.sellerUid)
      .get();
    let rows = snap.docs
      .map((d) => ({ id: d.id, data: d.data() }))
      .filter((r) => r.data.storefront === true)
      .filter((r) => (typeof r.data.stock === 'number' ? r.data.stock : 1) > 0)
      .map((r) => publicListing(r.id, r.data));
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        [r.title, r.description, r.category].join(' ').toLowerCase().includes(q),
      );
    }
    rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    res.json(rows.slice(0, 100));
  }),
);

router.get(
  '/listings/:id',
  limits.general,
  wrap(async (req, res) => {
    const cfg = sellerConfigOr503();
    const found = await loadSellableListing(cfg, req.params.id);
    if (!found) throw new HttpError(404, 'Item not found');
    res.json(publicListing(found.id, found.data));
  }),
);

// ---- Checkout ---------------------------------------------------------------

function cleanCheckoutBody(body = {}) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length || items.length > 20) {
    throw new HttpError(400, 'The cart is empty or too large (max 20 lines)');
  }
  const cleaned = items.map((it) => {
    const id = String(it && it.id ? it.id : '').trim();
    const qty = Number(it && it.qty);
    if (!id) throw new HttpError(400, 'Each cart line needs an item id');
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
      throw new HttpError(400, 'Quantity must be a whole number from 1 to 99');
    }
    return { id, qty };
  });
  const email = body.email == null ? null : String(body.email).trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'That email address does not look valid');
  }
  return { items: cleaned, email };
}

router.post(
  '/checkout',
  limits.general,
  wrap(async (req, res) => {
    const cfg = sellerConfigOr503();
    if (!cfg.storeUrl) {
      throw new HttpError(503, 'Checkout is not set up yet. The seller needs to set STORE_URL.');
    }
    if (!isCheckoutConfigured()) {
      throw new HttpError(503, 'Checkout is not set up yet. The seller needs to add a Stripe key.');
    }
    const { items, email } = cleanCheckoutBody(req.body);

    // Re-price everything from Firestore. The browser's prices are ignored.
    const lines = [];
    const unavailable = [];
    for (const it of items) {
      const found = await loadSellableListing(cfg, it.id);
      if (!found) {
        unavailable.push(it.id);
        continue;
      }
      if (found.stock < it.qty) {
        unavailable.push(it.id);
        continue;
      }
      lines.push({
        listingId: found.id,
        title: found.data.title,
        priceCents: toCents(found.data.price),
        qty: it.qty,
        photo: (found.data.photos || [])[0] || null,
      });
    }
    if (unavailable.length) {
      throw new HttpError(400, 'One or more items are no longer available.', {
        unavailable,
      });
    }

    const subtotalCents = lines.reduce((s, l) => s + l.priceCents * l.qty, 0);
    const shippingCents = cfg.shippingFlatCents;
    const totalCents = subtotalCents + shippingCents;

    // Create the order first (status pending), so the webhook and the
    // success page both have one record to finalize, idempotently.
    const orderRef = ordersCol().doc();
    await orderRef.set({
      status: 'pending',
      items: lines,
      subtotalCents,
      shippingCents,
      totalCents,
      currency: 'usd',
      buyerEmail: email,
      buyerName: null,
      shippingAddress: null,
      shippingStatus: shippingCents > 0 ? 'prepaid' : 'to_arrange',
      trackingNote: null,
      stripeSessionId: null,
      stripePaymentIntentId: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      paidAt: null,
      fulfilledAt: null,
    });

    let session;
    try {
      const stripe = getStripe();
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        ...(email ? { customer_email: email } : {}),
        line_items: lines.map((l) => ({
          quantity: l.qty,
          price_data: {
            currency: 'usd',
            unit_amount: l.priceCents,
            product_data: {
              name: l.title,
              ...(l.photo ? { images: [l.photo] } : {}),
            },
          },
        })),
        ...(shippingCents > 0
          ? {
              shipping_options: [
                {
                  shipping_rate_data: {
                    type: 'fixed_amount',
                    fixed_amount: { amount: shippingCents, currency: 'usd' },
                    display_name: 'Shipping',
                  },
                },
              ],
            }
          : {}),
        shipping_address_collection: { allowed_countries: cfg.shipCountries },
        metadata: { orderId: orderRef.id },
        success_url: `${cfg.storeUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${cfg.storeUrl}/cart.html?checkout=cancelled`,
      });
    } catch (err) {
      await orderRef.update({
        status: 'checkout_failed',
        updatedAt: FieldValue.serverTimestamp(),
      });
      console.error('storefront checkout failed', err.message);
      throw new HttpError(502, 'Checkout could not be started. Please try again.');
    }

    await orderRef.update({
      stripeSessionId: session.id,
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.json({ url: session.url, orderId: orderRef.id });
  }),
);

// ---- Order finalization (shared by webhook + success page) ------------------

// Marks a pending order paid and decrements stock, inside one transaction.
// Idempotent: calling it twice for the same order changes nothing the
// second time. Returns the order data after finalization.
async function finalizePaidOrder(orderRef, session) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return null;
    const order = snap.data();
    if (order.status === 'paid') return order; // already finalized
    if (order.status !== 'pending') return order;

    const details = session.customer_details || {};
    const ship = session.shipping_details || {};
    const updates = {
      status: 'paid',
      paidAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      stripePaymentIntentId: session.payment_intent || order.stripePaymentIntentId || null,
      buyerEmail: details.email || order.buyerEmail || null,
      buyerName: ship.name || details.name || order.buyerName || null,
      shippingAddress: ship.address || order.shippingAddress || null,
    };
    let stockIssue = false;
    for (const line of order.items || []) {
      const listingRef = listingsCol().doc(line.listingId);
      const lSnap = await tx.get(listingRef);
      if (!lSnap.exists) {
        stockIssue = true;
        continue;
      }
      const stock = typeof lSnap.data().stock === 'number' ? lSnap.data().stock : 1;
      const next = Math.max(0, stock - line.qty);
      if (next < stock - line.qty) stockIssue = true;
      tx.update(listingRef, { stock: next, updatedAt: FieldValue.serverTimestamp() });
    }
    if (stockIssue) updates.stockIssue = true;
    tx.update(orderRef, updates);
    return { ...order, ...updates };
  });
}

// ---- Stripe webhook ---------------------------------------------------------
//
// IMPORTANT: this route needs the raw request body for signature verification.
// app.js must mount express.raw() for this path BEFORE express.json() — see
// backend/INTEGRATION.md. If the raw body never arrives, this answers 400
// with a message that says exactly that, instead of failing silently.
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  wrap(async (req, res) => {
    const stripe = getStripe();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !secret) {
      return res.status(503).json({ error: 'Stripe webhook is not configured' });
    }
    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({
        error:
          'Webhook needs the raw request body. Mount express.raw() for /api/storefront/webhook before express.json() in app.js (see INTEGRATION.md).',
      });
    }
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, secret);
    } catch (err) {
      return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const orderId = session.metadata && session.metadata.orderId;
      if (orderId) {
        await finalizePaidOrder(ordersCol().doc(orderId), session);
      }
    } else if (event.type === 'checkout.session.expired') {
      const session = event.data.object;
      const orderId = session.metadata && session.metadata.orderId;
      if (orderId) {
        const ref = ordersCol().doc(orderId);
        const snap = await ref.get();
        if (snap.exists && snap.data().status === 'pending') {
          await ref.update({ status: 'expired', updatedAt: FieldValue.serverTimestamp() });
        }
      }
    }
    res.json({ received: true });
  }),
);

// ---- Buyer order confirmation ----------------------------------------------
//
// The buyer lands here from Stripe with ?session_id=. If the webhook has
// not run yet, this finalizes the order by asking Stripe directly whether
// the session is paid — so an order is never stuck "pending" just because
// the webhook was slow or not yet set up.
router.get(
  '/order/:sessionId',
  limits.general,
  wrap(async (req, res) => {
    const snap = await ordersCol()
      .where('stripeSessionId', '==', req.params.sessionId)
      .limit(1)
      .get();
    if (snap.empty) throw new HttpError(404, 'Order not found');
    const doc = snap.docs[0];
    let data = doc.data();
    if (data.status === 'pending' && isCheckoutConfigured()) {
      try {
        const session = await getStripe().checkout.sessions.retrieve(req.params.sessionId);
        if (session && session.payment_status === 'paid') {
          const finalized = await finalizePaidOrder(doc.ref, session);
          if (finalized) data = finalized;
        }
      } catch (err) {
        // Leave the order pending; the webhook may still finalize it.
        console.error('storefront order lookup failed', err.message);
      }
    }
    res.json(publicOrder(doc.id, data));
  }),
);

// ---- Seller: orders ---------------------------------------------------------

async function requireSeller(req, res, next) {
  const cfg = getStoreConfig();
  if (!cfg.sellerUid) {
    return res.status(503).json({ error: 'The shop is not set up yet.' });
  }
  if (req.uid !== cfg.sellerUid) {
    return res.status(403).json({ error: 'Only the shop owner can view orders' });
  }
  next();
}

router.get(
  '/orders',
  requireAuth,
  requireSeller,
  limits.general,
  wrap(async (req, res) => {
    const snap = await ordersCol().get();
    const rows = snap.docs.map((d) => publicOrder(d.id, d.data()));
    rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    res.json(rows.slice(0, 100));
  }),
);

router.post(
  '/orders/:id/fulfill',
  requireAuth,
  requireSeller,
  limits.general,
  wrap(async (req, res) => {
    const ref = ordersCol().doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, 'Order not found');
    if (snap.data().status !== 'paid') {
      throw new HttpError(400, 'Only a paid order can be marked fulfilled');
    }
    const note = req.body && req.body.trackingNote != null ? String(req.body.trackingNote).slice(0, 500) : null;
    await ref.update({
      status: 'fulfilled',
      fulfilledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...(note ? { trackingNote: note } : {}),
    });
    const after = await ref.get();
    res.json(publicOrder(after.id, after.data()));
  }),
);

module.exports = router;
