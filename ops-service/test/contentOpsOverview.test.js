'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Content Ops shows the publishing runway and board without the unused summary strip', function () {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const panel = app.slice(app.indexOf('var OPS_MARKUP ='), app.indexOf('var board, statStrip'));
  assert.match(panel, /id="queueCoverage"/);
  assert.match(panel, /id="boardWrap"/);
  assert.doesNotMatch(panel, /overviewRow|overview-tile/);
  assert.doesNotMatch(app, /function renderOverview\(/);
});
