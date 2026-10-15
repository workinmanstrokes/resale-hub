const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveUploadExtension, generateUploadFilename } = require('./uploadFilename');

test('resolveUploadExtension maps known image mimetypes', () => {
  assert.equal(resolveUploadExtension('image/jpeg', 'photo.bin'), '.jpg');
  assert.equal(resolveUploadExtension('image/png', 'photo.bin'), '.png');
  assert.equal(resolveUploadExtension('image/webp', 'photo.bin'), '.webp');
  assert.equal(resolveUploadExtension('image/heic', 'photo.bin'), '.heic');
  assert.equal(resolveUploadExtension('image/heif', 'photo.bin'), '.heif');
  assert.equal(resolveUploadExtension('image/gif', 'photo.bin'), '.gif');
});

test('resolveUploadExtension falls back to the original filename extension for unknown mimetypes', () => {
  assert.equal(resolveUploadExtension('image/bmp', 'photo.bmp'), '.bmp');
  assert.equal(resolveUploadExtension('application/octet-stream', 'scan.tiff'), '.tiff');
});

test('resolveUploadExtension falls back to .jpg when nothing else resolves', () => {
  assert.equal(resolveUploadExtension('image/bmp', 'photo-with-no-extension'), '.jpg');
  assert.equal(resolveUploadExtension('image/bmp', ''), '.jpg');
  assert.equal(resolveUploadExtension('image/bmp', undefined), '.jpg');
});

test('resolveUploadExtension ignores path separators in the original filename', () => {
  assert.equal(resolveUploadExtension('application/octet-stream', '../../etc/passwd'), '.jpg');
  assert.equal(resolveUploadExtension('application/octet-stream', '../../etc/passwd.png'), '.png');
});

test('generateUploadFilename produces a UUID-based name with the resolved extension', () => {
  const name = generateUploadFilename('image/png', 'anything.jpg');
  assert.match(name, /^[0-9a-f-]{36}\.png$/);
});

test('generateUploadFilename never embeds path separators from the original filename', () => {
  const name = generateUploadFilename('application/octet-stream', '../../etc/passwd.png');
  assert.doesNotMatch(name, /[\\/]/);
  assert.match(name, /^[0-9a-f-]{36}\.png$/);
});
