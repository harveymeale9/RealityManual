'use strict';

const crypto = require('crypto');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const FIRST_DUE = '2026-11-09T09:00:00.000Z';

function auditPrompt(start, end) {
  return 'Run Harvey’s weekly shipping-price audit for paid orders created from ' + start +
    ' (inclusive) to ' + end + ' (exclusive), using the storefront database on the VPS. ' +
    'Exclude refunded and owner-marked test orders. For each order, privately inspect its country, ' +
    'postcode, quantity, shipping service, USD shipping charge, BookVault dispatch cost in GBP, ' +
    'and saved GBP/USD rate. Use the actual address/postcode on the storefront shipping form or its ' +
    'safe quote endpoint to obtain a fresh UK-partner GBP quote for that destination and quantity; ' +
    'do not place a new BookVault order or submit payment. Compare the quoted/form USD charge and ' +
    'BookVault actual dispatch cost converted at the saved order rate. Distinguish later tariff/FX ' +
    'movement from an original undercharge. Treat a difference over the greater of $2 or 10% as ' +
    'worth investigating; missing costs/rates are verification gaps, not proof of correct pricing. ' +
    'Check the checkout and quote code for any confirmed mismatch and fix/deploy a verified logic ' +
    'error within normal project scope. Never silently change past customer charges or retry ' +
    'fulfillment. If there is any material mismatch or unresolved verification gap, notify Harvey ' +
    'by owner email and clearly in your Project Manager response, with order IDs abbreviated and ' +
    'no customer address/postcode or other private details. If everything reconciles, report a ' +
    'brief all-clear in Project Manager. Check CLAUDE.md and current git/deploy status first.';
}

function setup(db, monitor, options) {
  options = options || {};
  const now = options.now || function () { return Date.now(); };
  db.exec(`CREATE TABLE IF NOT EXISTS weekly_shipping_audit_schedule (
    id INTEGER PRIMARY KEY CHECK (id = 1), next_due_at TEXT NOT NULL
  );`);
  db.prepare('INSERT OR IGNORE INTO weekly_shipping_audit_schedule (id,next_due_at) VALUES (1,?)').run(FIRST_DUE);

  function schedule() {
    const horizon = new Date(now()).getTime() + WEEK_MS;
    let scheduled = 0;
    let next = db.prepare('SELECT next_due_at FROM weekly_shipping_audit_schedule WHERE id=1').get().next_due_at;
    while (Date.parse(next) <= horizon) {
      const end = Date.parse(next);
      const start = new Date(end - WEEK_MS).toISOString();
      const id = crypto.createHash('sha256').update('weekly-shipping-audit:' + next).digest('hex').slice(0, 32);
      monitor.register({
        id: id, kind: 'time', title: 'Weekly BookVault shipping audit', agent: 'codex',
        continuationPrompt: auditPrompt(start, next), config: { at: next },
        intervalSeconds: 15 * 60, minWeeklyRemaining: 1,
        expiresAt: new Date(end + 30 * 24 * 60 * 60 * 1000).toISOString()
      });
      next = new Date(end + WEEK_MS).toISOString();
      db.prepare('UPDATE weekly_shipping_audit_schedule SET next_due_at=? WHERE id=1').run(next);
      scheduled++;
    }
    return scheduled;
  }

  schedule();
  const timer = options.autoStart === false ? null : setInterval(schedule, 60 * 60 * 1000);
  if (timer && timer.unref) timer.unref();
  return { schedule: schedule, close: function () { if (timer) clearInterval(timer); } };
}

module.exports = { setup, auditPrompt, FIRST_DUE };
