// Photos live in Firebase Storage under users/<uid>/photos/. Each file gets a
// Firebase download token so it has a stable public https URL that eBay can fetch
// when it copies images into a listing.
const crypto = require('crypto');
const { bucket } = require('./firebase');

function storageHost() {
  const emu = process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST;
  if (emu) return emu.startsWith('http') ? emu : `http://${emu}`;
  return 'https://firebasestorage.googleapis.com';
}

function downloadUrl(bucketName, objectPath, token) {
  return `${storageHost()}/v0/b/${bucketName}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

function newObjectPath(uid, ext) {
  return `users/${uid}/photos/${crypto.randomUUID()}${ext}`;
}

// Returns the Storage object path for a URL we issued for this user, or null for
// anything else (pasted third-party URLs, other users' files).
function ownedObjectPath(url, uid) {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (!match) return null;
    const objectPath = decodeURIComponent(match[2]);
    return objectPath.startsWith(`users/${uid}/`) ? objectPath : null;
  } catch {
    return null;
  }
}

async function deleteOwnedPhotos(urls, uid) {
  const paths = (urls || []).map((u) => ownedObjectPath(u, uid)).filter(Boolean);
  await Promise.all(
    paths.map((p) => bucket().file(p).delete({ ignoreNotFound: true }).catch(() => {}))
  );
  return paths.length;
}

module.exports = { downloadUrl, newObjectPath, ownedObjectPath, deleteOwnedPhotos };
