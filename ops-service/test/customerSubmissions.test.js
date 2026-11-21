'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Database = require('better-sqlite3');
const {
  CreateMultipartUploadCommand, CompleteMultipartUploadCommand,
  HeadObjectCommand, GetObjectCommand
} = require('@aws-sdk/client-s3');
const service = require('../src/customerSubmissions');

test('reader submission validates review consent, paid video, and 3 GiB ceiling', function () {
  const base = { kind: 'review', name: 'Reader', email: 'reader@example.com', message: 'Honest thoughts', consent: true, files: [] };
  assert.match(service.validateSubmission({ ...base, consent: false }).error, /terms/);
  assert.match(service.validateSubmission({ ...base, paidVideo: true }).error, /video attachment/);
  assert.equal(service.validateSubmission({ ...base, files: [{ name: 'review.mp4', type: 'video/mp4', size: service.MAX_VIDEO_BYTES }] }).files[0].size, service.MAX_VIDEO_BYTES);
  assert.match(service.validateSubmission({ ...base, files: [{ name: 'review.mp4', type: 'video/mp4', size: service.MAX_VIDEO_BYTES + 1 }] }).error, /3 GB/);
  assert.match(service.validateSubmission({ ...base, website: 'spam.example' }).error, /not accepted/);
});

test('public multipart flow stores a private submission and admin can open its media', async function () {
  const db = new Database(':memory:');
  const commands = [];
  const signedCommands = [];
  const notices = [];
  const client = { async send(command) {
    commands.push(command);
    if (command instanceof CreateMultipartUploadCommand) return { UploadId: 'upload-1' };
    if (command instanceof HeadObjectCommand) return { ContentLength: 21 * 1024 * 1024 };
    return {};
  } };
  const handlers = service.setup(db, { bucket: 'test', client,
    sign: async (unused, command) => { signedCommands.push(command); return 'https://r2.example/' + command.constructor.name; },
    sendNotice: async data => notices.push(data.id),
    allowedOrigins: ['https://realitymanual.com'] });
  const app = express(); app.use(express.json());
  app.use('/public', handlers.publicRouter); app.use('/admin', handlers.adminRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function post(path, body, origin = 'https://realitymanual.com') {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  try {
    const body = { kind: 'review', name: 'Reader', email: 'reader@example.com', message: 'A thoughtful, honest review',
      consent: true, paidVideo: true, files: [{ name: 'review.mp4', type: 'video/mp4', size: 21 * 1024 * 1024 }] };
    assert.equal((await post('/public/start', body, 'https://evil.example')).status, 403);
    const started = await post('/public/start', body);
    assert.equal(started.status, 201);
    assert.equal(started.body.files.length, 1);
    assert.equal(started.body.partBytes, 16 * 1024 * 1024);
    const id = started.body.id, token = started.body.token, fileId = started.body.files[0].id;
    assert.equal((await post('/public/' + id + '/part', { token: 'wrong', fileId, partNumber: 1 })).status, 404);
    const part = await post('/public/' + id + '/part', { token, fileId, partNumber: 2 });
    assert.equal(part.status, 200);
    assert.match(part.body.url, /UploadPartCommand/);
    const uploaded = { id: fileId, parts: [{ partNumber: 1, etag: 'a1' }, { partNumber: 2, etag: 'b2' }] };
    const done = await post('/public/' + id + '/complete', { token, files: [uploaded] });
    assert.equal(done.status, 200);
    assert.equal((await post('/public/' + id + '/complete', { token, files: [uploaded] })).status, 200);
    assert.equal(commands.filter(command => command instanceof CompleteMultipartUploadCommand).length, 1);
    const listed = await (await fetch(base + '/admin/')).json();
    assert.equal(listed.submissions.length, 1);
    assert.equal(listed.submissions[0].message, body.message);
    assert.equal(JSON.stringify(listed).includes('upload-1'), false);
    assert.deepEqual((await (await fetch(base + '/admin/summary')).json()).counts, { F: 0, R: 0, VR: 1 });
    assert.equal((await post('/admin/' + id + '/seen', {})).status, 200);
    assert.deepEqual((await (await fetch(base + '/admin/summary')).json()).counts, { F: 0, R: 0, VR: 0 });
    const media = await fetch(base + '/admin/' + id + '/files/' + fileId, { redirect: 'manual' });
    assert.equal(media.status, 302);
    assert.match(media.headers.get('location'), /GetObjectCommand/);
    assert.ok(signedCommands.some(command => command instanceof GetObjectCommand));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(notices, [id]);
  } finally { await new Promise(resolve => server.close(resolve)); db.close(); }
});
