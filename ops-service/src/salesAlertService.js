'use strict';

// One admin-wide, persistent acknowledgement per order. A timestamp cursor
// would miss an older pending checkout that becomes paid after newer orders.
function setup(options) {
  const db = options.db;
  const paidOrderIds = options.paidOrderIds;
  const baselineOrderIds = options.baselineOrderIds || paidOrderIds;
  db.exec(`
    CREATE TABLE IF NOT EXISTS sales_alert_seen_orders (
      order_id TEXT PRIMARY KEY,
      seen_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sales_alert_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      initialized_at TEXT NOT NULL
    );
  `);
  const seen = db.prepare('SELECT 1 FROM sales_alert_seen_orders WHERE order_id = ?');
  const mark = db.prepare('INSERT OR IGNORE INTO sales_alert_seen_orders (order_id, seen_at) VALUES (?, ?)');
  const initialized = db.prepare('SELECT 1 FROM sales_alert_state WHERE id = 1');
  const setInitialized = db.prepare('INSERT OR IGNORE INTO sales_alert_state (id, initialized_at) VALUES (1, ?)');

  function initialize() {
    if (initialized.get()) return;
    const existing = baselineOrderIds();
    db.transaction(function () {
      if (initialized.get()) return;
      const now = new Date().toISOString();
      existing.forEach(function (id) { mark.run(id, now); });
      setInitialized.run(now);
    })();
  }

  function status() {
    initialize();
    const unseenOrderIds = paidOrderIds().filter(function (id) { return !seen.get(id); });
    return { count: unseenOrderIds.length, unseenOrderIds: unseenOrderIds };
  }

  function markViewed(orderIds) {
    initialize();
    const eligible = new Set(paidOrderIds());
    const requested = Array.isArray(orderIds) ? orderIds : [];
    db.transaction(function () {
      const now = new Date().toISOString();
      requested.forEach(function (id) {
        if (typeof id === 'string' && eligible.has(id)) mark.run(id, now);
      });
    })();
    return status();
  }

  return { initialize: initialize, status: status, markViewed: markViewed };
}

module.exports = { setup: setup };
