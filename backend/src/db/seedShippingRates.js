// Seeds the shipping_rates table with the countries listed in CLAUDE.md §16-17.
//
// IMPORTANT: price_usd_cents below is a FLAT PLACEHOLDER ($9.99 for every
// country), not a real Lulu-derived shipping rate. CLAUDE.md explicitly says
// not to invent shipping rates — this placeholder exists only so the
// checkout flow is end-to-end testable before real rates are supplied.
// Replace every row (via SQL for now, via the Admin Dashboard once that
// phase is built) with real rates before going anywhere near production.
const PLACEHOLDER_PRICE_CENTS = 999;

const COUNTRIES = [
  ['US', 'United States'],
  ['CA', 'Canada'],
  ['GB', 'United Kingdom'],
  ['AU', 'Australia'],
  ['DE', 'Germany'],
  ['FR', 'France'],
  ['NL', 'Netherlands'],
  ['NZ', 'New Zealand'],
  ['IE', 'Ireland'],
  ['CH', 'Switzerland'],
  ['SE', 'Sweden'],
  ['NO', 'Norway'],
  ['DK', 'Denmark'],
  ['SG', 'Singapore'],
  ['JP', 'Japan'],
  ['REST_OF_WORLD', 'Rest of World'],
];

module.exports = function seedShippingRates(db) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO shipping_rates (country_code, country_name, price_usd_cents)
    VALUES (?, ?, ?)
  `);

  for (const [code, name] of COUNTRIES) {
    insert.run(code, name, PLACEHOLDER_PRICE_CENTS);
  }
};
