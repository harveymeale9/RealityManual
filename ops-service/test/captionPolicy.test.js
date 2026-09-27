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

test('tracked caption links are allowed only on long-form YouTube', function () {
  assert.equal(Store.captionAllowsTrackedLink('ytlong'), true);
  ['facebook', 'ytshort', 'instagram', 'tiktok'].forEach(function (platform) {
    assert.equal(Store.captionAllowsTrackedLink(platform), false, platform);
  });
});

test('Facebook removes outbound links and always appends the book-in-bio CTA', function () {
  const link = 'https://realitymanual.com?utm_source=facebook';
  assert.equal(
    Store.renderPlatformCaption('A useful caption\n\nRead it here: [LINK]', 'facebook', link),
    'A useful caption\n\nRead it here\n\n' + Store.FACEBOOK_BIO_CTA
  );
  assert.equal(
    Store.renderPlatformCaption('A useful caption https://example.test/book', 'facebook', link),
    'A useful caption\n\n' + Store.FACEBOOK_BIO_CTA
  );
  assert.equal(Store.renderPlatformCaption('', 'facebook', link), Store.FACEBOOK_BIO_CTA);
  assert.equal(Store.renderPlatformCaption('', 'facebook', link).includes(link), false);
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
