#!/usr/bin/env node
'use strict';

// One-off migration for the three already-uploaded private YouTube videos.
// Dry-run by default. Never creates another upload or changes a public video.
const path = require('path');
const Database = require('better-sqlite3');
const youtubeAuth = require('../src/youtubeAuth');

const plan = [
  { pieceId: '5574bd8e-d0f9-417c-8877-0d21f2db777a', videoId: 'C32z8-RqILQ', oldAt: '2026-11-22T15:00:00.000Z', newAt: '2026-11-21T22:45:00.000Z' },
  { pieceId: '652f9e11-5658-4fe7-b9e8-04a46421b429', videoId: 'zMKc8pPJvYg', oldAt: '2026-11-24T15:00:00.000Z', newAt: '2026-11-23T22:45:00.000Z' },
  { pieceId: '0ca49b70-7d12-49b5-a6a6-3cfc82bf1889', videoId: 'mFXDE_IopYs', oldAt: '2026-11-28T15:00:00.000Z', newAt: '2026-11-27T22:45:00.000Z' }
];
const apply = process.argv.includes('--apply');
const db = new Database(path.join(process.env.DATA_DIR || '/data', 'db.sqlite'));

async function videoStatus(token, id) {
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'status');
  url.searchParams.set('id', id);
  const response = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!response.ok) throw new Error('YouTube status lookup failed (' + response.status + ') for ' + id);
  const item = (await response.json()).items?.[0];
  if (!item || item.id !== id || !item.status) throw new Error('Scheduled YouTube video not found: ' + id);
  return item.status;
}

async function main() {
  const auth = db.prepare('SELECT * FROM youtube_oauth WHERE id=1').get();
  if (!auth?.refresh_token) throw new Error('Connected YouTube OAuth credentials are missing.');
  const token = auth.access_token && Date.parse(auth.expires_at) > Date.now() + 60000
    ? auth.access_token : (await youtubeAuth.refreshAccessToken(auth.refresh_token)).access_token;
  const select = db.prepare("SELECT data FROM records WHERE store_name='pieces' AND id=?");
  const update = db.prepare("UPDATE records SET data=?, updated_at=? WHERE store_name='pieces' AND id=? AND data=?");
  for (const item of plan) {
    const row = select.get(item.pieceId);
    if (!row) throw new Error('Piece is missing: ' + item.pieceId);
    const piece = JSON.parse(row.data);
    if (piece.stage !== 'scheduled' || piece.youtubeAdvanceStatus !== 'scheduled' || piece.youtubeVideoId !== item.videoId ||
      piece.youtubePublishStatus !== 'scheduled' || piece.facebookPublishStatus !== 'scheduled') {
      throw new Error('Piece state changed; stopped before updating ' + item.pieceId);
    }
    if (![item.oldAt, item.newAt].includes(piece.scheduledAt) || ![item.oldAt, item.newAt].includes(piece.youtubeAdvanceDueAt)) {
      throw new Error('Unexpected local reservation; stopped before updating ' + item.pieceId);
    }
    const status = await videoStatus(token, item.videoId);
    if (status.privacyStatus !== 'private' || ![item.oldAt, item.newAt].some(at => Date.parse(at) === Date.parse(status.publishAt))) {
      throw new Error('Unexpected remote visibility or publish time; stopped before updating ' + item.videoId);
    }
    if (!apply) {
      console.log('DRY RUN ' + piece.title + ': ' + status.publishAt + ' -> ' + item.newAt);
      continue;
    }
    if (Date.parse(item.newAt) <= Date.now() + 60000) throw new Error('New release time is no longer safely in the future.');
    if (Date.parse(status.publishAt) !== Date.parse(item.newAt)) {
      // videos.update replaces unspecified writable status fields. Preserve
      // the existing settings while changing only publishAt.
      const writable = ['license', 'embeddable', 'publicStatsViewable', 'selfDeclaredMadeForKids', 'containsSyntheticMedia'];
      const nextStatus = { privacyStatus: 'private', publishAt: item.newAt };
      for (const field of writable) if (Object.hasOwn(status, field)) nextStatus[field] = status[field];
      const url = 'https://www.googleapis.com/youtube/v3/videos?part=status';
      const response = await fetch(url, { method: 'PUT', headers: {
        Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'
      }, body: JSON.stringify({ id: item.videoId, status: nextStatus }) });
      if (!response.ok) throw new Error('YouTube reschedule failed (' + response.status + ') for ' + item.videoId + ': ' + (await response.text()).slice(0, 350));
    }
    let confirmed;
    for (let attempt = 0; attempt < 8; attempt++) {
      confirmed = await videoStatus(token, item.videoId);
      if (confirmed.privacyStatus === 'private' && Date.parse(confirmed.publishAt) === Date.parse(item.newAt)) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (confirmed.privacyStatus !== 'private' || Date.parse(confirmed.publishAt) !== Date.parse(item.newAt)) {
      throw new Error('YouTube has not confirmed the new private schedule for ' + item.videoId);
    }
    if (piece.scheduledAt !== item.newAt || piece.youtubeAdvanceDueAt !== item.newAt) {
      piece.scheduledAt = item.newAt;
      piece.youtubeAdvanceDueAt = item.newAt;
      piece.updatedAt = new Date().toISOString();
      if (update.run(JSON.stringify(piece), piece.updatedAt, item.pieceId, row.data).changes !== 1) {
        throw new Error('Piece changed during remote update; reconcile ' + item.pieceId + ' before continuing.');
      }
    }
    console.log('CONFIRMED ' + piece.title + ': ' + item.newAt + ' (YouTube private; Facebook reservation matched)');
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.close());
