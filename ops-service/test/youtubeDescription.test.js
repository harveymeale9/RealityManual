'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const descriptions = require('../src/youtubeDescription');

const piece = {
  title: 'What the manifestation gurus forget to tell you',
  transcript: 'The manifestation gurus talk about setting an intention, but what happens if the conditions for the thing you want are not in place? '.repeat(8)
};

test('the YouTube caption migration appends the shortcode without changing existing copy', function () {
  const original = { captions: { longform: { ytlong: 'Get the book here: [LINK]', facebook: 'Facebook copy' } } };
  const migrated = descriptions.upgradeSettings(original);
  assert.equal(migrated.captions.longform.ytlong, 'Get the book here: [LINK]\n\n[DESCRIPTION]');
  assert.equal(migrated.captions.longform.facebook, 'Facebook copy');
  assert.equal(original.captions.longform.ytlong, 'Get the book here: [LINK]');
  assert.equal(descriptions.upgradeSettings(migrated), null);
  migrated.captions.longform.ytlong = 'Manual override';
  assert.equal(descriptions.upgradeSettings(migrated), null, 'later removal of the token is respected');
});

test('a pre-existing shortcode is not duplicated by migration', function () {
  const migrated = descriptions.upgradeSettings({ captions: { longform: { ytlong: 'Intro\n\n[description]' } } });
  assert.equal(migrated.captions.longform.ytlong, 'Intro\n\n[description]');
});

test('AI instructions use the edited transcript and constrain spoiler and invented detail', function () {
  const prompt = descriptions.descriptionPrompt(piece);
  assert.match(prompt, /EDITED TRANSCRIPT:/);
  assert.match(prompt, /manifestation gurus/);
  assert.match(prompt, /do not reveal its final conclusion/i);
  assert.match(prompt, /Do not invent claims/i);
  assert.throws(() => descriptions.descriptionPrompt({ transcript: 'too short' }), /transcript/i);
});

test('generation validates prose and keeps one or two paragraphs', async function () {
  const text = await descriptions.generate(piece, async function (prompt, schema, options) {
    assert.match(prompt, /manifestation gurus/);
    assert.equal(schema.required[0], 'paragraphs');
    assert.equal(options.name, 'youtube_video_description');
    return { paragraphs: [
      'This video explores manifestation advice, intention-setting, and the gap between wishing for an outcome and creating its practical conditions.',
      'It looks at the questions that surface when popular self-help claims meet everyday decisions and real-world constraints.'
    ] };
  });
  assert.equal(text.split('\n\n').length, 2);
  assert.throws(() => descriptions.normalizeResult({ paragraphs: ['Read https://example.test now. '.repeat(5)] }), /validation/);
  assert.throws(() => descriptions.normalizeResult({ paragraphs: ['Use [DESCRIPTION] now. '.repeat(7)] }), /validation/);
});

test('shortcode expansion replaces every occurrence and fails closed without prose', function () {
  assert.equal(descriptions.expand('Get the book: [LINK]\n\n[DESCRIPTION]', 'A specific video summary.'),
    'Get the book: [LINK]\n\nA specific video summary.');
  assert.equal(descriptions.expand('First [description], then [DESCRIPTION]', 'Summary'), 'First Summary, then Summary');
  assert.throws(() => descriptions.expand('Intro\n\n[DESCRIPTION]', ''), /missing/);
  assert.equal(descriptions.expand('No shortcode', ''), 'No shortcode');
});

test('cached summary source hash changes when edited transcript or YouTube title changes', function () {
  assert.notEqual(descriptions.sourceHash(piece), descriptions.sourceHash({ ...piece, transcript: piece.transcript + ' New edit.' }));
  assert.notEqual(descriptions.sourceHash(piece), descriptions.sourceHash({ ...piece, ytTitles: ['A different title'] }));
});
