'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadVoiceClient(rowsByTick) {
  let tick = 0;
  const context = {
    console,
    setTimeout,
    clearTimeout,
    URL,
    Blob,
    AbortController,
    navigator: {},
    fetch: function () {
      const rows = rowsByTick[Math.min(tick++, rowsByTick.length - 1)];
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve(rows); } });
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/lib/voiceClient.js'), 'utf8'), context);
  return context.window.RMVoice;
}

test('syncThread reports assistant attachments added after a completed bubble', async function () {
  const base = {
    id: 'message-images',
    status: 'done',
    transcript: 'Show me the mockups',
    reply_text: 'Here they are.',
    completed_at: '2026-10-12T09:43:23.536Z',
    replyAttachments: []
  };
  const withImages = Object.assign({}, base, {
    replyAttachments: [{ name: 'mockup.png', url: '/api/voice/messages/message-images/reply-attachments/0' }]
  });
  const Voice = loadVoiceClient([[base], [withImages]]);

  await new Promise(function (resolve, reject) {
    let doneCount = 0;
    const timeout = setTimeout(function () { reject(new Error('attachment update not observed')); }, 500);
    const sync = Voice.syncThread({
      onDone: function () { doneCount++; },
      onUpdate: function (row) {
        try {
          assert.equal(doneCount, 1);
          assert.equal(row.replyAttachments.length, 1);
          clearTimeout(timeout);
          sync.stop();
          resolve();
        } catch (error) {
          clearTimeout(timeout);
          sync.stop();
          reject(error);
        }
      }
    }, { intervalMs: 5 });
  });
});

