'use strict';

// One-time live queue backfill. Save actual prose in frozen publish payloads so
// they remain safe even while a backend deployment waits for active uploads.
// The original caption is retained for publish-time refresh after deployment.
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');
const descriptions = require('../src/socialDescription');
const openaiStructured = require('../src/openaiStructured');

const db = new Database(path.join(process.env.DATA_DIR || '/data', 'db.sqlite'), { fileMustExist: true });
const get = db.prepare("SELECT data FROM records WHERE store_name='pieces' AND id=?");
const update = db.prepare("UPDATE records SET data=?,updated_at=? WHERE store_name='pieces' AND id=? AND data=?");
const rows = db.prepare("SELECT id,data FROM records WHERE store_name='pieces' AND json_extract(data,'$.stage') IN ('publishing_queue','scheduled') ORDER BY updated_at").all();
const fields = ['queuedPublishDestinations', 'scheduledPublishDestinations', 'publishRetryDestinations'];

function candidate(piece) {
  return fields.some(function (field) {
    return Array.isArray(piece[field]) && piece[field].some(function (destination) { return descriptions.supports(destination.platform); });
  });
}

function saveIfCurrent(id, hash, text) {
  return db.transaction(function () {
    const row = get.get(id);
    if (!row) return false;
    const piece = JSON.parse(row.data);
    if (!['publishing_queue', 'scheduled'].includes(piece.stage) || !candidate(piece) || descriptions.sourceHash(piece) !== hash) return false;
    for (const field of fields) {
      if (Array.isArray(piece[field])) piece[field] = piece[field].map(function (destination) {
        return descriptions.backfillDestination(destination, text);
      });
    }
    piece.socialDescriptionText = text;
    piece.socialDescriptionSourceHash = hash;
    piece._recordVersion = crypto.randomUUID();
    piece.updatedAt = new Date().toISOString();
    return update.run(JSON.stringify(piece), piece.updatedAt, id, row.data).changes === 1;
  })();
}

async function main() {
  const limitArg = process.argv.find(function (arg) { return /^--limit=\d+$/.test(arg); });
  const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
  const eligible = rows.map(function (row) { return JSON.parse(row.data); }).filter(candidate).slice(0, limit);
  if (process.argv.includes('--dry-run')) {
    console.log('Eligible queued/scheduled pieces: ' + eligible.length);
    return;
  }
  let saved = 0;
  let failed = 0;
  for (const piece of eligible) {
    try {
      const hash = descriptions.sourceHash(piece);
      const text = piece.socialDescriptionSourceHash === hash && piece.socialDescriptionText
        ? descriptions.normalizeResult({ description: piece.socialDescriptionText })
        : await descriptions.generate(piece, openaiStructured.generate);
      if (saveIfCurrent(piece.id, hash, text)) {
        saved++;
        console.log('Backfilled #' + (piece.seq || '?') + ' (' + piece.id + '): ' + text.split(/\s+/).length + ' words');
      } else {
        console.log('Skipped changed or already-posted piece ' + piece.id);
      }
    } catch (error) {
      failed++;
      console.error('Backfill failed for #' + (piece.seq || '?') + ' (' + piece.id + '): ' + String(error.message || error).slice(0, 300));
    }
  }
  console.log('Backfill result: ' + saved + ' saved, ' + failed + ' failed, ' + (eligible.length - saved - failed) + ' changed/skipped');
  if (failed) process.exitCode = 1;
}

main().finally(function () { db.close(); }).catch(function (error) {
  console.error('Backfill aborted:', error.message);
  process.exitCode = 1;
});
