// Post everywhere — seller page logic.
// Picks a listing, ticks the free-to-list sites, asks the API to prepare
// an identical per-site listing, then hands the seller a copy button and
// a deep link into each site's own create flow. Nothing here posts to a
// marketplace: for Facebook Marketplace, Whatnot, Poshmark, Mercari and
// OfferUp there is no public API, so the seller taps Publish there.
// eBay publishes from the Resale Hub mobile app (My Listings -> eBay).
// No listings, prices or "posted" statuses are ever invented here —
// everything comes from the API, and "I posted it" is only recorded
// when the seller taps it themselves.
(function () {
  const errorEl = document.getElementById('error');
  const setupNote = document.getElementById('setup-note');
  const CFG = window.STORE_CONFIG || {};

  if (!CFG.firebase || !CFG.firebase.apiKey || CFG.firebase.apiKey.indexOf('YOUR_') === 0) {
    setupNote.hidden = false;
    setupNote.textContent = 'Seller sign-in is not set up yet: the Firebase web API key is missing from config.js. See the storefront README.';
    document.getElementById('signin').hidden = true;
    return;
  }
  if (typeof firebase === 'undefined') {
    setupNote.hidden = false;
    setupNote.textContent = 'Could not load Firebase sign-in (network or CDN blocked). Check your connection and try again.';
    document.getElementById('signin').hidden = true;
    return;
  }
  firebase.initializeApp(CFG.firebase);
  const auth = firebase.auth();

  let sites = [];
  let listings = [];
  let prepared = null;

  async function authed(path, opts) {
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in');
    const token = await user.getIdToken();
    return RH.api(path, { ...(opts || {}), headers: { Authorization: 'Bearer ' + token } });
  }

  function renderSites() {
    const box = document.getElementById('site-pick');
    box.innerHTML = sites.map((s) => {
      const methodLabel = s.method === 'api'
        ? 'Auto via API — in the mobile app'
        : 'Prefill — you publish';
      return '<label><input type="checkbox" value="' + RH.esc(s.id) + '" checked>'
        + '<span><strong>' + RH.esc(s.name) + '</strong> '
        + '<span class="method' + (s.method === 'api' ? ' api' : '') + '">' + RH.esc(methodLabel) + '</span><br>'
        + '<span class="meta">' + RH.esc(s.feeNote) + ' ' + RH.esc(s.note) + '</span></span></label>';
    }).join('');
    document.getElementById('prepare-btn').disabled = false;
  }

  function renderListings() {
    document.getElementById('listings-loading').hidden = true;
    if (!listings.length) {
      document.getElementById('listings-empty').hidden = false;
      return;
    }
    const sel = document.getElementById('listing');
    document.getElementById('listing-picker').hidden = false;
    sel.innerHTML = listings.map((l) => {
      const posted = l.crossposts ? Object.keys(l.crossposts).length : 0;
      return '<option value="' + RH.esc(l.id) + '">'
        + RH.esc(l.title) + ' — ' + RH.esc(RH.moneyDollars(l.price))
        + (posted ? ' · posted on ' + posted + ' site' + (posted > 1 ? 's' : '') : '')
        + '</option>';
    }).join('');
  }

  function selectedSites() {
    return Array.from(document.querySelectorAll('#site-pick input:checked')).map((c) => c.value);
  }

  function renderResults() {
    const section = document.getElementById('results-section');
    const box = document.getElementById('results');
    section.hidden = false;
    box.innerHTML = prepared.sites.map((p) => {
      const already = prepared.crossposts && prepared.crossposts[p.site];
      return '<article class="card"><div class="card-body">'
        + '<h2>' + RH.esc(p.name) + ' '
        + '<span class="method' + (p.method === 'api' ? ' api' : '') + '">'
        + RH.esc(p.method === 'api' ? 'Auto via API — in the mobile app' : 'Prefill — you publish') + '</span></h2>'
        + '<div class="meta">' + RH.esc(p.feeNote) + '</div>'
        + (p.titleNote ? '<p class="notice">' + RH.esc(p.titleNote) + '</p>' : '')
        + '<p><strong>' + RH.esc(p.title) + '</strong><br>' + RH.esc(RH.moneyDollars(p.price)) + ' · ' + RH.esc(p.condition)
        + (p.category ? ' · ' + RH.esc(p.category) : '') + '</p>'
        + '<pre>' + RH.esc(p.copyText) + '</pre>'
        + (p.photos && p.photos.length
          ? '<p class="meta">' + p.photos.length + ' photo' + (p.photos.length > 1 ? 's' : '') + ' on the listing — add them on the site too. First photo: <a href="' + RH.esc(p.photos[0]) + '" target="_blank" rel="noopener">view</a></p>'
          : '<p class="meta">No photos on this listing — add photos on the site or the listing may not publish.</p>')
        + '<p class="meta">' + RH.esc(p.note) + '</p>'
        + '<div class="row">'
        + '<button type="button" class="btn secondary" data-copy="' + RH.esc(p.site) + '">Copy listing text</button>'
        + '<a class="btn" href="' + RH.esc(p.deepLink) + '" target="_blank" rel="noopener">Open in ' + RH.esc(p.name) + '</a>'
        + '<button type="button" class="btn secondary" data-posted="' + RH.esc(p.site) + '"'
        + (already ? ' disabled' : '') + '>'
        + (already ? '✓ Posted by you' : 'I posted it') + '</button>'
        + '</div>'
        + (already ? '<p class="posted-flag">Recorded as posted by you' + (already.url ? ' — <a href="' + RH.esc(already.url) + '" target="_blank" rel="noopener">view listing</a>' : '') + '</p>' : '')
        + '</div></article>';
    }).join('');

    box.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const p = prepared.sites.find((x) => x.site === btn.getAttribute('data-copy'));
        if (!p) return;
        const ok = await RH.copyText(p.copyText);
        btn.textContent = ok ? 'Copied ✓' : 'Copy failed — select the text manually';
        setTimeout(() => { btn.textContent = 'Copy listing text'; }, 2000);
      });
    });
    box.querySelectorAll('[data-posted]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const site = btn.getAttribute('data-posted');
        const url = prompt('Paste the live listing URL on that site (optional — leave blank if you do not have it):', '') || undefined;
        btn.disabled = true;
        try {
          await authed('/crosspost/' + encodeURIComponent(prepared.listingId) + '/mark-posted', {
            method: 'POST',
            body: JSON.stringify(url ? { site, url } : { site }),
          });
          btn.textContent = '✓ Posted by you';
          loadAll();
        } catch (err) {
          btn.disabled = false;
          RH.showError(errorEl, err);
        }
      });
    });
  }

  async function loadAll() {
    try {
      const [siteRows, listingRows] = await Promise.all([
        authed('/crosspost/sites'),
        authed('/crosspost/listings'),
      ]);
      sites = Array.isArray(siteRows) ? siteRows : [];
      listings = Array.isArray(listingRows) ? listingRows : [];
      renderSites();
      renderListings();
    } catch (err) {
      RH.showError(errorEl, err);
    }
  }

  document.getElementById('prepare-btn').addEventListener('click', async () => {
    errorEl.hidden = true;
    const listingId = document.getElementById('listing').value;
    const chosen = selectedSites();
    if (!listingId) { RH.showError(errorEl, new Error('Pick a listing first.')); return; }
    if (!chosen.length) { RH.showError(errorEl, new Error('Pick at least one site.')); return; }
    const btn = document.getElementById('prepare-btn');
    btn.disabled = true;
    try {
      const res = await authed('/crosspost/' + encodeURIComponent(listingId) + '/prepare', {
        method: 'POST',
        body: JSON.stringify({ sites: chosen }),
      });
      const listing = listings.find((l) => l.id === listingId) || {};
      prepared = { ...res, crossposts: listing.crossposts || {} };
      renderResults();
      document.getElementById('results-section').scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      RH.showError(errorEl, err);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('sign-in-btn').addEventListener('click', async () => {
    errorEl.hidden = true;
    try {
      await auth.signInWithEmailAndPassword(
        document.getElementById('email').value.trim(),
        document.getElementById('password').value,
      );
    } catch (err) {
      RH.showError(errorEl, err);
    }
  });
  document.getElementById('sign-out-btn').addEventListener('click', () => auth.signOut());

  auth.onAuthStateChanged((user) => {
    const signedIn = Boolean(user);
    document.getElementById('signin').hidden = signedIn;
    document.getElementById('app').hidden = !signedIn;
    if (signedIn) {
      document.getElementById('who').textContent = user.email || user.uid;
      loadAll();
    }
  });
})();
