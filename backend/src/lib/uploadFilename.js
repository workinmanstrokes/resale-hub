// Photo type checks shared by the upload route (ported from server/src/utils on master).
const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/gif': '.gif',
};

function resolveUploadExtension(mimetype, originalname) {
  if (EXT_BY_MIME[mimetype]) return EXT_BY_MIME[mimetype];
  const m = /\.[A-Za-z0-9]{1,5}$/.exec(originalname || '');
  return m ? m[0].toLowerCase() : '.jpg';
}

function uploadFilename(mimetype, originalname) {
  return `resale-hub-${Date.now()}${resolveUploadExtension(mimetype, originalname)}`;
}

module.exports = { EXT_BY_MIME, resolveUploadExtension, uploadFilename };
