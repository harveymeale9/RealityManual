'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const attachments = require('../src/voiceAttachments');

test('Project Manager accepts MP4 files without passing them as Codex images', function () {
  assert.equal(attachments.extensionForUpload({ mimetype: 'video/mp4', originalname: 'example.mp4' }), '.mp4');
  assert.equal(attachments.extensionForUpload({ mimetype: 'application/octet-stream', originalname: 'OBS Clip.MP4' }), '.mp4');
  assert.equal(attachments.extensionForUpload({ mimetype: 'video/quicktime', originalname: 'example.mov' }), '');

  const row = { attachments_json: JSON.stringify([
    { file: '0.png', mime: 'image/png' },
    { file: '1.mp4', mime: 'video/mp4' },
    { file: '../../escape.mp4', mime: 'video/mp4' }
  ]) };
  const records = attachments.parseRecords(row);
  assert.equal(records.length, 2);
  assert.deepEqual(attachments.hostInputs(records, '/root/ops-service-data', 'message-id'), {
    imagePaths: ['/root/ops-service-data/voice-attachments/message-id/0.png'],
    filePaths: ['/root/ops-service-data/voice-attachments/message-id/1.mp4']
  });
});
