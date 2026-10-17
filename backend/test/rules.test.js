// firestore.rules tests against the Firestore emulator, using its REST API with real
// Auth-emulator ID tokens (no extra dependencies). Run via `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-resale-hub';
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const FS = `http://${process.env.FIRESTORE_EMULATOR_HOST}`;
const DOCS = `${FS}/v1/projects/${PROJECT}/databases/(default)/documents`;

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

// JS value -> Firestore REST Value
function v(x) {
  if (x === null) return { nullValue: null };
  if (typeof x === 'string') return { stringValue: x };
  if (typeof x === 'boolean') return { booleanValue: x };
  if (Number.isInteger(x)) return { integerValue: String(x) };
  if (typeof x === 'number') return { doubleValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(v) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(x).map(([k, y]) => [k, v(y)])) } };
}
const fields = (obj) => Object.fromEntries(Object.entries(obj).map(([k, x]) => [k, v(x)]));

const auth = (t) => (t ? { Authorization: `Bearer ${t}` } : {});
const get = (path, t) => fetch(`${DOCS}/${path}`, { headers: auth(t) }).then((r) => r.status);
const put = (path, data, t) =>
  fetch(`${DOCS}/${path}`, {
    method: 'PATCH',
    headers: { ...auth(t), 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: fields(data) }),
  }).then((r) => r.status);
const del = (path, t) => fetch(`${DOCS}/${path}`, { method: 'DELETE', headers: auth(t) }).then((r) => r.status);
// Admin write (emulator "owner" token bypasses rules) for fixtures.
const seed = (path, data) =>
  fetch(`${DOCS}/${path}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: fields(data) }),
  }).then((r) => assert.equal(r.status, 200));

test('firestore.rules: owner-only, validated listings; server-only user/eBay/bookkeeping docs', async () => {
  const a = await signUp('rules-a@example.com');
  const b = await signUp('rules-b@example.com');
  const A = a.localId;
  const listing = (over = {}) => ({ userId: A, title: 'Lamp', price: 12.5, condition: 'used', photos: [], targets: {}, ...over });

  // users/{uid}: owner read only; nobody writes (eBay connection is server-set)
  await seed(`users/${A}`, { email: 'rules-a@example.com', ebay: { connected: false } });
  assert.equal(await get(`users/${A}`, a.idToken), 200);
  assert.equal(await get(`users/${A}`, b.idToken), 403);
  assert.equal(await get(`users/${A}`), 403);
  assert.equal(await put(`users/${A}`, { email: 'x', ebay: { connected: true } }, a.idToken), 403);

  // eBay tokens: never client-accessible, even to the owner
  await seed(`users/${A}/private/ebay`, { refreshToken: 'r' });
  assert.equal(await get(`users/${A}/private/ebay`, a.idToken), 403);
  assert.equal(await put(`users/${A}/private/ebay`, { refreshToken: 'mine' }, a.idToken), 403);

  // listings: valid owner create OK; bad fields / other owner / fake publish state refused
  assert.equal(await put('listings/l1', listing(), a.idToken), 200);
  assert.equal(await put('listings/l2', listing({ userId: b.localId }), a.idToken), 403, 'cannot create for someone else');
  assert.equal(await put('listings/l3', listing({ title: '' }), a.idToken), 403);
  assert.equal(await put('listings/l3', listing({ title: 'x'.repeat(81) }), a.idToken), 403);
  assert.equal(await put('listings/l3', listing({ price: -1 }), a.idToken), 403);
  assert.equal(await put('listings/l3', listing({ price: '5' }), a.idToken), 403);
  assert.equal(await put('listings/l3', listing({ condition: 'mint' }), a.idToken), 403);
  assert.equal(await put('listings/l3', listing({ photos: Array(13).fill('https://x') }), a.idToken), 403);
  assert.equal(await put('listings/l3', listing({ thumbnail: 'https://evil' }), a.idToken), 403);
  assert.equal(await put('listings/l3', listing({ isAdmin: true }), a.idToken), 403, 'unknown fields refused');
  assert.equal(await put('listings/l3', listing({ targets: { ebay: { status: 'published' } } }), a.idToken), 403);
  assert.equal(await put('listings/l3', listing(), b.idToken), 403, 'signed-in non-owner');
  assert.equal(await put('listings/l3', listing()), 403, 'signed out');

  // read: owner only
  assert.equal(await get('listings/l1', a.idToken), 200);
  assert.equal(await get('listings/l1', b.idToken), 403);

  // update: owner may edit fields but not ownership or publishing state
  assert.equal(await put('listings/l1', listing({ title: 'Desk lamp', price: 15 }), a.idToken), 200);
  assert.equal(await put('listings/l1', listing({ userId: b.localId }), a.idToken), 403);
  assert.equal(await put('listings/l1', listing({ targets: { ebay: { status: 'published' } } }), a.idToken), 403);
  assert.equal(await put('listings/l1', listing({ userId: b.localId }), b.idToken), 403, 'non-owner cannot take over');

  // delete: owner only
  assert.equal(await del('listings/l1', b.idToken), 403);
  assert.equal(await del('listings/l1', a.idToken), 200);

  // server-only bookkeeping + unknown collections
  await seed('rateLimits/x', { count: 1 });
  await seed('oauthStates/s', { uid: A });
  for (const p of ['rateLimits/x', 'oauthStates/s', 'anything/else']) {
    assert.equal(await get(p, a.idToken), 403, p);
    assert.equal(await put(p, { uid: A }, a.idToken), 403, p);
  }
});
