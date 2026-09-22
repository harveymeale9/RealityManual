'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Database = require('better-sqlite3');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mailboxService = require('../src/mailboxService');

test('mailbox persists incoming mail, management state, drafts and attachments before provider connection', async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-mailbox-'));
  const db = new Database(':memory:');
  const service = mailboxService.setup(db, { dataDir: dir });
  const inbound = service.ingest({
    providerId: 'provider-1',
    fromName: 'A Reader',
    fromEmail: 'reader@example.com',
    to: ['info@realitymanual.com'],
    subject: 'Question about my order',
    textBody: 'Could you tell me when it will arrive?',
    attachments: [{ fileName: 'order-photo.jpg', mimeType: 'image/jpeg', content: Buffer.from('photo'), inline: false }],
    receivedAt: '2026-09-22T09:00:00.000Z'
  });
  assert.equal(service.ingest({ providerId: 'provider-1' }).id, inbound.id, 'provider ids deduplicate syncs');

  const app = express();
  app.use(express.json());
  app.use('/api/mailbox', service.router);
  const server = app.listen(0);
  t.after(function () { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port + '/api/mailbox';
  async function request(route, options, expectedStatus) {
    const response = await fetch(base + route, options);
    const body = await response.json();
    assert.equal(response.status, expectedStatus || 200, JSON.stringify(body));
    return body;
  }

  let status = await request('/status');
  assert.equal(status.configured, false);
  assert.equal(status.unread, 1);
  const inbox = await request('/threads?folder=inbox');
  assert.equal(inbox.threads.length, 1);
  assert.equal(inbox.threads[0].unreadCount, 1);

  const opened = await request('/threads/' + inbound.threadId);
  assert.equal(opened.messages[0].textBody, 'Could you tell me when it will arrive?');
  assert.equal(opened.messages[0].attachments[0].fileName, 'order-photo.jpg');
  status = await request('/status');
  assert.equal(status.unread, 0, 'opening marks inbound mail read');

  await request('/threads/' + inbound.threadId, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ starred: true, read: false })
  });
  assert.equal((await request('/threads?folder=starred')).threads.length, 1);
  assert.equal((await request('/status')).unread, 1);

  const form = new FormData();
  form.append('threadId', inbound.threadId);
  form.append('to', JSON.stringify(['reader@example.com']));
  form.append('cc', '[]');
  form.append('subject', 'Re: Question about my order');
  form.append('textBody', 'Thanks for writing.');
  form.append('htmlBody', '<p>Thanks for writing.</p><img src="cid:receipt-image">');
  form.append('attachmentMeta', JSON.stringify([{ inline: true, contentId: 'receipt-image' }]));
  form.append('attachments', new Blob(['image bytes'], { type: 'image/png' }), 'answer.png');
  const draft = await request('/drafts', { method: 'POST', body: form }, 201);
  assert.equal(draft.draft.status, 'draft');
  assert.equal(draft.draft.attachments[0].inline, true);
  assert.equal((await request('/threads?folder=drafts')).threads.length, 1);

  const send = new FormData();
  send.append('draftId', draft.draft.id);
  send.append('threadId', inbound.threadId);
  send.append('to', JSON.stringify(['reader@example.com']));
  send.append('cc', '[]');
  send.append('subject', 'Re: Question about my order');
  send.append('textBody', 'Thanks for writing.');
  send.append('htmlBody', '<p>Thanks for writing.</p><img src="cid:receipt-image">');
  send.append('attachmentMeta', '[]');
  const unsent = await request('/send', { method: 'POST', body: send }, 503);
  assert.equal(unsent.error, 'mailbox_not_connected');
  assert.equal(unsent.draft.id, draft.draft.id);
  assert.equal((await request('/status')).drafts, 1);
});

test('configured transport sends a stored message and exposes it in Sent', async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-mailbox-send-'));
  const db = new Database(':memory:');
  const sent = [];
  const service = mailboxService.setup(db, {
    dataDir: dir,
    transport: { name: 'Test mail', send: async function (payload) { sent.push(payload); return { id: 'sent-1' }; } }
  });
  const app = express();
  app.use(express.json());
  app.use('/api/mailbox', service.router);
  const server = app.listen(0);
  t.after(function () { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const form = new FormData();
  form.append('to', JSON.stringify(['customer@example.com']));
  form.append('cc', '[]');
  form.append('subject', 'Your Reality Manual');
  form.append('textBody', 'Hello');
  form.append('htmlBody', '<p>Hello</p>');
  form.append('attachmentMeta', '[]');
  const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/mailbox/send', { method: 'POST', body: form });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.message.status, 'sent');
  assert.equal(sent.length, 1);
  const sentResponse = await fetch('http://127.0.0.1:' + server.address().port + '/api/mailbox/threads?folder=sent');
  assert.equal((await sentResponse.json()).threads.length, 1);
});
