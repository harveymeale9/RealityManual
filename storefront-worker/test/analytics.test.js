import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { aggregateCompletedDays, getSummary, recordEvent } from '../src/analytics.js';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../backend/src/db/schema.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const make = (args) => ({
        first: async () => statement.get(...args) || null,
        all: async () => ({ results: statement.all(...args) }),
        run: async () => ({ meta: { changes: statement.run(...args).changes } }),
      });
      return { ...make([]), bind: (...args) => make(args) };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { for (const statement of statements) await statement.run(); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { sqlite, env: { DB: db, CORS_ORIGIN: 'https://realitymanual.com' } };
}

test('only verified site browser events enter analytics, then roll into anonymous daily totals', async () => {
  const { sqlite, env } = fixture();
  const event = {
    session_id: 'visitor-1', event_name: 'page_view', page: '/', utm_source: 'youtube',
    human_verified: true, human_verification: 'interaction',
  };
  const request = (origin, agent) => new Request('https://api.example.test/api/analytics/event', {
    method: 'POST', headers: { origin, 'user-agent': agent, 'sec-fetch-site': 'same-site' },
    body: JSON.stringify(event),
  });
  assert.equal((await recordEvent(request('https://evil.test', 'Mozilla/5.0'), env)).status, 204);
  assert.equal((await recordEvent(request('https://realitymanual.com', 'curl/8'), env)).status, 204);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM analytics_events').get().n, 0);
  assert.equal((await recordEvent(request('https://realitymanual.com', 'Mozilla/5.0'), env)).status, 204);
  const before = await getSummary(env);
  assert.equal((await before.json()).today.page_views, 1);
  sqlite.prepare("UPDATE analytics_events SET created_at = '2026-11-13T12:00:00.000Z'").run();
  await aggregateCompletedDays(env, new Date('2026-11-14T12:00:00.000Z'));
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM analytics_events').get().n, 0);
  assert.equal(sqlite.prepare('SELECT verified_visits FROM analytics_daily_utm_sources').get().verified_visits, 1);
  const after = await getSummary(env, new Date('2026-11-14T12:00:00.000Z'));
  assert.equal((await after.json()).last_30_days.page_views, 1);
  sqlite.close();
});
