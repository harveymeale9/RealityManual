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

  const inserted = db.prepare('SELECT order_id FROM analytics_events').get();
  assert.equal(inserted.order_id, null);

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE analytics_events SET created_at = ?').run(yesterday);

  const summary = analytics.getSummary();
  assert.equal(summary.funnel.find((row) => row.step === 'order_complete').count, 1);
  assert.deepEqual(summary.top_utm_sources, [{ source: 'example-campaign', sessions: 1 }]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM analytics_events WHERE verified_human = 1').get().n, 0);
  assert.equal(db.prepare('SELECT event_count FROM analytics_daily_events WHERE event_name = ?').get('order_complete').event_count, 1);
});
