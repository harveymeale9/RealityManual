// Standalone entry point: `npm run db:migrate`.
// Requiring ./index runs the schema + seed as a side effect.
require('./index');

console.log('Database schema is up to date and shipping_rates seeded.');
process.exit(0);
