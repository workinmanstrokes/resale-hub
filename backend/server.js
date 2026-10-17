// Plain Node server for local development or any Node host (Render, Fly.io, a home PC).
// Loads backend/.env if present (Node's built-in --env-file is used when available).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

const handler = require('./src/handler');
const port = Number(process.env.PORT) || 8787;
http.createServer(handler).listen(port, () => {
  console.log(`Resale Hub API listening on http://localhost:${port}/api`);
});
