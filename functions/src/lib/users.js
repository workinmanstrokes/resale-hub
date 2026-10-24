const { db, auth, bucket, FieldValue } = require('./firebase');

const userRef = (uid) => db.collection('users').doc(uid);

async function ensureUser(uid, email) {
  const ref = userRef(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({ email: email || null, createdAt: FieldValue.serverTimestamp() });
    return (await ref.get()).data();
  }
  return snap.data();
}

function publicUser(uid, data = {}) {
  const e = data.ebay || {};
  return {
    id: uid,
    email: data.email || null,
    ebayConnected: Boolean(e.connected),
    ebay: e.connected
      ? {
          environment: e.environment || null,
          settings: e.settings || {},
          options: e.options || {},
          missing: e.missing || [],
          settingsError: e.settingsError || null,
        }
      : { disconnectedReason: e.disconnectedReason || null },
  };
}

async function deleteQueryInBatches(query) {
  let deleted = 0;
  for (;;) {
    const snap = await query.limit(400).get();
    if (snap.empty) return deleted;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
  }
}

// Account deletion (App Store guideline 5.1.1(v) / Google Play account-deletion policy):
// removes listings, eBay tokens/settings, pending OAuth states, every uploaded photo,
// and finally the Firebase Auth record.
async function deleteAccount(uid) {
  const listings = await deleteQueryInBatches(db.collection('listings').where('userId', '==', uid));
  await deleteQueryInBatches(db.collection('oauthStates').where('uid', '==', uid));
  await db.recursiveDelete(userRef(uid)); // user doc + private/ebay tokens
  await bucket().deleteFiles({ prefix: `users/${uid}/`, force: true });
  try {
    await auth.deleteUser(uid);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
  }
  return { listings };
}

module.exports = { userRef, ensureUser, publicUser, deleteAccount };
