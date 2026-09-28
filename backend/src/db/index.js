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

// One-off add for databases created before quantity support (CLAUDE.md §66)
// — a no-op once the column already exists, or on a fresh database where
// schema.exec below creates it from scratch anyway.
try {
  db.exec('ALTER TABLE orders ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1');
} catch {
  // Already present, or the table doesn't exist yet.
}

for (const column of [
  'shipping_service_name TEXT',
  'stripe_livemode INTEGER NOT NULL DEFAULT 0',
  'shipping_service_id INTEGER',
  'shipping_min_delivery_days INTEGER',
  'shipping_max_delivery_days INTEGER',
  'fulfillment_attempts INTEGER NOT NULL DEFAULT 0',
  'fulfillment_next_attempt_at TEXT',
  'fulfillment_last_error TEXT',
  'confirmation_email_sent_at TEXT',
  'shipping_email_sent_at TEXT',
  'refund_email_sent_at TEXT',
]) {
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN ${column}`);
  } catch {
    // Already present, or the table does not exist yet.
  }
}

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

seedShippingRates(db);

module.exports = db;
