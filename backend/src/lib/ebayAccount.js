// Per-user eBay connection, stored in Firestore:
//   users/{uid}                 -> ebay: { connected, environment, settings, options, ... }  (owner-readable)
//   users/{uid}/private/ebay    -> OAuth tokens (never readable by clients; see firestore.rules)
const ebay = require('../adapters/ebay');
const { db, FieldValue } = require('./firebase');
const { HttpError } = require('./errors');

const userRef = (uid) => db.collection('users').doc(uid);
const tokenRef = (uid) => userRef(uid).collection('private').doc('ebay');

async function saveTokens(uid, tokenSet) {
  const now = Date.now();
  await tokenRef(uid).set(
    {
      environment: ebay.cfg().environment,
      accessToken: tokenSet.access_token,
      accessTokenExpiresAt: now + tokenSet.expires_in * 1000,
      ...(tokenSet.refresh_token
        ? {
            refreshToken: tokenSet.refresh_token,
            refreshTokenExpiresAt: now + (tokenSet.refresh_token_expires_in || 0) * 1000,
          }
        : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

// Returns a valid user access token, refreshing (and persisting) it when needed.
async function getUserAccessToken(uid) {
  const snap = await tokenRef(uid).get();
  const t = snap.exists ? snap.data() : null;
  if (!t?.refreshToken || t.environment !== ebay.cfg().environment) {
    throw new HttpError(409, 'Connect your eBay account first (Account tab).', { code: 'not_connected' });
  }
  if (t.accessToken && t.accessTokenExpiresAt > Date.now() + 120_000) return t.accessToken;
  try {
    const refreshed = await ebay.refreshAccessToken(t.refreshToken);
    await saveTokens(uid, refreshed);
    return refreshed.access_token;
  } catch (err) {
    if (err.status === 400 || err.status === 401) {
      await markDisconnected(uid, 'Your eBay authorization expired. Please reconnect eBay.');
      throw new HttpError(409, 'Your eBay authorization expired. Please reconnect eBay.', { code: 'not_connected' });
    }
    throw err;
  }
}

async function markDisconnected(uid, reason = null) {
  await Promise.all([
    tokenRef(uid).delete(),
    userRef(uid).set(
      { ebay: { connected: false, disconnectedReason: reason, updatedAt: FieldValue.serverTimestamp() } },
      { merge: true }
    ),
  ]);
}

// Pull the seller's business policies + inventory locations from eBay and store them.
async function refreshSellerSettings(uid, token) {
  const accessToken = token || (await getUserAccessToken(uid));
  const current = (await userRef(uid).get()).data()?.ebay?.settings || {};
  let options;
  let error = null;
  try {
    options = await ebay.fetchSellerOptions(accessToken);
  } catch (err) {
    // Commonly: seller not opted in to business policies yet.
    options = { fulfillmentPolicies: [], paymentPolicies: [], returnPolicies: [], locations: [] };
    error = err.message;
  }
  const settings = ebay.chooseDefaults(options, current);
  const ebayDoc = {
    connected: true,
    environment: ebay.cfg().environment,
    options,
    settings,
    missing: ebay.missingSettings(settings),
    settingsError: error,
    settingsRefreshedAt: FieldValue.serverTimestamp(),
  };
  await userRef(uid).set({ ebay: ebayDoc }, { merge: true });
  return (await userRef(uid).get()).data().ebay;
}

async function getSettings(uid) {
  const data = (await userRef(uid).get()).data();
  return data?.ebay?.settings || {};
}

module.exports = {
  userRef,
  tokenRef,
  saveTokens,
  getUserAccessToken,
  markDisconnected,
  refreshSellerSettings,
  getSettings,
};
