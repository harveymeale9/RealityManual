'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const start = app.indexOf('  function referralBreakdownHtml(');
const end = app.indexOf('  function contentDate(', start);
assert.ok(start >= 0 && end > start);
const context = {
  escapeHtml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
};
vm.runInNewContext(app.slice(start, end), context);

test('referral chart distinguishes visit share from matched long-form view-to-visit rate', function () {
  const referrals = {
    total_sessions: 100,
    sources: [{ source: 'YouTube', sessions: 40, segments: [
      { sessions: 20, medium: 'video', campaign: 'longform', content: '231', piece_title: 'Example' },
      { sessions: 15, medium: '', campaign: '', content: '', legacy: true },
      { sessions: 5, medium: 'video', campaign: 'shortform', content: '232' }
    ] }]
  };
  const matched = {
    rate_percent: 2.5, visits: 20, views: 800,
    period: { start: '2026-11-01', end: '2026-11-17' },
    videos: [{ seq: 231, visits: 20, views: 800, rate_percent: 2.5 }]
  };
  const html = context.referralBreakdownHtml(referrals, matched);
  assert.match(html, /2\.5%<\/strong><span>of measured long-form YouTube views/);
  assert.match(html, /20 tagged visits \/ 800 new views/);
  assert.match(html, /Visit share = portion of all 100 attributed visits/);
  assert.match(html, /Visits \/ views/);
  assert.match(html, /20\.0%<\/small><small class="referral-view-rate"[^>]*>2\.5%<\/small>/);
  assert.equal((html.match(/class="referral-view-rate"/g) || []).length, 3);
  assert.equal((html.match(/>—<\/small>/g) || []).length, 2);
});

test('missing view report is unavailable, not zero percent', function () {
  const html = context.referralBreakdownHtml({ total_sessions: 0, sources: [] }, null);
  assert.match(html, /view-to-visit rate is temporarily unavailable/);
  assert.doesNotMatch(html, /0%<\/strong>/);
});
