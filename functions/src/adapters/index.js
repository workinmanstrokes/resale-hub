const ebay = require('./ebay');
const etsy = require('./etsy');
const unsupported = require('./unsupported');

// Central registry every route uses to know what's real and what's not.
const registry = { ebay, etsy, ...unsupported };

function list() {
  return Object.values(registry).map((a) => ({
    key: a.key,
    label: a.label,
    capabilities: a.capabilities,
    configured: a.configured,
    note: a.note || null,
  }));
}

function get(key) {
  return Object.prototype.hasOwnProperty.call(registry, key) ? registry[key] : null;
}

function searchable() {
  return Object.values(registry).filter((a) => a.configured && a.capabilities.includes('search'));
}

module.exports = { registry, list, get, searchable };
