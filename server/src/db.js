const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function filePathFor(collection) {
  return path.join(DATA_DIR, `${collection}.json`);
}

function readCollection(collection) {
  const file = filePathFor(collection);
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return [];
  return JSON.parse(raw);
}

function writeCollection(collection, rows) {
  const file = filePathFor(collection);
  fs.writeFileSync(file, JSON.stringify(rows, null, 2), 'utf8');
}

// Serialize writes per collection so concurrent requests don't clobber each other.
const writeQueues = new Map();
function withLock(collection, fn) {
  const prev = writeQueues.get(collection) || Promise.resolve();
  const next = prev.then(fn, fn);
  writeQueues.set(collection, next.catch(() => {}));
  return next;
}

const db = {
  id() {
    return crypto.randomUUID();
  },

  all(collection) {
    return readCollection(collection);
  },

  find(collection, predicate) {
    return readCollection(collection).find(predicate);
  },

  filter(collection, predicate) {
    return readCollection(collection).filter(predicate);
  },

  async insert(collection, row) {
    return withLock(collection, () => {
      const rows = readCollection(collection);
      rows.push(row);
      writeCollection(collection, rows);
      return row;
    });
  },

  async update(collection, id, patch) {
    return withLock(collection, () => {
      const rows = readCollection(collection);
      const idx = rows.findIndex((r) => r.id === id);
      if (idx === -1) return null;
      rows[idx] = { ...rows[idx], ...patch, updatedAt: new Date().toISOString() };
      writeCollection(collection, rows);
      return rows[idx];
    });
  },

  async remove(collection, id) {
    return withLock(collection, () => {
      const rows = readCollection(collection);
      const next = rows.filter((r) => r.id !== id);
      writeCollection(collection, next);
      return next.length !== rows.length;
    });
  },
};

module.exports = db;
