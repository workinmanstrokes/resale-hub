const path = require('path');
const crypto = require('crypto');

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/gif': '.gif',
};

function resolveUploadExtension(mimetype, originalname) {
  return EXT_BY_MIME[mimetype] || path.extname(originalname || '') || '.jpg';
}

function generateUploadFilename(mimetype, originalname) {
  return `${crypto.randomUUID()}${resolveUploadExtension(mimetype, originalname)}`;
}

module.exports = { EXT_BY_MIME, resolveUploadExtension, generateUploadFilename };
