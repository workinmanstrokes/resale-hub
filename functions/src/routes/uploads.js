// Photo upload -> Firebase Storage (users/<uid>/photos/<uuid>.<ext>), returning a
// public download-token URL that eBay can fetch. Cloud Functions buffers the body
// (req.rawBody), so busboy parses that buffer instead of the stream.
const express = require('express');
const Busboy = require('busboy');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { limits } = require('../middleware/rateLimit');
const { bucket } = require('../lib/firebase');
const { downloadUrl, newObjectPath } = require('../lib/photos');

const MAX_BYTES = 8 * 1024 * 1024;
const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/gif': '.gif',
};

const router = express.Router();
router.use(requireAuth, limits.upload);

router.post('/', (req, res, next) => {
  let busboy;
  try {
    busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_BYTES } });
  } catch {
    return res.status(400).json({ error: 'Expected a multipart/form-data upload' });
  }

  let pending = null;
  let rejected = null;

  busboy.on('file', (field, stream, info) => {
    const ext = EXT_BY_MIME[info.mimeType];
    if (field !== 'photo' || !ext) {
      rejected = 'Only JPEG, PNG, WebP, HEIC or GIF photos are allowed (field "photo")';
      stream.resume();
      return;
    }
    const objectPath = newObjectPath(req.uid, ext);
    const token = crypto.randomUUID();
    const file = bucket().file(objectPath);
    let tooBig = false;
    stream.on('limit', () => {
      tooBig = true;
    });
    pending = new Promise((resolve, reject) => {
      const out = file.createWriteStream({
        resumable: false,
        metadata: {
          contentType: info.mimeType,
          cacheControl: 'public, max-age=31536000',
          metadata: { firebaseStorageDownloadTokens: token, ownerUid: req.uid },
        },
      });
      stream.pipe(out).on('finish', resolve).on('error', reject);
    }).then(async () => {
      if (tooBig) {
        await file.delete({ ignoreNotFound: true });
        throw Object.assign(new Error('Photo is larger than 8 MB'), { status: 413 });
      }
      return { url: downloadUrl(bucket().name, objectPath, token), path: objectPath };
    });
  });

  busboy.on('error', (err) => next(err));
  busboy.on('close', async () => {
    try {
      if (!pending) return res.status(400).json({ error: rejected || 'No file uploaded (expected field "photo")' });
      const result = await pending;
      res.status(201).json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.status ? err.message : 'Upload failed' });
      if (!err.status) console.error(err);
    }
  });

  if (req.rawBody) busboy.end(req.rawBody);
  else req.pipe(busboy);
});

module.exports = router;
