'use strict';

const API_VERSION = 'v26.0';
const AUTH_URL = 'https://www.facebook.com/' + API_VERSION + '/dialog/oauth';
const GRAPH_URL = 'https://graph.facebook.com/' + API_VERSION;
const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'read_insights',
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_insights'
];

function clean(value, max) { return String(value == null ? '' : value).trim().slice(0, max || 1000); }

function validConfig(config) {
  return !!(config && /^\d{5,40}$/.test(clean(config.appId, 40)) && clean(config.appSecret, 300) && clean(config.redirectUri, 500));
}

function buildAuthUrl(config, state) {
  if (!validConfig(config)) throw new Error('Meta app credentials are not configured.');
  const params = new URLSearchParams({
    client_id: clean(config.appId, 40), redirect_uri: clean(config.redirectUri, 500),
    response_type: 'code', scope: SCOPES.join(','), state: clean(state, 200)
  });
  return AUTH_URL + '?' + params.toString();
}

async function graphJson(fetchImpl, url, options, label) {
  const response = await fetchImpl(url, options || {});
  const body = await response.json().catch(function () { return {}; });
  if (!response.ok || body.error) {
    const message = body.error && body.error.message ? body.error.message : ('HTTP ' + response.status);
    throw new Error(label + ' failed: ' + clean(message, 500));
  }
  return body;
}

async function exchangeCode(config, code, fetchImpl) {
  fetchImpl = fetchImpl || fetch;
  const params = new URLSearchParams({
    client_id: config.appId, client_secret: config.appSecret,
    redirect_uri: config.redirectUri, code: clean(code, 1000)
  });
  return graphJson(fetchImpl, GRAPH_URL + '/oauth/access_token?' + params.toString(), {}, 'Meta authorization');
}

async function exchangeLongLived(config, accessToken, fetchImpl) {
  fetchImpl = fetchImpl || fetch;
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token', client_id: config.appId,
    client_secret: config.appSecret, fb_exchange_token: clean(accessToken, 2000)
  });
  return graphJson(fetchImpl, GRAPH_URL + '/oauth/access_token?' + params.toString(), {}, 'Meta long-lived token exchange');
}

async function fetchManagedPages(accessToken, fetchImpl) {
  fetchImpl = fetchImpl || fetch;
  const params = new URLSearchParams({
    fields: 'id,name,access_token,instagram_business_account{id,username}',
    access_token: clean(accessToken, 2000)
  });
  const result = await graphJson(fetchImpl, GRAPH_URL + '/me/accounts?' + params.toString(), {}, 'Meta Page discovery');
  return Array.isArray(result.data) ? result.data : [];
}

module.exports = {
  API_VERSION: API_VERSION, AUTH_URL: AUTH_URL, GRAPH_URL: GRAPH_URL, SCOPES: SCOPES,
  validConfig: validConfig, buildAuthUrl: buildAuthUrl, exchangeCode: exchangeCode,
  exchangeLongLived: exchangeLongLived, fetchManagedPages: fetchManagedPages
};
