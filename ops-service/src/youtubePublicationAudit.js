'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

function clean(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max || 1000);
}

function setup(db, options) {
  options = options || {};
  const intervalMs = Number(options.intervalMs) || 60 * 60 * 1000;
  const auditEveryMs = Number(options.auditEveryMs) || DAY_MS;
  const enabled = options.enabled !== false && typeof options.listPieces === 'function' &&
    typeof options.fetchStatuses === 'function' && typeof options.savePiece === 'function';

  db.exec(`CREATE TABLE IF NOT EXISTS youtube_publication_audit_state (
    id INTEGER PRIMARY KEY CHECK(id=1), status TEXT NOT NULL DEFAULT 'never_run',
    last_started_at TEXT, last_completed_at TEXT, last_error TEXT,
    checked_count INTEGER NOT NULL DEFAULT 0,
    public_count INTEGER NOT NULL DEFAULT 0,
    moved_count INTEGER NOT NULL DEFAULT 0
  )`);
  db.prepare("INSERT OR IGNORE INTO youtube_publication_audit_state(id,status) VALUES(1,'never_run')").run();

  function currentState() {
    return db.prepare('SELECT * FROM youtube_publication_audit_state WHERE id=1').get();
  }

  function isDue(nowValue) {
    const state = currentState();
    if (!state.last_completed_at) return true;
    return Number(nowValue || Date.now()) - new Date(state.last_completed_at).getTime() >= auditEveryMs;
  }

  async function run(force) {
    const now = Date.now();
    if (!enabled) return { enabled: false, skipped: 'disabled' };
    if (!force && !isDue(now)) return { enabled: true, skipped: 'not_due', state: currentState() };

    const startedAt = new Date(now).toISOString();
    db.prepare("UPDATE youtube_publication_audit_state SET status='running',last_started_at=?,last_error=NULL WHERE id=1").run(startedAt);
    try {
      // A card can have publish metadata for more than one platform, but this
      // audit is intentionally authoritative only for YouTube records whose
      // exact API video id was stored after our own successful upload.
      const pieces = (await options.listPieces()).filter(function (piece) {
        return piece && piece.stage === 'live' && piece.youtubeVideoId && piece.createdBy !== 'youtube-reviewer';
      });
      const statuses = pieces.length
        ? await options.fetchStatuses(pieces.map(function (piece) { return piece.youtubeVideoId; }))
        : [];
      const byId = new Map((statuses || []).map(function (item) { return [String(item.id), item]; }));
      const checkedAt = new Date().toISOString();
      let publicCount = 0;
      const moved = [];

      for (const piece of pieces) {
        const videoId = String(piece.youtubeVideoId);
        const status = byId.get(videoId);
        const privacy = status && clean(status.privacyStatus, 40).toLowerCase();
        const upload = status && clean(status.uploadStatus, 40).toLowerCase();
        const isPublic = !!status && privacy === 'public' && (!upload || upload === 'processed' || upload === 'uploaded');

        piece.youtubeAvailabilityCheckedAt = checkedAt;
        if (isPublic) {
          piece.youtubeAvailabilityStatus = 'public';
          piece.youtubeLastVerifiedPublicAt = checkedAt;
          publicCount += 1;
        } else {
          const reason = !status ? 'missing' : (privacy && privacy !== 'public' ? privacy : (upload || 'unavailable'));
          piece.stage = 'removed';
          piece.youtubeAvailabilityStatus = reason;
          piece.youtubeRemovedAt = checkedAt;
          moved.push({ pieceId: piece.id, videoId: videoId, reason: reason });
        }
        piece.updatedAt = checkedAt;
        await options.savePiece(piece);
      }

      db.prepare(`UPDATE youtube_publication_audit_state SET status='ok',last_completed_at=?,last_error=NULL,
        checked_count=?,public_count=?,moved_count=? WHERE id=1`)
        .run(checkedAt, pieces.length, publicCount, moved.length);
      return { enabled: true, checkedAt: checkedAt, checked: pieces.length, public: publicCount, moved: moved };
    } catch (error) {
      db.prepare("UPDATE youtube_publication_audit_state SET status='error',last_error=? WHERE id=1")
        .run(clean(error.message, 1000));
      throw error;
    }
  }

  function status() {
    return { enabled: enabled, auditEveryMs: auditEveryMs, due: enabled && isDue(Date.now()), state: currentState() };
  }

  let timer = null;
  if (enabled && options.autoStart !== false) {
    setImmediate(function () { run(false).catch(function (error) { console.error('[youtube-publication-audit] check failed:', error.message); }); });
    timer = setInterval(function () { run(false).catch(function (error) { console.error('[youtube-publication-audit] check failed:', error.message); }); }, intervalMs);
    if (timer.unref) timer.unref();
  }

  return {
    enabled: enabled,
    run: run,
    status: status,
    close: function () { if (timer) clearInterval(timer); }
  };
}

module.exports = { setup: setup, DAY_MS: DAY_MS };
