// Firebase Admin SDK, used only for Firestore (Spark plan, no billing) and for
// verifying Firebase Auth ID tokens. Runs on any host:
//  - Production: FIREBASE_SERVICE_ACCOUNT holds the service-account JSON (raw or
//    base64) from Firebase console > Project settings > Service accounts.
//  - Emulators/tests: no credential needed (FIRESTORE_EMULATOR_HOST etc. are set).
// preferRest makes Firestore talk HTTPS/REST instead of gRPC: faster cold starts on
// serverless hosts, and no native gRPC needed on Cloudflare Workers.
const admin = require('firebase-admin');
const { initializeFirestore } = require('firebase-admin/firestore');
const { env } = require('./secrets');

function parseServiceAccount(raw) {
  if (!raw) return null;
  const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const sa = JSON.parse(text);
  if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  return sa;
}

function init() {
  if (admin.apps.length) return admin.app();
  const sa = parseServiceAccount(env('FIREBASE_SERVICE_ACCOUNT'));
  const projectId =
    process.env.FIREBASE_PROJECT_ID || sa?.project_id || process.env.GCLOUD_PROJECT || undefined;
  return admin.initializeApp({
    ...(projectId ? { projectId } : {}),
    ...(sa ? { credential: admin.credential.cert(sa) } : {}),
  });
}

const app = init();

// (The emulator is reached over gRPC: the REST transport insists on real Google
// credentials even when FIRESTORE_EMULATOR_HOST is set.)
const db = initializeFirestore(app, { preferRest: !process.env.FIRESTORE_EMULATOR_HOST });
db.settings({ ignoreUndefinedProperties: true });

module.exports = {
  admin,
  db,
  auth: admin.auth(),
  FieldValue: admin.firestore.FieldValue,
  Timestamp: admin.firestore.Timestamp,
  parseServiceAccount,
};
