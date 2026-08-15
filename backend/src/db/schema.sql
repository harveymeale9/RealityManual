-- The Reality Manual — database schema
-- All money values are stored as integer USD cents to avoid float rounding issues.

CREATE TABLE IF NOT EXISTS orders (
  id                        TEXT PRIMARY KEY,
  stripe_payment_intent_id  TEXT UNIQUE,
  stripe_payment_status     TEXT,
  customer_name             TEXT NOT NULL,
  email                     TEXT NOT NULL,
  phone                     TEXT NOT NULL,
  country                   TEXT NOT NULL,
  street1                   TEXT NOT NULL,
  street2                   TEXT,
  city                      TEXT NOT NULL,
  state                     TEXT,
  postal_code                TEXT NOT NULL,
  book_price_cents          INTEGER NOT NULL,
  shipping_price_cents      INTEGER NOT NULL,
  total_price_cents         INTEGER NOT NULL,
  currency                  TEXT NOT NULL DEFAULT 'usd',
  -- lulu_order_id / fulfillment fields are unused until the Lulu integration phase,
  -- included now so no schema migration is needed when that phase starts.
  lulu_order_id             TEXT,
  order_status               TEXT NOT NULL DEFAULT 'PAYMENT_PENDING',
  created_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_stripe_payment_intent ON orders(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(order_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

CREATE TABLE IF NOT EXISTS shipping_rates (
  country_code      TEXT PRIMARY KEY,
  country_name      TEXT NOT NULL,
  price_usd_cents   INTEGER NOT NULL,
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS error_logs (
  id                  TEXT PRIMARY KEY,
  order_id            TEXT,
  service             TEXT NOT NULL,
  error_type          TEXT NOT NULL,
  error_message       TEXT NOT NULL,
  request_reference   TEXT,
  attempt_number      INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_error_logs_order_id ON error_logs(order_id);
