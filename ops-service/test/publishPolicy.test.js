'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../src/publishPolicy');

test('Harvey Final Check schedules always publish YouTube publicly', function () {
  assert.equal(policy.youtubePrivacyStatus('admin'), 'public');
  assert.equal(policy.youtubePrivacyStatus(undefined), 'public');
});

test('the restricted YouTube reviewer remains unable to publish publicly', function () {
  assert.equal(policy.youtubePrivacyStatus('youtube-reviewer'), 'private');
});
