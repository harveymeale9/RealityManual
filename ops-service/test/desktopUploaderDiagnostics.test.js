'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('desktop uploader reports actionable failures without exposing multiline output', function () {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const uploader = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'windows-uploader', 'Program.cs'), 'utf8');

  assert.match(server, /errorMessage:\s*device\.errorMessage \|\| ''/);
  assert.match(server, /replace\(\/\[\\r\\n\]\+\/g, ' '\)\.trim\(\)\.slice\(0, 500\)/);
  assert.match(client, /if \(device\.errorMessage\) detail \+=/);
  assert.match(uploader, /errorMessage \}\);/);
  assert.match(uploader, /Program\.Log\("Upload scan failed: " \+ error\)/);
});

test('desktop uploader cannot be blocked by a missing stale recording or one bad folder', function () {
  const uploader = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'windows-uploader', 'Program.cs'), 'utf8');

  assert.match(uploader, /RemoveAll\(x => !x\.Complete && !File\.Exists\(x\.Path\)\)/);
  assert.match(uploader, /foreach \(var folder in config\.WatchFolders\(\)\)[\s\S]*?catch \(Exception error\)[\s\S]*?scanWarnings\.Add/);
  assert.match(uploader, /if \(scanWarnings\.Count == config\.WatchFolders\(\)\.Count\(\)\)/);
});
