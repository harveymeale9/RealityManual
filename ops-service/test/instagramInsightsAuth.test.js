'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const instagram = require('../src/instagramInsightsAuth');

const config = { appId: '123456789', appSecret: 'private-secret',
  redirectUri: 'https://ops.realitymanual.com/api/instagram/oauth/callback' };
function ok(body) { return { ok: true, json: async function () { return body; } }; }

test('Instagram insights uses its own Business Login URL and only necessary scopes', function () {
  const url = new URL(instagram.buildAuthUrl(config, 'csrf-state'));
  assert.equal(url.origin, 'https://www.instagram.com');
  assert.equal(url.searchParams.get('redirect_uri'), config.redirectUri);
  assert.equal(url.searchParams.get('state'), 'csrf-state');
  assert.deepEqual(url.searchParams.get('scope').split(','),
    ['instagram_business_basic', 'instagram_business_manage_insights']);
  assert.equal(url.searchParams.get('scope').includes('manage_messages'), false);
  assert.equal(instagram.validConfig({ appId: 'not an id', appSecret: 'x', redirectUri: config.redirectUri }), false);
});

test('Instagram code exchange, renewal and profile use only Instagram endpoints', async function () {
  const calls = [];
  const fetchImpl = async function (url, options) {
    calls.push({ url: String(url), options: options || {} });
    if (String(url).includes('api.instagram.com')) return ok({ access_token: 'short', user_id: 17 });
    if (String(url).includes('/refresh_access_token')) return ok({ access_token: 'renewed', expires_in: 5184000 });
    if (String(url).includes('/access_token')) return ok({ access_token: 'long', expires_in: 5184000 });
    return ok({ id: '17', username: 'realitymanual' });
  };
  const short = await instagram.exchangeCode(config, 'auth-code', fetchImpl);
  const long = await instagram.exchangeLongLived(short.accessToken, config.appSecret, fetchImpl);
  const account = await instagram.profile(long.access_token, fetchImpl);
  const renewal = await instagram.refreshLongLived(long.access_token, fetchImpl);
  assert.deepEqual(short, { accessToken: 'short', userId: '17' });
  assert.equal(long.access_token, 'long');
  assert.equal(account.username, 'realitymanual');
  assert.equal(renewal.access_token, 'renewed');
  assert.ok(calls.every(function (call) { return !call.url.includes('facebook.com'); }));
  assert.equal(new URLSearchParams(calls[0].options.body).get('client_secret'), config.appSecret);
});

test('Instagram catalog matches published Reels by ID or permalink and retrieves views', async function () {
  const fetchImpl = async function (url) {
    const parsed = new URL(url);
    if (parsed.pathname === '/me/media') return ok({ data: [{ id: 'ig-scoped-1', permalink: 'https://www.instagram.com/reel/ABC123/' }] });
    if (parsed.searchParams.get('metric') === 'views') return ok({ data: [{ name: 'views', total_value: { value: 351 } }] });
    return ok({ data: [{ name: 'reach', total_value: { value: 200 } }] });
  };
  const catalog = await instagram.mediaCatalog('token', fetchImpl);
  const match = instagram.findMedia(catalog, { instagramMediaId: 'fb-graph-1', instagramUrl: 'https://instagram.com/reel/ABC123/?utm=1' });
  assert.equal(match.id, 'ig-scoped-1');
  assert.equal(instagram.findMedia(catalog, { instagramMediaId: 'ig-scoped-1' }).id, 'ig-scoped-1');
  assert.equal(instagram.findMedia(catalog, { instagramUrl: 'https://not-instagram.test/reel/ABC123/' }), null);
  const metrics = await instagram.mediaInsights(match.id, 'token', fetchImpl);
  assert.equal(metrics.views, 351);
  assert.equal(metrics.reach, 200);
});

test('Instagram analytics login stays separate from Facebook publishing credentials', function () {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(server, /api\/instagram\/oauth\/callback/);
  assert.match(server, /CREATE TABLE IF NOT EXISTS instagram_insights_oauth/);
  assert.match(server, /instagramInsightsAuth\.mediaInsights/);
  assert.match(ui, /Do not put it in the Webhooks Callback URL field/);
  assert.match(ui, /Instagram Insights · view counts/);
});
