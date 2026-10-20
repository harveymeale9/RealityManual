'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('re-login rebuilds role-dependent navigation before the already-initialized branch', function () {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const init = app.slice(app.indexOf('function initApp()'), app.indexOf('var editorUnreadTimer'));
  assert.ok(init.indexOf('syncRoleNavigation();') < init.indexOf('if (appInitialized)'));
  assert.match(app, /function syncRoleNavigation\(\)\s*\{[\s\S]*?classList\.toggle\('role-reviewer', IS_REVIEWER\)/);
  assert.match(app, /switchAdminBtn'\)\.hidden = !IS_REVIEWER/);
  assert.match(page, /id="switchAdminBtn"[^>]*hidden/);
});
