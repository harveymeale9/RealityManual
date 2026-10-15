'use strict';

// Instagram Business Login is a separate OAuth/token family from the existing
// Facebook Login connection used to publish Reels. Never send its token to
// graph.facebook.com or replace the publishing Page token with it.
const AUTH_URL = 'https://www.instagram.com/oauth/authorize';
const TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const GRAPH_URL = 'https://graph.instagram.com';
const SCOPES = ['instagram_business_basic', 'instagram_business_manage_insights'];

function clean(value, max) { return String(value == null ? '' : value).trim().slice(0, max || 1000); }
function validConfig(config) {
  return !!(config && /^\d{5,40}$/.test(clean(config.appId, 40)) && clean(config.appSecret, 300) &&
    /^https:\/\/[^\s]+$/.test(clean(config.redirectUri, 500)));
}
function buildAuthUrl(config, state) {
  if (!validConfig(config)) throw new Error('Instagram App ID and Secret are not configured.');
  return AUTH_URL + '?' + new URLSearchParams({
    client_id: config.appId, redirect_uri: config.redirectUri,
    response_type: 'code', scope: SCOPES.join(','), state: clean(state, 200)
  });
}
async function jsonResponse(response, label) {
  const body = await response.json().catch(function () { return {}; });
  if (!response.ok || body.error) {
    const detail = body.error && (body.error.message || body.error.error_message) || 'HTTP ' + response.status;
    throw new Error(label + ': ' + clean(detail, 300));
  }
  return body;
}
async function exchangeCode(config, code, fetchImpl) {
  fetchImpl = fetchImpl || fetch;
  code = clean(code, 1000).replace(/#_$/, '');
  if (!validConfig(config) || !code) throw new Error('Instagram authorization is incomplete.');
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.appId, client_secret: config.appSecret,
      grant_type: 'authorization_code', redirect_uri: config.redirectUri, code: code })
  });
  const body = await jsonResponse(response, 'Instagram authorization');
  const token = body.access_token || (Array.isArray(body.data) && body.data.length === 1 && body.data[0].access_token);
  if (!token) throw new Error('Instagram authorization did not return a token.');
  return { accessToken: token, userId: clean(body.user_id || (body.data && body.data[0] && body.data[0].user_id), 100) };
}
async function graphGet(path, params, token, fetchImpl, label) {
  fetchImpl = fetchImpl || fetch;
  const query = new URLSearchParams(Object.assign({}, params, { access_token: clean(token, 2000) }));
  return jsonResponse(await fetchImpl(GRAPH_URL + path + '?' + query), label);
}
async function exchangeLongLived(shortToken, appSecret, fetchImpl) {
  return graphGet('/access_token', { grant_type: 'ig_exchange_token', client_secret: appSecret },
    shortToken, fetchImpl, 'Instagram long-lived token exchange');
}
async function refreshLongLived(token, fetchImpl) {
  return graphGet('/refresh_access_token', { grant_type: 'ig_refresh_token' }, token, fetchImpl,
    'Instagram token refresh');
}
async function profile(token, fetchImpl) {
  return graphGet('/me', { fields: 'id,username' }, token, fetchImpl,
    'Instagram account lookup');
}
function permalinkKey(value) {
  try {
    const url = new URL(value);
    if (url.hostname !== 'instagram.com' && url.hostname !== 'www.instagram.com') return '';
    const match = url.pathname.match(/^\/(?:p|reel|tv)\/([^/]+)/);
    return match ? match[1] : '';
  } catch (error) { return ''; }
}
async function mediaCatalog(token, fetchImpl) {
  const media = [];
  let after = '';
  for (let page = 0; page < 5; page++) {
    const result = await graphGet('/me/media', Object.assign({ fields: 'id,permalink,media_product_type', limit: '100' },
      after ? { after: after } : {}), token, fetchImpl, 'Instagram media lookup');
    media.push.apply(media, Array.isArray(result.data) ? result.data : []);
    const next = result.paging && result.paging.cursors && result.paging.cursors.after;
    if (!next || next === after) break;
    after = next;
  }
  return media;
}
function findMedia(catalog, piece) {
  const id = clean(piece && piece.instagramMediaId, 100);
  const permalink = permalinkKey(piece && piece.instagramUrl);
  return (catalog || []).find(function (media) {
    return String(media.id) === id || (permalink && permalinkKey(media.permalink) === permalink);
  }) || null;
}
function insightValue(rows, name) {
  const row = (rows || []).find(function (item) { return item && item.name === name; });
  if (!row) return null;
  if (row.total_value && row.total_value.value != null) return Number(row.total_value.value);
  if (row.values && row.values[0] && row.values[0].value != null) return Number(row.values[0].value);
  return null;
}
async function mediaInsights(mediaId, token, fetchImpl) {
  const result = await graphGet('/' + encodeURIComponent(clean(mediaId, 100)) + '/insights',
    { metric: 'views', metric_type: 'total_value' }, token, fetchImpl,
    'Instagram Reel insights lookup');
  const rows = result.data || [];
  const views = insightValue(rows, 'views');
  if (views == null) throw new Error('Instagram did not return a Reel views value.');
  let extras = [];
  try {
    const additional = await graphGet('/' + encodeURIComponent(clean(mediaId, 100)) + '/insights',
      { metric: 'reach,saved,shares', metric_type: 'total_value' }, token, fetchImpl,
      'Instagram additional Reel insights lookup');
    extras = additional.data || [];
  } catch (error) { /* Views are the essential metric; optional fields may differ by media type. */ }
  return { views: views, reach: insightValue(extras, 'reach'),
    saves: insightValue(extras, 'saved'), shares: insightValue(extras, 'shares') };
}

module.exports = { AUTH_URL, GRAPH_URL, SCOPES, validConfig, buildAuthUrl, exchangeCode,
  exchangeLongLived, refreshLongLived, profile, mediaCatalog, findMedia, mediaInsights, permalinkKey };
