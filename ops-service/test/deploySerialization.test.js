'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('ops-service deployments serialize before touching Git or Docker', function () {
  const source = fs.readFileSync(path.join(__dirname, '..', 'deploy.sh'), 'utf8');
  const lock = source.indexOf('flock -w 900 9');
  const repo = source.indexOf('cd "$REPO_DIR"');
  const docker = source.indexOf('docker build -t "$IMAGE"');

  assert.ok(lock > 0, 'deployment lock is present');
  assert.ok(lock < repo, 'lock is taken before Git state changes');
  assert.ok(lock < docker, 'lock is taken before Docker changes');
  assert.match(source, /sourcePreparationStatus/);
  assert.match(source, /'queued','archiving','compacting'/);
  assert.match(source, /browserPreviewStatus/);
  assert.match(source, /renderStatus/);
});
