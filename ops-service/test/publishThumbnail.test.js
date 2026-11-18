'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const thumbnail = require('../src/publishThumbnail');

test('selected JPEG data URL decodes exactly and invalid images are rejected', function () {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(100, 42), Buffer.from([0xff, 0xd9])]);
  assert.deepEqual(thumbnail.jpegBytes('data:image/jpeg;base64,' + jpeg.toString('base64')), jpeg);
  assert.equal(thumbnail.jpegBytes(''), null);
  assert.throws(function () { thumbnail.jpegBytes('data:image/png;base64,' + jpeg.toString('base64')); }, /not a JPEG/);
  assert.throws(function () { thumbnail.jpegBytes('data:image/jpeg;base64,' + Buffer.alloc(101).toString('base64')); }, /invalid/);
  assert.equal(thumbnail.offsetMilliseconds(1.234), 1234);
  assert.equal(thumbnail.offsetMilliseconds(null), 0);
  assert.equal(thumbnail.offsetMilliseconds(-1), null);
});
