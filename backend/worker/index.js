// Cloudflare Workers adapter (free plan) - EXPERIMENTAL, not yet run on Cloudflare.
// Vercel (backend/api/index.js) is the tested, recommended host.
//
// Runs the same Express app through Workers' Node.js HTTP compatibility
// (nodejs_compat + httpServerHandler). Config lives in Worker secrets/vars
// (`wrangler secret put EBAY_CLIENT_SECRET`, etc.); they are copied into process.env,
// which is where the shared code reads them. Firestore uses its REST transport here
// (see src/lib/firebase.js), since Workers have no gRPC.
import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import http from 'node:http';

for (const [key, value] of Object.entries(env)) {
  if (typeof value === 'string' && process.env[key] === undefined) process.env[key] = value;
}

const { default: handler } = await import('../src/handler.js');
http.createServer(handler).listen(8080);

export default httpServerHandler({ port: 8080 });
