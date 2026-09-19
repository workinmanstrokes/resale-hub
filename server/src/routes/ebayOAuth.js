const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const ebay = require('../adapters/ebay');

const router = express.Router();

// Mobile app opens this URL in a browser, passing its JWT as ?token=.
// We re-sign a short-lived "state" token so the callback (hit by eBay's redirect,
// with no Authorization header available) can trust which user this was for.
router.get('/start', (req, res) => {
  if (!ebay.configured) {
    return res.status(503).send('eBay is not configured on this server.');
  }

  const { token } = req.query;
  if (!token) return res.status(400).send('Missing token');

  let userId;
  try {
    userId = jwt.verify(token, process.env.JWT_SECRET).sub;
  } catch {
    return res.status(401).send('Invalid or expired session token');
  }

  const state = jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '10m' });
  res.redirect(ebay.getAuthorizationUrl(state));
});

router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.status(400).send(`eBay authorization failed: ${error}`);

  let userId;
  try {
    userId = jwt.verify(state, process.env.JWT_SECRET).sub;
  } catch {
    return res.status(401).send('Invalid or expired authorization state');
  }

  try {
    const tokenSet = await ebay.exchangeCodeForToken(code);
    await db.update('users', userId, { ebayRefreshToken: tokenSet.refresh_token });
    res.send('<html><body>eBay connected. You can close this tab and return to the app.</body></html>');
  } catch (err) {
    res.status(502).send(`Failed to connect eBay: ${err.message}`);
  }
});

module.exports = router;
