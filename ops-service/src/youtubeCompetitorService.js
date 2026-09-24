'use strict';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function clean(value, max) { return String(value == null ? '' : value).trim().slice(0, max || 1000); }

function setup(db, options) {
  options = options || {};
  if (typeof options.fetchChannel !== 'function') throw new Error('fetchChannel is required');
  db.exec(`CREATE TABLE IF NOT EXISTS youtube_competitor_channels (
    channel_id TEXT PRIMARY KEY, input TEXT NOT NULL, title TEXT NOT NULL,
    snapshot_json TEXT, refreshed_at TEXT, created_at TEXT NOT NULL,
    last_error TEXT
  )`);
  // Competitor data is non-authorized public API data. YouTube requires it to
  // be refreshed or removed inside 30 days, so stale snapshots are erased at
  // every process start while the user's lightweight channel watchlist stays.
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
  db.prepare('UPDATE youtube_competitor_channels SET snapshot_json=NULL,refreshed_at=NULL WHERE refreshed_at IS NOT NULL AND refreshed_at < ?').run(cutoff);

  const listRows = db.prepare('SELECT * FROM youtube_competitor_channels ORDER BY title COLLATE NOCASE');
  const getRow = db.prepare('SELECT * FROM youtube_competitor_channels WHERE channel_id=?');
  const upsert = db.prepare(`INSERT INTO youtube_competitor_channels
    (channel_id,input,title,snapshot_json,refreshed_at,created_at,last_error)
    VALUES(?,?,?,?,?,?,NULL)
    ON CONFLICT(channel_id) DO UPDATE SET input=excluded.input,title=excluded.title,
      snapshot_json=excluded.snapshot_json,refreshed_at=excluded.refreshed_at,last_error=NULL`);
  const setSnapshot = db.prepare('UPDATE youtube_competitor_channels SET title=?,snapshot_json=?,refreshed_at=?,last_error=NULL WHERE channel_id=?');
  const setError = db.prepare('UPDATE youtube_competitor_channels SET last_error=? WHERE channel_id=?');
  const del = db.prepare('DELETE FROM youtube_competitor_channels WHERE channel_id=?');

  function present(row) {
    let snapshot = null;
    try { snapshot = row.snapshot_json ? JSON.parse(row.snapshot_json) : null; } catch (error) { snapshot = null; }
    return {
      channelId: row.channel_id, input: row.input, title: row.title,
      refreshedAt: row.refreshed_at, lastError: row.last_error, snapshot: snapshot
    };
  }

  function list() { return listRows.all().map(present); }

  async function add(input) {
    const analysis = await options.fetchChannel(clean(input, 300));
    const stamp = new Date().toISOString();
    upsert.run(analysis.channelId, clean(input, 300), clean(analysis.title, 300), JSON.stringify(analysis), stamp, stamp);
    return present(getRow.get(analysis.channelId));
  }

  async function refreshOne(row) {
    try {
      const analysis = await options.fetchChannel(row.input);
      const stamp = new Date().toISOString();
      // A handle always points at the stable channel id, but retain the row's
      // identity if YouTube ever returns something inconsistent rather than
      // silently duplicating/removing a user's saved channel.
      if (analysis.channelId !== row.channel_id) throw new Error('The saved handle now resolves to a different YouTube channel. Remove and add it again to confirm.');
      setSnapshot.run(clean(analysis.title, 300), JSON.stringify(analysis), stamp, row.channel_id);
      return present(getRow.get(row.channel_id));
    } catch (error) {
      setError.run(clean(error.message, 1000), row.channel_id);
      return present(getRow.get(row.channel_id));
    }
  }

  async function refreshAll() {
    const refreshed = [];
    for (const row of listRows.all()) refreshed.push(await refreshOne(row));
    return refreshed;
  }

  function remove(channelId) {
    return { ok: true, removed: del.run(clean(channelId, 200)).changes > 0 };
  }

  return { list: list, add: add, refreshAll: refreshAll, remove: remove };
}

module.exports = { setup: setup, THIRTY_DAYS_MS: THIRTY_DAYS_MS };
