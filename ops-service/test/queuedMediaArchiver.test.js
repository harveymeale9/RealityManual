'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { archiveReadyQueue } = require('../src/queuedMediaArchiver');

function harness(overrides) {
  let piece = { id: 'video-1', stage: 'publishing_queue', queuedPublishDestinations: [{ platform: 'ytshort' }] };
  const steps = [];
  const input = {
    list: () => [piece], get: () => piece, claimed: () => false,
    sourceExists: () => true,
    reviewStatus: () => { steps.push('review'); return { status: 'ready' }; },
    ensureArchived: async () => { steps.push('r2-verified'); },
    ensureEditorSource: async () => { steps.push('editor-source-verified'); },
    releaseLocal: async (id, options) => { steps.push('release'); assert.equal(id, piece.id); assert.deepEqual(options, { keepReview: true }); },
    warn: () => { steps.push('warn'); }
  };
  return { input: Object.assign(input, overrides), steps, setPiece: (next) => { piece = next; } };
}

test('queue cleanup waits for review and verified R2, retaining the playback copy', async () => {
  const { input, steps } = harness();
  await archiveReadyQueue(input);
  assert.deepEqual(steps, ['review', 'r2-verified', 'editor-source-verified', 'release']);
});

test('missing review or failed R2 never releases local publish media', async () => {
  const missing = harness({ reviewStatus: () => ({ status: 'preparing' }) });
  await archiveReadyQueue(missing.input);
  assert.deepEqual(missing.steps, []);
  const failed = harness({ ensureArchived: async () => { throw new Error('R2 unavailable'); } });
  await archiveReadyQueue(failed.input);
  assert.deepEqual(failed.steps, ['review', 'warn']);
  const sourceFailed = harness({ ensureEditorSource: async () => { throw new Error('Editor source not verified'); } });
  await archiveReadyQueue(sourceFailed.input);
  assert.deepEqual(sourceFailed.steps, ['review', 'r2-verified', 'warn']);
});

test('queue cleanup skips a claimed, changed, or already released piece', async () => {
  const claimed = harness({ claimed: () => true });
  await archiveReadyQueue(claimed.input);
  assert.deepEqual(claimed.steps, []);
  const changed = harness({ ensureArchived: async () => { changed.steps.push('r2-verified'); changed.setPiece({ id: 'video-1', stage: 'scheduled' }); } });
  await archiveReadyQueue(changed.input);
  assert.deepEqual(changed.steps, ['review', 'r2-verified', 'editor-source-verified']);
  const released = harness();
  released.setPiece({ id: 'video-1', stage: 'publishing_queue', localMediaReleasedAt: '2026-10-22', queuedPublishDestinations: [{ platform: 'ytshort' }] });
  await archiveReadyQueue(released.input);
  assert.deepEqual(released.steps, []);
});

test('queue preview status recognizes a retained review after the local master is archived', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /piece\.storageStatus === 'ready' && piece\.localMediaReleasedAt/);
  assert.match(server, /review\.size > 1024/);
  assert.match(server, /await ensureApprovedEditorSourceArchived\(id\)/);
  assert.match(server, /await releaseLocalPublishMedia\(id\)/);
  assert.match(server, /archiveQueuedPublishMedia\(\)\.catch/);
});
