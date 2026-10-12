'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Final Check exposes one scheduling button and no visibility selector', function () {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.doesNotMatch(source, /fc-yt-privacy|YouTube visibility/);
  assert.match(source, /Schedule Video/);
  assert.doesNotMatch(source, /privacyStatus:\s*privacyStatus/);
});
