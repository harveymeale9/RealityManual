const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');
const seedShippingRates = require('./seedShippingRates');

const dataDir = path.dirname(config.databasePath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new DatabaseSync(config.databasePath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// One-off rename for databases created before the Lulu→BookVault switch
// (CLAUDE.md §26/§64) — a no-op once the column has already been renamed,
// or on a fresh database where it never existed under the old name.
try {
  db.exec('ALTER TABLE orders RENAME COLUMN lulu_order_id TO bookvault_order_id');
} catch {
  // Already renamed, or the table doesn't exist yet — schema.exec below handles that case.
}

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

seedShippingRates(db);

module.exports = db;
