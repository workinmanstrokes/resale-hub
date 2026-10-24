const { auth } = require('../lib/firebase');

function bearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

async function verify(req) {
  const token = bearer(req);
  if (!token) return null;
  const decoded = await auth.verifyIdToken(token);
  req.uid = decoded.uid;
  req.userEmail = decoded.email || null;
  return decoded;
}

// Firebase Auth ID token required.
async function requireAuth(req, res, next) {
  try {
    if (!(await verify(req))) return res.status(401).json({ error: 'Sign in required' });
    next();
  } catch {
    res.status(401).json({ error: 'Your session expired. Please sign in again.' });
  }
}

// Token optional (e.g. search): identifies the user for rate limiting when present.
async function optionalAuth(req, res, next) {
  try {
    await verify(req);
  } catch {
    // ignore a bad/expired token on public routes
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
