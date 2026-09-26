'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const metaAuth = require('../src/metaAuth');

const config = { appId: '1234567890', appSecret: 'server-secret', redirectUri: 'https://ops.example/api/meta/oauth/callback' };

function response(payload) {
  return { ok: true, status: 200, json: async function () { return payload; } };
}

test('Meta authorization requests only direct publishing and insight permissions', function () {
  const url = new URL(metaAuth.buildAuthUrl(config, 'csrf-token'));
  assert.equal(url.searchParams.get('client_id'), config.appId);
  assert.equal(url.searchParams.get('redirect_uri'), config.redirectUri);
  assert.equal(url.searchParams.get('state'), 'csrf-token');
  const scopes = url.searchParams.get('scope').split(',');
  ['pages_manage_posts', 'instagram_content_publish', 'instagram_manage_insights', 'read_insights'].forEach(function (scope) {
    assert.ok(scopes.includes(scope));
  });
});

test('Meta exchanges the owner grant and discovers the Page plus linked Instagram account', async function () {
  const calls = [];
  const fetchImpl = async function (url) {
    calls.push(new URL(url));
    if (url.indexOf('/me/accounts') !== -1) return response({ data: [{
      id: 'page-1', name: 'Reality Manual', access_token: 'page-token',
      instagram_business_account: { id: 'ig-1', username: 'realitymanual' }
    }] });
    if (url.indexOf('fb_exchange_token') !== -1) return response({ access_token: 'long-token', expires_in: 5184000 });
    return response({ access_token: 'short-token', expires_in: 3600 });
  };
  const short = await metaAuth.exchangeCode(config, 'code', fetchImpl);
  const long = await metaAuth.exchangeLongLived(config, short.access_token, fetchImpl);
  const pages = await metaAuth.fetchManagedPages(long.access_token, fetchImpl);
  assert.equal(long.access_token, 'long-token');
  assert.equal(pages[0].name, 'Reality Manual');
  assert.equal(pages[0].instagram_business_account.username, 'realitymanual');
  assert.equal(calls.length, 3);
});
