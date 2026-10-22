'use strict';

// One-time editorial refresh. Generate before the transaction so no model
// request holds a SQLite write lock, then compare the whole record before
// saving so a concurrent approval or queue edit is never overwritten.
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');
const social = require('../src/socialDescription');
const youtube = require('../src/youtubeDescription');
const openaiStructured = require('../src/openaiStructured');

const db = new Database(path.join(process.env.DATA_DIR || '/data', 'db.sqlite'), { fileMustExist: true });
const get = db.prepare("SELECT data FROM records WHERE store_name='pieces' AND id=?");
const update = db.prepare("UPDATE records SET data=?,updated_at=? WHERE store_name='pieces' AND id=? AND data=?");
const rows = db.prepare("SELECT id,data FROM records WHERE store_name='pieces' AND json_extract(data,'$.stage') IN ('final_check','publishing_queue','scheduled') ORDER BY updated_at").all();
const destinationFields = ['queuedPublishDestinations', 'scheduledPublishDestinations', 'publishRetryDestinations'];

function needsSocial(piece) {
  if (piece.socialDescriptionSourceHash === social.sourceHash(piece) && piece.socialDescriptionText) return false;
  if (piece.stage === 'final_check') return (piece.platforms || []).some(social.supports);
  return destinationFields.some(function (field) {
    return Array.isArray(piece[field]) && piece[field].some(function (destination) { return social.supports(destination.platform); });
  });
}

function needsYoutube(piece) {
  if (piece.youtubeDescriptionSourceHash === youtube.sourceHash(piece) && piece.youtubeDescriptionText) return false;
  if (piece.stage === 'final_check') return (piece.platforms || []).includes('ytlong');
  return destinationFields.some(function (field) {
    return Array.isArray(piece[field]) && piece[field].some(function (destination) { return destination.platform === 'ytlong'; });
  });
}

function saveIfCurrent(snapshot, prose) {
  return db.transaction(function () {
    const row = get.get(snapshot.id);
    if (!row) return false;
    const piece = JSON.parse(row.data);
    if (piece.stage !== snapshot.stage ||
        social.sourceHash(piece) !== social.sourceHash(snapshot) ||
        youtube.sourceHash(piece) !== youtube.sourceHash(snapshot)) return false;
    if (prose.social) {
      for (const field of destinationFields) {
        if (Array.isArray(piece[field])) piece[field] = piece[field].map(function (destination) {
          return social.backfillDestination(destination, prose.social);
        });
      }
      piece.socialDescriptionText = prose.social;
      piece.socialDescriptionSourceHash = social.sourceHash(piece);
    }
    if (prose.youtube) {
      piece.youtubeDescriptionText = prose.youtube;
      piece.youtubeDescriptionSourceHash = youtube.sourceHash(piece);
    }
    piece._recordVersion = crypto.randomUUID();
    piece.updatedAt = new Date().toISOString();
    return update.run(JSON.stringify(piece), piece.updatedAt, snapshot.id, row.data).changes === 1;
  })();
}

async function main() {
  const eligible = rows.map(function (row) { return JSON.parse(row.data); })
    .filter(function (piece) { return needsSocial(piece) || needsYoutube(piece); });
  if (process.argv.includes('--dry-run')) {
    console.log('Unpublished pieces eligible for description refresh: ' + eligible.length);
    return;
  }
  let saved = 0;
  let failed = 0;
  for (const piece of eligible) {
    try {
      const prose = {};
      if (needsSocial(piece)) prose.social = await social.generate(piece, openaiStructured.generate);
      if (needsYoutube(piece)) prose.youtube = await youtube.generate(piece, openaiStructured.generate);
      if (saveIfCurrent(piece, prose)) {
        saved++;
        console.log('Refreshed unpublished piece ' + piece.id);
      } else console.log('Skipped changed or published piece ' + piece.id);
    } catch (error) {
      failed++;
      console.error('Description refresh failed for ' + piece.id + ': ' + String(error.message || error).slice(0, 300));
    }
  }
  console.log('Description refresh: ' + saved + ' saved, ' + failed + ' failed, ' + (eligible.length - saved - failed) + ' changed/skipped');
  if (failed) process.exitCode = 1;
}

main().finally(function () { db.close(); }).catch(function (error) {
  console.error('Description refresh aborted: ' + String(error.message || error).slice(0, 300));
  process.exitCode = 1;
});
