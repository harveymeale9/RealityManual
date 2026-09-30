'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const storageModule = require('../src/r2Storage');

function command(name) {
  return class FakeCommand {
    constructor(input) { this.name = name; this.input = input; }
  };
}

const commandTypes = {
  HeadBucketCommand: command('headBucket'),
  HeadObjectCommand: command('headObject'),
  GetObjectCommand: command('getObject'),
  DeleteObjectCommand: command('deleteObject')
};

test('R2 storage reports missing configuration without constructing a client', async function () {
  const storage = storageModule.setup({});
  assert.equal(storage.configured, false);
  assert.deepEqual(storage.missing, ['R2_ENDPOINT', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']);
  assert.deepEqual(await storage.health(), { configured: false, connected: false, missing: storage.missing });
  await assert.rejects(storage.signedGetUrl('x', 60), /not configured/);
});

test('R2 uploads are multipart, verified by size, downloadable and privately signed', async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-r2-'));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  const source = path.join(dir, 'final.mp4');
  const destination = path.join(dir, 'download.mp4');
  fs.writeFileSync(source, Buffer.alloc(4096, 3));
  const calls = [];
  const client = {
    send: async function (cmd) {
      calls.push(cmd);
      if (cmd.name === 'headBucket') return {};
      if (cmd.name === 'headObject') return { ContentLength: 4096, ETag: '"etag-1"', ContentType: 'video/mp4' };
      if (cmd.name === 'getObject') return { Body: Readable.from(Buffer.alloc(4096, 3)), ContentType: 'video/mp4' };
      return {};
    }
  };
  let uploadInput = null;
  const storage = storageModule.setup({
    endpoint: 'https://account.r2.cloudflarestorage.com', bucket: 'reality-manual-content',
    accessKeyId: 'key', secretAccessKey: 'secret', client: client, commandTypes: commandTypes,
    uploadFactory: function (input) {
      uploadInput = input;
      return { done: async function () { for await (const _chunk of input.params.Body) {} } };
    },
    getSignedUrl: async function (_client, cmd, options) {
      assert.equal(cmd.input.Key, 'publish-ready/piece-1/final.mp4');
      assert.equal(options.expiresIn, 604800);
      return 'https://signed.example/video';
    }
  });
  assert.deepEqual(await storage.health(), { configured: true, connected: true, bucket: 'reality-manual-content' });
  const uploaded = await storage.uploadFile('piece-1', source, 'video/mp4');
  assert.equal(uploadInput.partSize, 16 * 1024 * 1024);
  assert.equal(uploadInput.leavePartsOnError, false);
  assert.equal(uploadInput.params.Key, 'publish-ready/piece-1/final.mp4');
  assert.equal(uploaded.sizeBytes, 4096);
  assert.equal(uploaded.etag, 'etag-1');
  assert.equal(await storage.signedGetUrl(uploaded.key, 9999999), 'https://signed.example/video');
  const downloaded = await storage.downloadKey(uploaded.key, destination);
  assert.equal(downloaded.sizeBytes, 4096);
  assert.deepEqual(fs.readFileSync(destination), fs.readFileSync(source));
  await storage.deleteKey(uploaded.key);
  assert.equal(calls[calls.length - 1].name, 'deleteObject');
});

test('R2 upload refuses a remote object whose verified size differs', async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-r2-size-'));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  const source = path.join(dir, 'final.mp4');
  fs.writeFileSync(source, Buffer.alloc(2048));
  const storage = storageModule.setup({
    endpoint: 'https://account.r2.cloudflarestorage.com', bucket: 'bucket', accessKeyId: 'key', secretAccessKey: 'secret',
    client: { send: async function () { return { ContentLength: 1024, ETag: 'etag' }; } }, commandTypes: commandTypes,
    uploadFactory: function (input) { return { done: async function () { for await (const _chunk of input.params.Body) {} } }; }
  });
  await assert.rejects(storage.uploadFile('piece-2', source, 'video/mp4'), /remote size did not match/);
});
