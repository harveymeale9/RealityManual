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

test('syncThread reports cancellation as its own terminal state', async function () {
  const Voice = loadVoiceClient([[
    { id: 'message-cancelled', status: 'cancelled', transcript: 'Do the wrong thing', completed_at: '2026-10-14T10:00:00Z' }
  ]]);

  await new Promise(function (resolve, reject) {
    const timeout = setTimeout(function () { reject(new Error('cancellation not observed')); }, 500);
    const sync = Voice.syncThread({
      onCancelled: function (row) {
        clearTimeout(timeout);
        sync.stop();
        try {
          assert.equal(row.id, 'message-cancelled');
          resolve();
        } catch (error) { reject(error); }
      }
    }, { intervalMs: 5 });
  });
});

test('Project Manager UIs expose a per-message Never mind control', function () {
  const desktop = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const mobile = fs.readFileSync(path.join(__dirname, '../public/voice-mobile.html'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(desktop, /button\.textContent = 'Never mind'/);
  assert.match(mobile, /button\.textContent = 'Never mind'/);
  assert.match(server, /api\/voice\/messages\/:id\/cancel/);
  assert.match(server, /status = 'cancelled'/);
});

test('desktop Project Manager distinguishes queued follow-ups from the active runner', function () {
  const desktop = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  assert.match(desktop, /copy\.textContent = 'Queued'/);
  assert.match(desktop, /task' \+ \(ahead === 1 \? '' : 's'\) \+ ' ahead'/);
  assert.match(desktop, /is actively working on this/);
});

test('Project Manager accepts long pasted prompts without silently truncating them', function () {
  const desktop = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const mobile = fs.readFileSync(path.join(__dirname, '../public/voice-mobile.html'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(desktop, /maxlength="100000"/);
  assert.match(desktop, /classList\.toggle\('long-prompt'/);
  assert.match(mobile, /maxlength="100000"/);
  assert.match(mobile, /classList\.toggle\('long-prompt'/);
  assert.match(server, /MAX_VOICE_MESSAGE_CHARS = 100000/);
  assert.doesNotMatch(server, /rawText\.trim\(\)\.slice\(0, 4000\)/);
  assert.match(server, /error: 'message_too_long'/);
});
