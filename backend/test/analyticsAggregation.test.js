const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

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
  analytics.recordEvent({
    session_id: 'browser-1', event_name: 'page_view', page: '/', utm_source: 'example-campaign'
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

test('tagged arrivals retain per-post counts after compaction without changing first-touch attribution', () => {
  analytics.recordEvent({ session_id: 'returning-browser', event_name: 'page_view',
    utm_source: 'youtube', utm_medium: 'profile' },
  { verifiedHuman: true, method: 'interaction', reason: 'verified' });
  analytics.recordEvent({ session_id: 'returning-browser', event_name: 'utm_landing',
    utm_source: 'youtube', utm_medium: 'video', utm_campaign: 'longform', utm_content: '230' },
  { verifiedHuman: true, method: 'interaction', reason: 'verified' });
  analytics.recordEvent({ session_id: 'returning-browser', event_name: 'utm_landing',
    utm_source: 'facebook', utm_medium: 'video', utm_campaign: 'longform', utm_content: '194' },
  { verifiedHuman: true, method: 'interaction', reason: 'verified' });
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  db.prepare("UPDATE analytics_events SET created_at=? WHERE session_id='returning-browser'").run(yesterday);
  analytics.aggregateCompletedDays(true);
  assert.deepEqual(db.prepare(`SELECT utm_source,utm_content,verified_visits
    FROM analytics_daily_utm_landings ORDER BY utm_source`).all().map((row) => ({ ...row })), [
    { utm_source: 'facebook', utm_content: '194', verified_visits: 1 },
    { utm_source: 'youtube', utm_content: '230', verified_visits: 1 }
  ]);
  assert.equal(db.prepare("SELECT count(*) AS n FROM analytics_events WHERE session_id='returning-browser'").get().n, 0);
});

test('returning browser records the newly opened post without overwriting first-touch funnel attribution', () => {
  const calls = [];
  const handlers = {};
  const values = new Map([
    ['rm_session_id', 'returning-browser'],
    ['rm_attribution', JSON.stringify({ utm_source: 'facebook', utm_medium: 'profile',
      utm_campaign: '', utm_term: '', utm_content: '', referrer: '' })]
  ]);
  const window = {
    RM_CONFIG: { API_BASE_URL: 'https://api.realitymanual.com' },
    location: { search: '?utm_source=youtube&utm_medium=video&utm_campaign=longform&utm_content=230' },
    addEventListener: (event, handler) => { handlers[event] = handler; },
    setTimeout: () => 1
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'analytics.js'), 'utf8'), {
    window, document: { referrer: '' }, URLSearchParams,
    localStorage: { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) },
    fetch: (_, options) => { calls.push(JSON.parse(options.body)); return Promise.resolve({ ok: true }); }
  });
  handlers.pointerdown({ isTrusted: true });
  assert.equal(calls.find((call) => call.event_name === 'page_view').utm_source, 'facebook');
  assert.deepEqual({ ...calls.find((call) => call.event_name === 'utm_landing') }, {
    session_id: 'returning-browser', event_name: 'utm_landing',
    referrer: '', utm_source: 'youtube', utm_medium: 'video', utm_campaign: 'longform',
    utm_term: '', utm_content: '230', human_verified: true, human_verification: 'interaction'
  });
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

test('checkout uses only the branded confirmation flow and confirmation omits order metadata', () => {
  const checkout = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'checkout.js'), 'utf8');
  const confirmationPage = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'confirmation.html'), 'utf8');
  const confirmationScript = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'confirmation.js'), 'utf8');

  assert.doesNotMatch(checkout, /receipt_email/);
  assert.match(confirmationPage, /reality-manual-deluxe-hardcover-cutout\.webp/);
  assert.match(confirmationPage, /We're Confirming Your Order\. Please wait/);
  assert.doesNotMatch(confirmationPage, /order-meta/);
  assert.match(confirmationScript, /Our Expert Bookbinders Are Rolling Up Their Sleeves!/);
  assert.match(confirmationScript, /✓ Order confirmed/);
  assert.match(confirmationScript, /classList\.add\('is-success'\)/);
  assert.match(confirmationScript, /setWaitingTitle/);
  assert.match(confirmationScript, /15 business days/);
  assert.match(confirmationScript, /if \(terminal\) return/);
  assert.doesNotMatch(confirmationScript, /Our Expert Bookbinders Are Getting Ready|Payment processing';/);
  assert.doesNotMatch(confirmationScript, /product_description|formatCents/);
});

test('test order route simulates both confirmation states without real order or analytics calls', () => {
  const demoPage = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'testorder', 'index.html'), 'utf8');
  const confirmationScript = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'confirmation.js'), 'utf8');

  assert.match(demoPage, /data-order-demo="true"/);
  assert.match(demoPage, /noindex, nofollow/);
  assert.doesNotMatch(demoPage, /analytics\.js|marketing\.js/);
  assert.match(confirmationScript, /const demoDurationSeconds = 8/);
  assert.match(confirmationScript, /Replay demo/);
  assert.match(confirmationScript, /if \(!isDemo\) trackOnce/);
  assert.match(confirmationScript, /if \(!isDemo && window\.RMMarketing\)/);
});
