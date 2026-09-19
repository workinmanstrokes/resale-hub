// Marketplaces with no free/public API for third-party search or listing creation.
// We surface them honestly as "not available" rather than faking data, per the
// project's data-sourcing rule (real/free APIs only).
function makeUnsupported(key, label, note) {
  return {
    key,
    label,
    capabilities: [],
    configured: false,
    note,
  };
}

module.exports = {
  poshmark: makeUnsupported(
    'poshmark',
    'Poshmark',
    'Poshmark has no public developer API for search or listing creation.'
  ),
  mercari: makeUnsupported(
    'mercari',
    'Mercari',
    'Mercari has no public developer API for search or listing creation.'
  ),
  facebook: makeUnsupported(
    'facebook',
    'Facebook Marketplace',
    'Facebook Marketplace has no public developer API for search or listing creation.'
  ),
  offerup: makeUnsupported(
    'offerup',
    'OfferUp',
    'OfferUp has no public developer API for search or listing creation.'
  ),
  depop: makeUnsupported(
    'depop',
    'Depop',
    'Depop has no public developer API for search or listing creation.'
  ),
};
