const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function issueToken(user) {
  return jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    ebayConnected: Boolean(user.ebayRefreshToken),
  };
}

router.post('/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'email and password (8+ chars) are required' });
  }

  const existing = db.find('users', (u) => u.email.toLowerCase() === email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await db.insert('users', {
    id: db.id(),
    email,
    passwordHash,
    ebayRefreshToken: null,
    createdAt: new Date().toISOString(),
  });

  res.status(201).json({ token: issueToken(user), user: publicUser(user) });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = db.find('users', (u) => u.email.toLowerCase() === (email || '').toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const ok = await bcrypt.compare(password || '', user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

  res.json({ token: issueToken(user), user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.find('users', (u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(user) });
});

module.exports = router;
