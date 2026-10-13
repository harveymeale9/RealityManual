const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-analytics-aggregation-'));
process.env.DATABASE_PATH = path.join(scratch, 'test.db');

const db = require('../src/db');
const analytics = require('../src/services/analyticsService');

test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

test('completed days become anonymous totals and lose browser/order-level rows', () => {
  analytics.recordEvent({
    session_id: 'browser-1',
    event_name: 'order_complete',
    page: '/confirmation.html',
    order_id: 'must-not-be-stored',
    utm_source: 'example-campaign',
  }, { verifiedHuman: true, method: 'interaction', reason: 'verified' });
  analytics.recordEvent({
    session_id: 'browser-1',
    event_name: 'checkout_arrival_primary',
    page: '/checkout.html',
  }, { verifiedHuman: true, method: 'interaction', reason: 'verified' });

  const inserted = db.prepare('SELECT order_id FROM analytics_events').get();
  assert.equal(inserted.order_id, null);

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE analytics_events SET created_at = ?').run(yesterday);

  const summary = analytics.getSummary();
  assert.equal(summary.funnel.find((row) => row.step === 'order_complete').count, 1);
  assert.equal(summary.funnel.find((row) => row.step === 'checkout_arrival_primary').count, 1);
  assert.deepEqual(summary.top_utm_sources, [{ source: 'example-campaign', sessions: 1 }]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM analytics_events WHERE verified_human = 1').get().n, 0);
  assert.equal(db.prepare('SELECT event_count FROM analytics_daily_events WHERE event_name = ?').get('order_complete').event_count, 1);
  assert.equal(db.prepare('SELECT event_count FROM analytics_daily_events WHERE event_name = ?').get('checkout_arrival_primary').event_count, 1);
});

test('each homepage checkout placement survives navigation as its own arrival event', () => {
  const homepage = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'index.html'), 'utf8');
  const home2 = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'home2', 'index.html'), 'utf8');
  const checkout = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'checkout.js'), 'utf8');
  ['header', 'primary_offer', 'final_cta'].forEach((source) => {
    assert.match(homepage, new RegExp('checkout\\.html\\?cta_source=' + source));
  });
  ['checkout_cta_header_clicked', 'checkout_cta_primary_clicked', 'checkout_cta_final_clicked'].forEach((eventName) => {
    assert.match(homepage, new RegExp(eventName));
  });
  ['checkout_arrival_header', 'checkout_arrival_primary', 'checkout_arrival_final'].forEach((eventName) => {
    assert.match(checkout, new RegExp(eventName));
  });
  assert.equal(homepage, home2);
});
