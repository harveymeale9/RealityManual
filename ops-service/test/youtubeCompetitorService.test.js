'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const competitorService = require('../src/youtubeCompetitorService');

test('competitor watchlist persists snapshots, retains good data on refresh failure, and removes channels', async function () {
  const db = new Database(':memory:');
  let fail = false;
  let version = 1;
  const service = competitorService.setup(db, {
    fetchChannel: async function (input) {
      if (fail) throw new Error('temporary YouTube failure');
      return { channelId: 'UC-one', input: input, title: 'Channel v' + version, videos: [{ id: 'v1', views: version }], fetchedAt: new Date().toISOString() };
    }
  });

  const added = await service.add('@channel');
  assert.equal(added.snapshot.title, 'Channel v1');
  assert.equal(service.list().length, 1);
  version = 2;
  const refreshed = await service.refreshAll();
  assert.equal(refreshed[0].snapshot.title, 'Channel v2');
  fail = true;
  const failed = await service.refreshAll();
  assert.equal(failed[0].snapshot.title, 'Channel v2');
  assert.match(failed[0].lastError, /temporary YouTube failure/);
  assert.deepEqual(service.remove('UC-one'), { ok: true, removed: true });
  assert.equal(service.list().length, 0);
  db.close();
});

test('public competitor snapshots older than thirty days are erased on startup', async function () {
  const db = new Database(':memory:');
  competitorService.setup(db, { fetchChannel: async function () { throw new Error('unused'); } });
  db.prepare(`INSERT INTO youtube_competitor_channels
    (channel_id,input,title,snapshot_json,refreshed_at,created_at,last_error) VALUES(?,?,?,?,?,?,NULL)`)
    .run('UC-old', '@old', 'Old', JSON.stringify({ title: 'Expired data' }), '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  const restarted = competitorService.setup(db, { fetchChannel: async function () { throw new Error('unused'); } });
  assert.equal(restarted.list()[0].snapshot, null);
  assert.equal(restarted.list()[0].refreshedAt, null);
  db.close();
});
