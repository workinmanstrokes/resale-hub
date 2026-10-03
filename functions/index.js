// Resale Hub API — a single HTTPS Cloud Function (2nd gen, Node 22) wrapping an
// Express app. Firebase Hosting rewrites /api/** to it (see ../firebase.json), so
// the mobile app's EXPO_PUBLIC_API_URL is https://<project>.web.app/api.
const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { SECRETS } = require('./src/lib/secrets');
const { createApp } = require('./src/app');

// Hard cap on instances keeps a traffic spike (or abuse) from running up the bill.
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

exports.api = onRequest(
  {
    secrets: SECRETS,
    memory: '512MiB',
    timeoutSeconds: 60,
    concurrency: 40,
    cors: false, // handled by the Express app
  },
  createApp()
);
