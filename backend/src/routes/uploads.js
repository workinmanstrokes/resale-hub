// Photo upload -> eBay Picture Services (free), using the signed-in seller's own eBay
// token (Media API createImageFromFile). Returns { url, expiresAt } where url is an
// https://i.ebayimg.com/... picture that listings can use. Nothing is stored on our
// side, so there is no Firebase Storage bucket (Storage now needs the Blaze plan).
//
// Size: serverless hosts cap request bodies (Vercel: 4.5 MB), so the app downsizes
// photos on the device before uploading; the API rejects anything over MAX_BYTES.
const express = require('express');
const Busboy = require('busboy');
const ebay = require('../adapters/ebay');
const ebayAccount = require('../lib/ebayAccount');
const { requireAuth } = require('../middleware/auth');
const { limits } = require('../middleware/rateLimit');
const { EXT_BY_MIME, uploadFilename } = require('../lib/uploadFilename');

const MAX_BYTES = 4 * 1024 * 1024;

const router = express.Router();
router.use(requireAuth, limits.upload);

// Reads the single "photo" field into memory. Resolves { buffer, mimeType, filename }.
function readPhoto(req) {
  return new Promise((resolve, reject) => {
    let busboy;
    try {
      busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_BYTES } });
    } catch {
      return reject(Object.assign(new Error('Expected a multipart/form-data upload'), { status: 400 }));
    }
    let file = null;
    let rejected = null;

    busboy.on('file', (field, stream, info) => {
      if (field !== 'photo' || !EXT_BY_MIME[info.mimeType]) {
        rejected = 'Only JPEG, PNG, WebP, HEIC or GIF photos are allowed (field "photo")';
        stream.resume();
        return;
      }
      const chunks = [];
      let tooBig = false;
      stream.on('limit', () => {
        tooBig = true;
      });
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => {
        file = tooBig
          ? { tooBig: true }
          : {
              buffer: Buffer.concat(chunks),
              mimeType: info.mimeType,
              filename: uploadFilename(info.mimeType, info.filename),
            };
      });
    });
    busboy.on('error', (err) => reject(Object.assign(err, { status: 400 })));
    busboy.on('close', () => {
      if (file?.tooBig) return reject(Object.assign(new Error('Photo is larger than 4 MB'), { status: 413 }));
      if (!file) {
        return reject(
          Object.assign(new Error(rejected || 'No file uploaded (expected field "photo")'), { status: 400 })
        );
      }
      resolve(file);
    });

    // Some hosts hand us an already-buffered body (Cloud Functions-style rawBody).
    if (req.rawBody) busboy.end(req.rawBody);
    else req.pipe(busboy);
  });
}

router.post('/', async (req, res) => {
  try {
    const photo = await readPhoto(req);
    let token;
    try {
      token = await ebayAccount.getUserAccessToken(req.uid);
    } catch (err) {
      if (err.extra?.code === 'not_connected') {
        return res.status(409).json({
          error: 'Connect your eBay account (Account tab) to add photos. eBay hosts listing photos for free.',
          code: 'not_connected',
        });
      }
      throw err;
    }
    const result = await ebay.uploadImage(token, photo.buffer, photo);
    res.status(201).json(result);
  } catch (err) {
    if (err.name === 'EbayError' || err instanceof ebay.EbayError) {
      return res.status(502).json({ error: `eBay could not take this photo: ${err.message}` });
    }
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

module.exports = router;
module.exports.MAX_BYTES = MAX_BYTES;
