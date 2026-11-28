'use strict';

const crypto = require('crypto');

// Independent of the version-checked pieces store: even a rejected card PUT
// must not prevent a recoverable copy of the text from being recorded.
function setup(db, options) {
  options = options || {};
  const now = options.now || Date.now;
  db.exec(
    'CREATE TABLE IF NOT EXISTS piece_text_backups (' +
    ' id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    ' piece_id TEXT NOT NULL,' +
    ' title TEXT NOT NULL,' +
    ' notes_text TEXT NOT NULL,' +
    ' content_hash TEXT NOT NULL,' +
    ' created_at TEXT NOT NULL' +
    ');' +
    'CREATE INDEX IF NOT EXISTS idx_piece_text_backups_piece ON piece_text_backups(piece_id,id DESC);' +
    'CREATE INDEX IF NOT EXISTS idx_piece_text_backups_time ON piece_text_backups(created_at);'
  );
  const latest = db.prepare('SELECT * FROM piece_text_backups WHERE piece_id = ? ORDER BY id DESC LIMIT 1');
  const insert = db.prepare('INSERT INTO piece_text_backups (piece_id,title,notes_text,content_hash,created_at) VALUES (?,?,?,?,?)');
  const history = db.prepare('SELECT id,piece_id,title,notes_text,created_at FROM piece_text_backups WHERE piece_id = ? ORDER BY id DESC LIMIT ?');
  const recent = db.prepare('SELECT id,piece_id,title,notes_text,created_at FROM piece_text_backups WHERE id IN (' +
    'SELECT MAX(id) FROM piece_text_backups GROUP BY piece_id) ORDER BY id DESC LIMIT ?');
  const prunePiece = db.prepare('DELETE FROM piece_text_backups WHERE piece_id = ? AND id NOT IN (' +
    'SELECT id FROM piece_text_backups WHERE piece_id = ? ORDER BY id DESC LIMIT 1000)');
  const pruneOld = db.prepare('DELETE FROM piece_text_backups WHERE created_at < ?');

  function save(pieceId, title, notesText) {
    const hash = crypto.createHash('sha256').update(title + '\0' + notesText).digest('hex');
    return db.transaction(function () {
      const previous = latest.get(pieceId);
      if (previous && previous.content_hash === hash) {
        return { id: previous.id, createdAt: previous.created_at, unchanged: true };
      }
      const createdAt = new Date(now()).toISOString();
      const result = insert.run(pieceId, title, notesText, hash, createdAt);
      prunePiece.run(pieceId, pieceId);
      // Old text backups are kept for 90 days, far longer than the normal
      // autosave debounce and the daily seven-day Kanban snapshots.
      pruneOld.run(new Date(now() - 90 * 86400000).toISOString());
      return { id: Number(result.lastInsertRowid), createdAt: createdAt, unchanged: false };
    })();
  }

  return {
    save: save,
    recent: function (limit) { return recent.all(Math.max(1, Math.min(100, Number(limit) || 50))); },
    history: function (pieceId, limit) { return history.all(pieceId, Math.max(1, Math.min(100, Number(limit) || 50))); }
  };
}

module.exports = { setup: setup };
