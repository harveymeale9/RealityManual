'use strict';

// Keeps only a short-lived, PII-stripped D1 reporting snapshot in memory.
// Checkout, customer records, Stripe and BookVault remain on the Worker;
// Content Studio never writes this mirror to disk or uses it for fulfillment.
const Database = require('better-sqlite3');

const SCHEMA = {
  orders: `id TEXT, stripe_payment_status TEXT, stripe_livemode INTEGER,
    payment_failure_type TEXT,payment_failure_code TEXT,payment_decline_code TEXT,payment_failure_message TEXT,
    country TEXT,quantity INTEGER,book_price_cents INTEGER,shipping_price_cents INTEGER,shipping_service_name TEXT,
    total_price_cents INTEGER,currency TEXT,attribution_json TEXT,bookvault_order_id TEXT,
    bookvault_production_cost_gbp_cents INTEGER,bookvault_shipping_cost_gbp_cents INTEGER,
    bookvault_total_cost_gbp_cents INTEGER,bookvault_total_cost_usd_cents INTEGER,bookvault_gbp_usd_rate REAL,
    fulfillment_attempts INTEGER,fulfillment_next_attempt_at TEXT,fulfillment_last_error TEXT,
    payment_received_at TEXT,fulfillment_alert_sent_at TEXT,fulfillment_deadline_alert_sent_at TEXT,
    confirmation_email_sent_at TEXT,shipping_email_sent_at TEXT,refund_email_sent_at TEXT,
    resend_contact_synced_at TEXT,order_status TEXT,created_at TEXT,updated_at TEXT`,
  analytics_events: `id TEXT,session_id TEXT,event_name TEXT,page TEXT,utm_source TEXT,utm_medium TEXT,
    utm_campaign TEXT,utm_term TEXT,utm_content TEXT,country TEXT,verified_human INTEGER,created_at TEXT`,
  analytics_daily_events: 'day TEXT,event_name TEXT,event_count INTEGER,verified_visits INTEGER',
  analytics_daily_utm_sources: 'day TEXT,utm_source TEXT,verified_visits INTEGER',
  analytics_daily_utm_landings: `day TEXT,utm_source TEXT,utm_medium TEXT,utm_campaign TEXT,
    utm_content TEXT,verified_visits INTEGER`,
  error_logs: 'id TEXT,order_id TEXT,service TEXT,error_type TEXT,created_at TEXT',
};

function buildDatabase(snapshot) {
  if (!snapshot || !snapshot.tables || !Number.isFinite(Date.parse(snapshot.generated_at))) {
    throw new Error('Worker report snapshot is malformed.');
  }
  const db = new Database(':memory:');
  try {
    for (const [table, schema] of Object.entries(SCHEMA)) {
      db.exec(`CREATE TABLE ${table} (${schema})`);
      const rows = snapshot.tables[table];
      if (!Array.isArray(rows) || rows.length > 10000) throw new Error(`Worker report snapshot table ${table} is incomplete.`);
      const allowed = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
      const insertRows = db.transaction(function () {
        for (const row of rows) {
          if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Bad ${table} report row.`);
          const columns = Object.keys(row);
          if (!columns.length || columns.some((column) => !allowed.has(column))) throw new Error(`Bad ${table} report column.`);
          db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
            .run(...columns.map((column) => row[column]));
        }
      });
      insertRows();
    }
    return db;
  } catch (error) { db.close(); throw error; }
}

function setup(options = {}) {
  const url = options.url;
  if (!/^https:\/\//.test(url || '')) throw new Error('STOREFRONT_REPORT_URL must be HTTPS.');
  const accessToken = options.accessToken || '';
  if (!accessToken) throw new Error('STOREFRONT_REPORT_TOKEN is required for Worker reports.');
  const fetchImpl = options.fetchImpl || global.fetch;
  const refreshMs = options.refreshMs || 30000;
  const maxAgeMs = options.maxAgeMs || 120000;
  let current = null;
  let refreshedAt = 0;
  let pending = null;

  async function refresh() {
    if (pending) return pending;
    pending = (async function () {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(15000), cache: 'no-store',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error(`Worker report snapshot returned HTTP ${response.status}.`);
      const snapshot = await response.json();
      if (Date.now() - Date.parse(snapshot.generated_at) > maxAgeMs) throw new Error('Worker report snapshot is stale.');
      const replacement = buildDatabase(snapshot);
      const previous = current;
      current = replacement;
      refreshedAt = Date.now();
      if (previous) previous.close();
    })();
    try { await pending; }
    finally { pending = null; }
  }

  function getDb() {
    if (!current || Date.now() - refreshedAt > maxAgeMs) throw new Error('Worker storefront report snapshot is unavailable or stale.');
    return current;
  }

  function start() {
    refresh().catch((error) => console.error('Worker report refresh failed:', error.message));
    const timer = setInterval(() => refresh().catch((error) => console.error('Worker report refresh failed:', error.message)), refreshMs);
    timer.unref();
    return timer;
  }

  return { start, refresh, getDb };
}

module.exports = { setup, buildDatabase };
