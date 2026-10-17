const express = require('express');
const crypto = require('crypto');
const ebay = require('../adapters/ebay');
const { requireAuth } = require('../middleware/auth');
const { limits } = require('../middleware/rateLimit');
const { db, Timestamp, FieldValue } = require('../lib/firebase');
const { HttpError, wrap } = require('../lib/errors');
const ebayAccount = require('../lib/ebayAccount');
const { ensureUser, publicUser } = require('../lib/users');
const { env } = require('../lib/secrets');

const router = express.Router();
const STATE_TTL_MS = 10 * 60 * 1000;
// Where the browser goes back to after eBay: the app's own scheme (standalone builds)
// or Expo Go's exp:// URL in development.
const RETURN_URL = /^(resalehub|exp|exps):\/\/[^\s]*$/;

function withQuery(url, params) {
  return `${url}${url.includes('?') ? '&' : '?'}${new URLSearchParams(params)}`;
}

function page(title, message) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="font-family:system-ui,sans-serif;padding:32px;text-align:center"><h2>${esc(title)}</h2><p>${esc(message)}</p></body></html>`;
}

// Abandoned sign-ins leave state docs behind. Firestore TTL deletes need billing, so
// clean this user's expired ones up ourselves (single-field query, no index needed).
async function deleteExpiredStates(uid) {
  const snap = await db.collection('oauthStates').where('uid', '==', uid).limit(50).get();
  const now = Date.now();
  const stale = snap.docs.filter((d) => (d.data().expiresAt?.toMillis?.() || 0) < now);
  if (!stale.length) return;
  const batch = db.batch();
  stale.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

async function currentUser(req) {
  const data = await ensureUser(req.uid, req.userEmail);
  return publicUser(req.uid, data);
}

// 1) App asks for an authorization URL, then opens it with WebBrowser.openAuthSessionAsync.
router.post(
  '/oauth/start',
  requireAuth,
  limits.sensitive,
  wrap(async (req, res) => {
    if (!ebay.canConnect()) throw new HttpError(503, 'eBay is not configured on the server yet.');
    const returnUrl = String(req.body?.returnUrl || '');
    if (returnUrl && !RETURN_URL.test(returnUrl)) throw new HttpError(400, 'Invalid returnUrl');
    await deleteExpiredStates(req.uid);
    const state = crypto.randomBytes(24).toString('hex');
    await db.collection('oauthStates').doc(state).set({
      uid: req.uid,
      returnUrl: returnUrl || null,
      expiresAt: Timestamp.fromMillis(Date.now() + STATE_TTL_MS),
    });
    res.json({ url: ebay.getAuthorizationUrl(state) });
  })
);

// 2) eBay redirects here (register this URL as the RuName "auth accepted" AND
//    "auth declined" URL). One-time state ties the callback to the user.
router.get(
  '/oauth/callback',
  wrap(async (req, res) => {
    const { code, state, error } = req.query;
    const ref = state ? db.collection('oauthStates').doc(String(state)) : null;
    const snap = ref ? await ref.get() : null;
    const st = snap?.exists ? snap.data() : null;
    if (ref && st) await ref.delete();

    const finish = (status, message) => {
      if (st?.returnUrl) return res.redirect(withQuery(st.returnUrl, { status, message }));
      return res
        .status(status === 'ok' ? 200 : 400)
        .send(page(status === 'ok' ? 'eBay connected' : 'eBay not connected', message));
    };

    if (!st || st.expiresAt.toMillis() < Date.now()) {
      return finish('error', 'This sign-in link expired. Go back to Resale Hub and tap Connect eBay again.');
    }
    if (error || !code) return finish('error', 'eBay sign-in was cancelled.');

    try {
      const tokens = await ebay.exchangeCodeForToken(String(code));
      await ebayAccount.saveTokens(st.uid, tokens);
      const identity = await ebay.getIdentity(tokens.access_token).catch(() => null);
      await ebayAccount.userRef(st.uid).set(
        {
          ebay: {
            connected: true,
            connectedAt: FieldValue.serverTimestamp(),
            disconnectedReason: null,
            userId: identity?.userId || null,
            username: identity?.username || null,
          },
        },
        { merge: true }
      );
      const e = await ebayAccount.refreshSellerSettings(st.uid, tokens.access_token);
      const note = e.missing?.length ? ` Still needed before publishing: ${e.missing.join(', ')}.` : '';
      return finish('ok', `eBay connected. You can return to Resale Hub.${note}`);
    } catch (err) {
      console.error('eBay callback failed', err);
      return finish('error', 'Could not finish connecting eBay. Please try again.');
    }
  })
);

// eBay Marketplace Account Deletion/Closure notifications (required for production
// keysets). GET answers eBay's endpoint-validation challenge; POST removes everything
// we hold for that eBay user (tokens, policies, identity).
// https://developer.ebay.com/marketplace-account-deletion
router.get('/account-deletion', (req, res) => {
  const challengeCode = String(req.query.challenge_code || '');
  const verificationToken = env('EBAY_VERIFICATION_TOKEN');
  const endpoint = process.env.EBAY_DELETION_ENDPOINT || '';
  if (!challengeCode || !verificationToken || !endpoint) return res.status(400).json({ error: 'Not configured' });
  const challengeResponse = crypto
    .createHash('sha256')
    .update(challengeCode + verificationToken + endpoint)
    .digest('hex');
  res.json({ challengeResponse });
});

router.post(
  '/account-deletion',
  wrap(async (req, res) => {
    const data = req.body?.notification?.data || {};
    if (req.body?.metadata?.topic !== 'MARKETPLACE_ACCOUNT_DELETION' || !data.userId) {
      return res.status(204).end();
    }
    const snap = await db.collection('users').where('ebay.userId', '==', String(data.userId)).get();
    await Promise.all(
      snap.docs.map(async (doc) => {
        await ebayAccount.markDisconnected(doc.id, 'Your eBay account was closed.');
        await doc.ref.update({
          'ebay.options': FieldValue.delete(),
          'ebay.settings': FieldValue.delete(),
          'ebay.missing': FieldValue.delete(),
          'ebay.userId': FieldValue.delete(),
          'ebay.username': FieldValue.delete(),
        });
      })
    );
    console.log(`eBay account deletion processed for ${snap.size} user(s)`);
    res.status(204).end();
  })
);

router.use(requireAuth, limits.general);

router.get('/settings', wrap(async (req, res) => res.json({ user: await currentUser(req) })));

router.post(
  '/settings/refresh',
  wrap(async (req, res) => {
    await ebayAccount.refreshSellerSettings(req.uid);
    res.json({ user: await currentUser(req) });
  })
);

// Let the seller choose which of their own policies/location to use.
router.put(
  '/settings',
  wrap(async (req, res) => {
    const data = (await ebayAccount.userRef(req.uid).get()).data() || {};
    const opts = data.ebay?.options;
    if (!data.ebay?.connected || !opts) throw new HttpError(409, 'Connect eBay first');
    const fields = {
      fulfillmentPolicyId: opts.fulfillmentPolicies,
      paymentPolicyId: opts.paymentPolicies,
      returnPolicyId: opts.returnPolicies,
      merchantLocationKey: opts.locations,
    };
    const settings = { ...(data.ebay.settings || {}) };
    for (const [field, list] of Object.entries(fields)) {
      if (req.body?.[field] == null) continue;
      if (!(list || []).some((o) => o.id === req.body[field])) throw new HttpError(400, `Unknown ${field}`);
      settings[field] = req.body[field];
    }
    await ebayAccount.userRef(req.uid).set(
      { ebay: { settings, missing: ebay.missingSettings(settings) } },
      { merge: true }
    );
    res.json({ user: await currentUser(req) });
  })
);

// Create an inventory location from a postal code (needed to publish; many sellers
// have none in the Inventory API even if Seller Hub has an address).
router.post(
  '/location',
  wrap(async (req, res) => {
    const postalCode = String(req.body?.postalCode || '').trim();
    const country = String(req.body?.country || 'US').trim().toUpperCase();
    if (!/^[A-Za-z0-9 -]{3,10}$/.test(postalCode) || !/^[A-Z]{2}$/.test(country)) {
      throw new HttpError(400, 'Enter a valid postal code');
    }
    const token = await ebayAccount.getUserAccessToken(req.uid);
    const key = `rh-${req.uid}`.slice(0, 36);
    try {
      await ebay.createLocation(token, key, { postalCode, country });
    } catch (err) {
      if (err.status !== 409) throw err; // already exists -> just select it
    }
    await ebayAccount.refreshSellerSettings(req.uid, token);
    const data = (await ebayAccount.userRef(req.uid).get()).data();
    if ((data.ebay?.options?.locations || []).some((l) => l.id === key)) {
      const settings = { ...data.ebay.settings, merchantLocationKey: key };
      await ebayAccount.userRef(req.uid).set(
        { ebay: { settings, missing: ebay.missingSettings(settings) } },
        { merge: true }
      );
    }
    res.json({ user: await currentUser(req) });
  })
);

router.delete(
  '/connection',
  wrap(async (req, res) => {
    await ebayAccount.markDisconnected(req.uid, null);
    await ebayAccount.userRef(req.uid).update({
      'ebay.options': FieldValue.delete(),
      'ebay.settings': FieldValue.delete(),
      'ebay.missing': FieldValue.delete(),
      'ebay.userId': FieldValue.delete(),
      'ebay.username': FieldValue.delete(),
    });
    res.json({ user: await currentUser(req) });
  })
);

// Category field -> real eBay category IDs (Taxonomy API getCategorySuggestions).
router.get(
  '/categories',
  limits.categories,
  wrap(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q is required' });
    res.json({ suggestions: await ebay.suggestCategories(q) });
  })
);

module.exports = router;
