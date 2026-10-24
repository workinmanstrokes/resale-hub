const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { limits } = require('../middleware/rateLimit');
const { wrap } = require('../lib/errors');
const { ensureUser, publicUser, deleteAccount } = require('../lib/users');

const router = express.Router();
router.use(requireAuth);

router.get(
  '/me',
  limits.general,
  wrap(async (req, res) => {
    const data = await ensureUser(req.uid, req.userEmail);
    res.json({ user: publicUser(req.uid, data) });
  })
);

// In-app account deletion. The app re-authenticates (password) right before calling this.
router.delete(
  '/',
  limits.sensitive,
  wrap(async (req, res) => {
    const result = await deleteAccount(req.uid);
    res.json({ deleted: true, ...result });
  })
);

module.exports = router;
