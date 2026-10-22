'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const descriptions = require('../src/socialDescription');

const piece = { title: 'Desire is NOT the root of all suffering',
  transcript: 'Desire can be confused with the fear of losing something. The question is what actually causes suffering when a person wants a different outcome. '.repeat(4) };

test('social template migration preserves Harvey’s copy and later opt-out', function () {
  const original = { captions: { shortform: { instagram: 'Instagram copy', facebook: 'Facebook copy' }, longform: { facebook: 'Long Facebook copy' } } };
  const migrated = descriptions.upgradeSettings(original);
  assert.equal(migrated.captions.shortform.instagram, 'Instagram copy\n\n[DESCRIPTION]');
  assert.equal(migrated.captions.shortform.facebook, 'Facebook copy\n\n[DESCRIPTION]');
  assert.equal(migrated.captions.longform.facebook, 'Long Facebook copy\n\n[DESCRIPTION]');
  assert.equal(original.captions.shortform.instagram, 'Instagram copy');
  assert.equal(descriptions.upgradeSettings(migrated), null);
  migrated.captions.shortform.instagram = 'Manual opt-out';
  assert.equal(descriptions.upgradeSettings(migrated), null);
  assert.equal(descriptions.appendToken('Already [DESC]'), 'Already [DESC]');
});

test('social prose is transcript-grounded, short, and safe for both Meta captions', async function () {
  const prose = await descriptions.generate(piece, async function (prompt, schema, options) {
    assert.match(prompt, /Desire can be confused/);
    assert.match(prompt, /no more than 50 words/);
    assert.match(prompt, /without spoiling/);
    assert.equal(schema.required[0], 'description');
    assert.equal(options.name, 'social_video_description');
    return { description: 'Is desire itself the problem? This video looks at wanting, fear of loss, and the emotions behind suffering—without giving away its conclusion.' };
  });
  assert.doesNotMatch(prose, /[\u2013\u2014]/);
  assert.equal(descriptions.expand('Book line.\n\n[DESCRIPTION]', prose), 'Book line.\n\n' + prose);
  assert.equal(descriptions.expand('Book line.\n\n[DESC]', prose), 'Book line.\n\n' + prose);
  assert.throws(() => descriptions.normalizeResult({ description: 'word '.repeat(51) }), /validation/);
  assert.throws(() => descriptions.normalizeResult({ description: 'Explore this idea at https://example.test and learn about desire and suffering in this video.' }), /validation/);
  assert.throws(() => descriptions.descriptionPrompt({ transcript: 'too short' }), /transcript/i);
});

test('a frozen queued caption carries real prose before deployment and refreshes from its base later', function () {
  const text = 'This video explores desire, fear of loss, and the question of what actually makes a person suffer.';
  const queued = descriptions.backfillDestination({ platform: 'instagram', caption: 'Standard copy.' }, text);
  assert.equal(queued.caption, 'Standard copy.\n\n' + text);
  assert.equal(queued.socialDescriptionBaseCaption, 'Standard copy.');
  assert.deepEqual(descriptions.backfillDestination(queued, text), queued, 'a rerun never duplicates the prose');
  const changed = 'This video considers the difference between wanting an outcome and fearing that it may never arrive.';
  assert.equal(descriptions.destinationCaption(queued, changed), 'Standard copy.\n\n' + changed);
  assert.equal(descriptions.backfillDestination({ platform: 'tiktok', caption: 'TikTok copy.' }, text).caption, 'TikTok copy.');
  assert.notEqual(descriptions.sourceHash(piece), descriptions.sourceHash({ ...piece, transcript: piece.transcript + ' More.' }));
});

test('Meta publish expands the cached text before both platform API calls', function () {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /socialDescription\.destinationCaption\(destination, await ensureSocialDescription\(id\)\)/);
  assert.match(server, /description: maskCaption\(socialCaption\)/);
  assert.match(server, /caption: maskCaption\(socialCaption\)/);
  assert.match(server, /'socialDescriptionText', 'socialDescriptionSourceHash'/);
});
