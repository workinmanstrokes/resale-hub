// End-to-end API test against the Firebase emulators (Auth + Firestore only; there is
// no Storage on the Spark plan) and a local fake eBay server, so the whole flow runs
// offline: OAuth connect, eBay-hosted photo upload, listings, publish, deletion.
// Run: npm test   (wraps `firebase emulators:exec`; needs Java for the emulators)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-resale-hub';
process.env.FIREBASE_PROJECT_ID = PROJECT;
process.env.EBAY_CLIENT_ID = 'test-client';
process.env.EBAY_CLIENT_SECRET = 'test-secret';
process.env.EBAY_RUNAME = 'Test-RuName';
process.env.EBAY_ENV = 'sandbox';
process.env.EBAY_VERIFICATION_TOKEN = 'v'.repeat(40);
process.env.EBAY_DELETION_ENDPOINT = 'https://resale-hub.example/api/ebay/account-deletion';

const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const FS = `http://${process.env.FIRESTORE_EMULATOR_HOST}`;
let base;
let server;
let fakeEbay;
const ebayCalls = [];

// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const THUMB = `data:image/png;base64,${PNG.toString('base64')}`;

// Minimal stand-in for the eBay endpoints the API calls.
function startFakeEbay() {
  let imageN = 0;
  const s = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      ebayCalls.push(`${req.method} ${p}`);
      const json = (status, data, headers = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
        res.end(data === undefined ? '' : JSON.stringify(data));
      };
      const bearer = req.headers.authorization || '';
      if (p === '/identity/v1/oauth2/token') {
        assert.equal(bearer, `Basic ${Buffer.from('test-client:test-secret').toString('base64')}`);
        const form = new URLSearchParams(body.toString());
        if (form.get('grant_type') === 'authorization_code' && form.get('code') !== 'good-code') {
          return json(400, { error: 'invalid_grant' });
        }
        return json(200, {
          access_token: `user-token-${form.get('grant_type')}`,
          expires_in: 7200,
          refresh_token: 'refresh-1',
          refresh_token_expires_in: 47304000,
        });
      }
      if (!bearer.startsWith('Bearer ')) return json(401, { errors: [{ message: 'no token' }] });
      if (p === '/commerce/identity/v1/user/') return json(200, { userId: 'ebay-alice', username: 'alice_sells' });
      if (p === '/sell/account/v1/fulfillment_policy') return json(200, { fulfillmentPolicies: [{ fulfillmentPolicyId: 'f1', name: 'Ship' }] });
      if (p === '/sell/account/v1/payment_policy') return json(200, { paymentPolicies: [{ paymentPolicyId: 'p1', name: 'Pay' }] });
      if (p === '/sell/account/v1/return_policy') return json(200, { returnPolicies: [{ returnPolicyId: 'r1', name: 'Returns' }] });
      if (p === '/sell/inventory/v1/location') return json(200, { locations: [{ merchantLocationKey: 'home', name: 'Home' }] });
      if (p === '/commerce/media/v1_beta/image/create_image_from_file') {
        assert.match(req.headers['content-type'], /^multipart\/form-data; boundary=/);
        assert.ok(body.includes(Buffer.from('name="image"')), 'multipart field is "image"');
        assert.ok(body.includes(PNG), 'photo bytes forwarded to eBay');
        imageN += 1;
        // Alternate between returning the body and only a Location header.
        if (imageN % 2 === 0) {
          return json(201, undefined, { Location: `https://apim.ebay.com/commerce/media/v1_beta/image/img-${imageN}` });
        }
        return json(201, { imageUrl: `https://i.ebayimg.com/images/g/img-${imageN}/s-l1600.png`, expirationDate: '2026-11-16T00:00:00.000Z' });
      }
      if (p.startsWith('/commerce/media/v1_beta/image/')) {
        const id = p.split('/').pop();
        return json(200, { imageUrl: `https://i.ebayimg.com/images/g/${id}/s-l1600.png`, expirationDate: '2026-11-16T00:00:00.000Z' });
      }
      if (p.startsWith('/sell/inventory/v1/inventory_item/')) return json(204);
      if (p === '/sell/inventory/v1/offer' && req.method === 'GET') return json(404, { errors: [] });
      if (p === '/sell/inventory/v1/offer' && req.method === 'POST') return json(201, { offerId: 'offer-1' });
      if (p === '/sell/inventory/v1/offer/offer-1/publish') return json(200, { listingId: '110000000001' });
      return json(404, { errors: [{ message: `fake eBay: no route ${req.method} ${p}` }] });
    });
  });
  return new Promise((r) => s.listen(0, () => r(s)));
}

async function signUp(email) {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'hunter2hunter2', returnSecureToken: true }),
  });
  const data = await res.json();
  assert.ok(data.idToken, JSON.stringify(data));
  return data;
}

function call(path, { token, method = 'GET', body, headers = {} } = {}) {
  return fetch(`${base}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
}

function photoForm(type = 'image/png', bytes = PNG) {
  const form = new FormData();
  form.append('photo', new Blob([bytes], { type }), 'p.png');
  return form;
}

let handler;
test.before(async () => {
  fakeEbay = await startFakeEbay();
  process.env.EBAY_BASE_URL_OVERRIDE = `http://127.0.0.1:${fakeEbay.address().port}`;
  handler = require('../src/handler'); // same entry the Vercel/Workers adapters use
  server = http.createServer(handler);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => {
  server.close();
  fakeEbay.close();
});

test('rate limiter returns 429 after the limit (Firestore and memory stores)', async () => {
  const express = require('express');
  const { rateLimit } = require('../src/middleware/rateLimit');
  for (const store of ['firestore', 'memory']) {
    const app = express();
    app.get('/x', (req, res, next) => ((req.uid = `rl-${store}`), next()), rateLimit({ name: `t-${store}`, limit: 2, windowSec: 60, store }), (req, res) => res.json({ ok: 1 }));
    const s = http.createServer(app);
    await new Promise((r) => s.listen(0, r));
    const u = `http://127.0.0.1:${s.address().port}/x`;
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await fetch(u)).status);
    s.close();
    assert.deepEqual(codes, [200, 200, 429], store);
  }
});

test('full flow: account, eBay connect, eBay-hosted photos, listings, publish, rules, deletion', async () => {
  const { getFirestore } = require('firebase-admin/firestore');
  const db = getFirestore();

  assert.equal((await call('/health')).status, 200);
  assert.equal((await call('/listings')).status, 401);

  const a = await signUp('alice@example.com');
  const b = await signUp('bob@example.com');

  const me = await (await call('/account/me', { token: a.idToken })).json();
  assert.equal(me.user.email, 'alice@example.com');
  assert.equal(me.user.ebayConnected, false);

  // Photos need a connected eBay account (eBay hosts them).
  const early = await call('/uploads', { token: a.idToken, method: 'POST', body: photoForm() });
  assert.equal(early.status, 409);
  assert.equal((await early.json()).code, 'not_connected');

  // eBay OAuth: bad returnUrl refused; declined sign-in redirects back; state is single-use.
  assert.equal((await call('/ebay/oauth/start', { token: a.idToken, method: 'POST', body: { returnUrl: 'https://evil.example' } })).status, 400);
  const startUrl = async () =>
    new URL((await (await call('/ebay/oauth/start', { token: a.idToken, method: 'POST', body: { returnUrl: 'resalehub://ebay-connected' } })).json()).url);
  const s1 = (await startUrl()).searchParams.get('state');
  const declined = await call(`/ebay/oauth/callback?state=${s1}&error=access_denied`);
  assert.equal(declined.status, 302);
  assert.match(declined.headers.get('location'), /^resalehub:\/\/ebay-connected\?status=error/);
  assert.equal((await call(`/ebay/oauth/callback?state=${s1}&code=x`)).status, 400, 'state is single-use');

  // Expired state docs are cleaned up on the next start (no TTL policy on Spark).
  await db.doc('oauthStates/stale-one').set({ uid: a.localId, expiresAt: new Date(Date.now() - 1000) });
  const authUrl = await startUrl();
  assert.equal((await db.doc('oauthStates/stale-one').get()).exists, false);
  assert.equal(authUrl.searchParams.get('redirect_uri'), 'Test-RuName');

  // Accepted: code exchanged server-side, tokens stored privately, settings fetched.
  const ok = await call(`/ebay/oauth/callback?state=${authUrl.searchParams.get('state')}&code=good-code`);
  assert.equal(ok.status, 302);
  assert.match(ok.headers.get('location'), /^resalehub:\/\/ebay-connected\?status=ok/);
  const connected = (await (await call('/account/me', { token: a.idToken })).json()).user;
  assert.equal(connected.ebayConnected, true);
  assert.deepEqual(connected.ebay.missing, []);
  assert.equal(connected.ebay.settings.merchantLocationKey, 'home');
  const tokens = (await db.doc(`users/${a.localId}/private/ebay`).get()).data();
  assert.equal(tokens.refreshToken, 'refresh-1');

  // Photo upload -> eBay Picture Services URL (both response styles).
  const up = await call('/uploads', { token: a.idToken, method: 'POST', body: photoForm() });
  assert.equal(up.status, 201, await up.clone().text());
  const { url: photoUrl, expiresAt } = await up.json();
  assert.match(photoUrl, /^https:\/\/i\.ebayimg\.com\//);
  assert.ok(expiresAt);
  const up2 = await (await call('/uploads', { token: a.idToken, method: 'POST', body: photoForm() })).json();
  assert.match(up2.url, /^https:\/\/i\.ebayimg\.com\/images\/g\/img-2\//);

  assert.equal((await call('/uploads', { token: a.idToken, method: 'POST', body: photoForm('text/plain', Buffer.from('hi')) })).status, 400);
  const huge = Buffer.alloc(4 * 1024 * 1024 + 10, 1);
  assert.equal((await call('/uploads', { token: a.idToken, method: 'POST', body: photoForm('image/jpeg', huge) })).status, 413);

  // Listings CRUD (+ on-device thumbnail stored on the listing)
  assert.equal((await call('/listings', { token: a.idToken, method: 'POST', body: { price: 5 } })).status, 400);
  assert.equal(
    (await call('/listings', { token: a.idToken, method: 'POST', body: { title: 'x', price: 1, thumbnail: 'https://not-a-data-url' } })).status,
    400
  );
  const created = await call('/listings', {
    token: a.idToken,
    method: 'POST',
    body: { title: 'Nintendo Switch OLED', price: '199.5', condition: 'used', category: 'consoles', photos: [photoUrl, up2.url], thumbnail: THUMB },
  });
  assert.equal(created.status, 201);
  const listing = await created.json();
  assert.equal(listing.price, 199.5);
  assert.equal(listing.thumbnail, THUMB);
  assert.deepEqual(listing.targets, []);

  assert.equal((await call(`/listings/${listing.id}`, { token: b.idToken })).status, 404, 'other users cannot read');
  assert.equal((await (await call('/listings', { token: b.idToken })).json()).length, 0);

  const edited = await (
    await call(`/listings/${listing.id}`, {
      token: a.idToken,
      method: 'PATCH',
      body: { title: 'Switch OLED (white)', photos: [photoUrl], ebayCategoryId: '139971', ebayCategoryName: 'Video Game Consoles' },
    })
  ).json();
  assert.equal(edited.title, 'Switch OLED (white)');
  assert.deepEqual(edited.photos, [photoUrl]);

  // Publish: unsupported marketplaces are refused; eBay publishes via the Inventory API.
  const pub = await (
    await call(`/listings/${listing.id}/publish`, { token: a.idToken, method: 'POST', body: { marketplaces: ['poshmark', 'ebay'] } })
  ).json();
  const byKey = Object.fromEntries(pub.results.map((r) => [r.marketplace, r]));
  assert.equal(byKey.poshmark.status, 'unsupported');
  assert.equal(byKey.ebay.status, 'published', byKey.ebay.error);
  assert.match(byKey.ebay.url, /\/itm\/110000000001$/);

  // Firestore rules: own user doc readable, eBay token doc and others' data not.
  const doc = (p, t) => fetch(`${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${p}`, { headers: { Authorization: `Bearer ${t}` } });
  assert.equal((await doc(`users/${a.localId}`, a.idToken)).status, 200);
  assert.equal((await doc(`users/${a.localId}`, b.idToken)).status, 403);
  assert.equal((await doc(`users/${a.localId}/private/ebay`, a.idToken)).status, 403);
  assert.equal((await doc(`listings/${listing.id}`, a.idToken)).status, 200);
  assert.equal((await doc(`listings/${listing.id}`, b.idToken)).status, 403);
  const write = await fetch(`${FS}/v1/projects/${PROJECT}/databases/(default)/documents/listings/${listing.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${a.idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { price: { doubleValue: 1 } } }),
  });
  assert.equal(write.status, 403, 'a partial client write that drops required fields is refused');

  // eBay Marketplace Account Deletion: challenge + notification
  const ch = await (await call('/ebay/account-deletion?challenge_code=abc')).json();
  const expected = crypto.createHash('sha256').update('abc' + 'v'.repeat(40) + process.env.EBAY_DELETION_ENDPOINT).digest('hex');
  assert.equal(ch.challengeResponse, expected);
  await db.doc(`users/${b.localId}`).set({ ebay: { connected: true, userId: 'ebay-user-1', settings: { paymentPolicyId: 'p' } } }, { merge: true });
  await db.doc(`users/${b.localId}/private/ebay`).set({ refreshToken: 'r' });
  const note = await call('/ebay/account-deletion', {
    method: 'POST',
    body: { metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION' }, notification: { data: { userId: 'ebay-user-1', username: 'x' } } },
  });
  assert.equal(note.status, 204);
  const bDoc = (await db.doc(`users/${b.localId}`).get()).data();
  assert.equal(bDoc.ebay.connected, false);
  assert.equal(bDoc.ebay.userId, undefined);
  assert.equal((await db.doc(`users/${b.localId}/private/ebay`).get()).exists, false);

  // Deleting a published listing also ends it on eBay.
  const del1 = await (await call(`/listings/${listing.id}`, { token: a.idToken, method: 'DELETE' })).json();
  assert.equal(del1.ebayEnded, true);
  assert.ok(ebayCalls.includes(`DELETE /sell/inventory/v1/inventory_item/RH-${listing.id}`));

  // Account deletion removes listings, eBay tokens, counters and the auth record.
  await call('/listings', { token: a.idToken, method: 'POST', body: { title: 'Lamp', price: 10, thumbnail: THUMB } });
  await call('/search?q=lamp', { token: a.idToken }); // creates a Firestore rate-limit counter for alice
  const del = await call('/account', { token: a.idToken, method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await del.json()).listings, 1);
  const signIn = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'alice@example.com', password: 'hunter2hunter2', returnSecureToken: true }),
  });
  assert.equal(signIn.status, 400);
  assert.equal((await db.collection('listings').where('userId', '==', a.localId).get()).size, 0);
  assert.equal((await db.doc(`users/${a.localId}`).get()).exists, false);
  assert.equal((await db.doc(`users/${a.localId}/private/ebay`).get()).exists, false);
  assert.equal((await db.collection('rateLimits').where('who', '==', `u:${a.localId}`).get()).size, 0);
  assert.equal((await db.collection('oauthStates').where('uid', '==', a.localId).get()).size, 0);
});
