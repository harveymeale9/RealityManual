'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const feed = require('../src/positiveComments');
const youtube = require('../src/youtubeAuth');

function item(id, text, date, authorChannelId) {
  return { id, snippet: { textDisplay: text, publishedAt: date, authorDisplayName: 'Viewer ' + id,
    authorChannelId: { value: authorChannelId || 'UCviewer' } } };
}

test('strict appreciation filter leaves out mixed, uncertain, negative and spam comments', function () {
  assert.equal(feed.clearlyPositive('Thank you so much, this helped me!'), true);
  assert.equal(feed.clearlyPositive('Nobody gets enlightened as enlightenment is the dissolution of the illusion of the separate self, In my humble and limited experience. Thank you for the video.'), false);
  assert.equal(feed.clearlyPositive('Your videos changed how I see my life. Thank you.'), true);
  assert.equal(feed.clearlyPositive('I love your work. It inspired me to make a change.'), true);
  assert.equal(feed.clearlyPositive('Thanks for this video'), false);
  assert.equal(feed.clearlyPositive('Thank you for making these videos'), true);
  assert.equal(feed.clearlyPositive('Thanks 🔥☀️🌑💪🏾👍🏾'), false);
  assert.equal(feed.clearlyPositive('I took mushrooms and it changed my life forever'), false);
  assert.equal(feed.clearlyPositive('Love your neighbor as yourself'), false);
  assert.equal(feed.clearlyPositive('Amazing video, but I disagree with your conclusion.'), false);
  assert.equal(feed.clearlyPositive('Great video? Please explain why.'), false);
  assert.equal(feed.clearlyPositive("Great video. I don't think this works."), false);
  assert.equal(feed.clearlyPositive('This is wrong and misleading.'), false);
  assert.equal(feed.clearlyPositive('Great video, check www.example.com'), false);
  assert.equal(feed.clearlyPositive('I like pineapple pizza'), false);
});

test('comment scan deduplicates replies, skips creator and sorts newest first', async function () {
  const now = Date.parse('2026-11-16T12:00:00Z');
  const channel = 'UCcreator';
  const pages = [
    { items: [{ snippet: { videoId: 'abcdefghijk', topLevelComment: item('one', 'Thank you for making this video', '2026-11-15T12:00:00Z'), totalReplyCount: 2 },
      replies: { comments: [item('two', 'Amazing work on this channel', '2026-11-16T10:00:00Z')] } }], nextPageToken: 'next' },
    { items: [{ snippet: { videoId: 'abcdefghijk', topLevelComment: item('three', 'Great video, but I disagree', '2026-11-14T12:00:00Z'), totalReplyCount: 0 } },
      { snippet: { videoId: 'abcdefghijk', topLevelComment: item('owner', 'Thank you for watching', '2026-11-13T12:00:00Z', channel), totalReplyCount: 0 } } ] }
  ];
  const service = feed.create({ now: () => now,
    fetchThreads: async (_channel, token) => token ? pages[1] : pages[0],
    fetchReplies: async () => ({ items: [item('two', 'Amazing work on this channel', '2026-11-16T10:00:00Z')] }) });
  assert.equal(service.get(channel).loading, true);
  await new Promise(resolve => setImmediate(resolve));
  const result = service.get(channel);
  assert.equal(result.loading, false);
  assert.deepEqual(result.comments.map(row => row.id), ['two', 'one']);
  assert.match(result.comments[0].url, /watch\?v=abcdefghijk&lc=two/);
  assert.equal(result.partial, false);
});

test('missing comment scope yields a reconnect prompt without removing the upload scope', async function () {
  assert.ok(youtube.SCOPES.includes('https://www.googleapis.com/auth/youtube.upload'));
  assert.ok(youtube.SCOPES.includes('https://www.googleapis.com/auth/youtube.force-ssl'));
  const service = feed.create({ fetchThreads: async () => { const error = new Error('denied'); error.status = 403; throw error; },
    fetchReplies: async () => ({}) });
  service.get('UCcreator');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.get('UCcreator').requiresReconnect, true);
});
