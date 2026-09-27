const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadStore() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'store.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename: 'store.js' });
  return sandbox.window.RMStore;
}

const Store = loadStore();

test('tracked caption links are allowed on Facebook and long-form YouTube', function () {
  assert.equal(Store.captionAllowsTrackedLink('facebook'), true);
  assert.equal(Store.captionAllowsTrackedLink('ytlong'), true);
  ['ytshort', 'instagram', 'tiktok'].forEach(function (platform) {
    assert.equal(Store.captionAllowsTrackedLink(platform), false, platform);
  });
});

test('Facebook publishes the selected caption exactly and expands an optional LINK token', function () {
  const link = 'https://realitymanual.com?utm_source=facebook';
  assert.equal(
    Store.renderPlatformCaption('A useful caption\n\nRead it here: [LINK]', 'facebook', link),
    'A useful caption\n\nRead it here: ' + link
  );
  assert.equal(
    Store.renderPlatformCaption('A useful caption https://example.test/book', 'facebook', link),
    'A useful caption https://example.test/book'
  );
  assert.equal(Store.renderPlatformCaption('Get the book through the link in our bio.', 'facebook', link), 'Get the book through the link in our bio.');
  assert.equal(Store.renderPlatformCaption('', 'facebook', link), '');
});

test('long-form YouTube expands LINK without forcing one into an unlinked template', function () {
  const link = 'https://realitymanual.com?utm_source=youtube';
  assert.equal(Store.renderPlatformCaption('Read it here: [LINK]', 'ytlong', link), 'Read it here: ' + link);
  assert.equal(Store.renderPlatformCaption('A useful description', 'ytlong', link), 'A useful description');
});

test('link-free platform captions cannot publish an old saved LINK shortcode', function () {
  ['ytshort', 'instagram', 'tiktok'].forEach(function (platform) {
    const rendered = Store.renderPlatformCaption('A useful caption\n\nRead it: [LINK]!', platform, 'https://example.test');
    assert.equal(rendered.includes('[LINK]'), false, platform);
    assert.equal(rendered.includes('https://example.test'), false, platform);
    assert.equal(rendered, 'A useful caption\n\nRead it');
  });
});
