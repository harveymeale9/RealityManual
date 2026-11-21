ALTER TABLE orders ADD COLUMN voucher_code_hash TEXT;
ALTER TABLE orders ADD COLUMN voucher_discount_cents INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS feedback_vouchers (
  submission_id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  redeemed_order_id TEXT,
  redeemed_at TEXT
);
