'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ranges = require('../src/rangeResponse');

test('byte ranges cover bounded, open-ended and suffix video requests', function () {
  assert.deepEqual(ranges.parseByteRange('bytes=0-999', 5000), { start: 0, end: 999 });
  assert.deepEqual(ranges.parseByteRange('bytes=4096-', 5000), { start: 4096, end: 4999 });
  assert.deepEqual(ranges.parseByteRange('bytes=-500', 5000), { start: 4500, end: 4999 });
  assert.deepEqual(ranges.parseByteRange('bytes=4500-9999', 5000), { start: 4500, end: 4999 });
  assert.deepEqual(ranges.parseByteRange('bytes=0-', 20 * 1024 * 1024), {
    start: 0, end: ranges.maxRangeBytes - 1
  });
  assert.deepEqual(ranges.parseByteRange('bytes=100-9999999', 20 * 1024 * 1024), {
    start: 100, end: 100 + ranges.maxRangeBytes - 1
  });
});

test('invalid or multipart byte ranges are rejected safely', function () {
  assert.deepEqual(ranges.parseByteRange('bytes=5000-', 5000), { invalid: true });
  assert.deepEqual(ranges.parseByteRange('bytes=900-800', 5000), { invalid: true });
  assert.deepEqual(ranges.parseByteRange('bytes=0-10,20-30', 5000), { invalid: true });
  assert.deepEqual(ranges.parseByteRange('items=0-10', 5000), { invalid: true });
  assert.equal(ranges.parseByteRange('', 5000), null);
});
