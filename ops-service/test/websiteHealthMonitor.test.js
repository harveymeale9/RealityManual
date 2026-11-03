'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const health = require('../src/websiteHealthMonitor');

test('website monitor distinguishes 403, 404, 5xx and timeouts without visitor data', async function () {
  const db = new Database(':memory:');
  const targets = [
    { id: 'homepage', label: 'Homepage', url: 'https://example.test/home', method: 'GET', expected: 200 },
    { id: 'forbidden', label: 'Forbidden', url: 'https://example.test/403', method: 'GET', expected: 200 },
    { id: 'missing', label: 'Missing', url: 'https://example.test/404', method: 'GET', expected: 200 },
    { id: 'server', label: 'Server', url: 'https://example.test/500', method: 'GET', expected: 200 },
    { id: 'slow', label: 'Slow', url: 'https://example.test/timeout', method: 'GET', expected: 200 },
  ];
  const monitor = health.setup(db, {
    targets,
    now: () => new Date('2026-11-03T12:00:00Z'),
    fetch: async (url) => {
      if (url.endsWith('timeout')) throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
      return { status: url.endsWith('home') ? 200 : Number(url.split('/').pop()) };
    },
  });
  await monitor.run();
  const report = monitor.status();
  assert.equal(report.total_checks, 5);
  assert.equal(report.successful_checks, 1);
  assert.equal(report.availability_24h_pct, 20);
  assert.equal(report.level, 'degraded');
  assert.deepEqual(report.incidents, { http_403: 1, http_404: 1, http_5xx: 1, other_http: 0, timeout: 1, network_error: 0 });
  assert.equal(report.latest.find((row) => row.target === 'homepage').result, 'ok');
  assert.equal(JSON.stringify(report).includes('example.test'), false);
  db.close();
});

test('dashboard presents synthetic health checks and storefront defers its video', function () {
  const root = path.join(__dirname, '..', '..');
  const app = fs.readFileSync(path.join(root, 'ops-service/public/app.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'ops-service/server.js'), 'utf8');
  const home = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
  assert.match(app, /websiteHealthHtml\(health\)/);
  assert.match(app, /Synthetic checks every five minutes|health\.definition/);
  assert.match(server, /app\.get\('\/api\/reports\/website-health', requireAuth/);
  assert.match(home, /id="vsl-player"[^>]+preload="none"/);
  assert.doesNotMatch(home, /videoPlayer\.load\(\)/);
  for (const name of ['five-axes', 'internal-value', 'advanced-techniques-omnipresence', 'indirect-pursuit-objective']) {
    const file = 'reality-manual-' + name;
    const original = path.join(root, 'frontend/img/photo/home2-interiors', file + '.png');
    const optimized = path.join(root, 'frontend/img/photo/home2-interiors', file + '.webp');
    assert.match(home, new RegExp(file + '\\.webp'));
    assert.ok(fs.statSync(optimized).size < fs.statSync(original).size / 2);
  }
});
