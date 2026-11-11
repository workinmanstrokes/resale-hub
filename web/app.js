// Shared storefront helpers: API client, cart (localStorage), money, HTML escaping.
// No prices or listings are ever hard-coded here — everything comes from the API.
(function () {
  const CFG = window.STORE_CONFIG || {};
  const API = (CFG.apiUrl || '').replace(/\/$/, '');
  const CART_KEY = 'rh_cart_v1';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function moneyDollars(dollars) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(dollars) || 0);
  }

  function moneyCents(cents) {
    return moneyDollars((Number(cents) || 0) / 100);
  }

  async function api(path, opts) {
    const res = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json', ...(opts && opts.headers ? opts.headers : {}) },
      ...(opts || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Request failed');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ---- Cart (stored on the buyer's own device only) ----
  function loadCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((l) => l && typeof l.id === 'string' && Number.isInteger(l.qty) && l.qty > 0)
        .slice(0, 20);
    } catch {
      return [];
    }
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartBadge();
  }

  function addToCart(id, qty) {
    const cart = loadCart();
    const line = cart.find((l) => l.id === id);
    if (line) line.qty = Math.min(99, line.qty + qty);
    else cart.push({ id, qty });
    saveCart(cart);
  }

  function setQty(id, qty) {
    let cart = loadCart();
    if (qty <= 0) cart = cart.filter((l) => l.id !== id);
    else cart.forEach((l) => { if (l.id === id) l.qty = Math.min(99, qty); });
    saveCart(cart);
  }

  function clearCart() {
    saveCart([]);
  }

  function cartCount() {
    return loadCart().reduce((n, l) => n + l.qty, 0);
  }

  function updateCartBadge() {
    document.querySelectorAll('[data-cart-count]').forEach((el) => {
      const n = cartCount();
      el.textContent = n > 0 ? String(n) : '';
      el.hidden = n === 0;
    });
  }

  function itemUrl(id) {
    return location.origin + '/item.html?id=' + encodeURIComponent(id);
  }

  function shareText(listing) {
    return `${listing.title} — ${moneyDollars(listing.price)} on ${CFG.storeName || 'Resale Hub'}`;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
      return ok;
    }
  }

  function showError(el, err) {
    if (!el) return;
    el.hidden = false;
    el.textContent = err && err.message ? err.message : 'Something went wrong. Please try again.';
  }

  window.RH = {
    CFG, API, esc, moneyDollars, moneyCents, api,
    loadCart, saveCart, addToCart, setQty, clearCart, cartCount, updateCartBadge,
    itemUrl, shareText, copyText, showError,
  };

  document.addEventListener('DOMContentLoaded', updateCartBadge);
})();
