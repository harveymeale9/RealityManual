'use strict';

const API_VERSION = 'v26.0';
const AUTH_URL = 'https://www.facebook.com/' + API_VERSION + '/dialog/oauth';
const GRAPH_URL = 'https://graph.facebook.com/' + API_VERSION;
const SCOPES = [
  'business_management',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'read_insights',
  'instagram_basic',
  'instagram_content_publish'
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
  const pageParams = new URLSearchParams({
    fields: 'id,name,access_token,instagram_business_account{id,username}',
    access_token: clean(accessToken, 2000)
  });
  const result = await graphJson(fetchImpl, GRAPH_URL + '/me/accounts?' + pageParams.toString(), {}, 'Meta Page discovery');
  const pages = Array.isArray(result.data) ? result.data.slice() : [];

  // Facebook authentication always represents a real person. Portfolio-owned
  // Pages are a separate edge and are not guaranteed to appear in
  // /me/accounts, even when that person has full business access.
  try {
    const businessParams = new URLSearchParams({ fields: 'id,name', access_token: clean(accessToken, 2000) });
    const businesses = await graphJson(fetchImpl, GRAPH_URL + '/me/businesses?' + businessParams.toString(), {}, 'Meta business discovery');
    for (const business of (Array.isArray(businesses.data) ? businesses.data : [])) {
      const owned = await graphJson(
        fetchImpl,
        GRAPH_URL + '/' + encodeURIComponent(clean(business.id, 100)) + '/owned_pages?' + pageParams.toString(),
        {},
        'Meta portfolio Page discovery'
      );
      for (const page of (Array.isArray(owned.data) ? owned.data : [])) {
        page.business_name = clean(business.name, 300);
        if (!pages.some(function (existing) { return clean(existing.id, 100) === clean(page.id, 100); })) pages.push(page);
      }
    }
  } catch (error) {
    // An existing pre-business_management grant can still manage directly
    // assigned Pages. Reauthorization adds portfolio discovery without making
    // the already-valid direct Page list disappear in the meantime.
  }
  return pages;
}

function publicManagedPages(pages) {
  return (Array.isArray(pages) ? pages : []).map(function (page) {
    const instagram = page && page.instagram_business_account;
    return {
      id: clean(page && page.id, 100),
      name: clean(page && page.name, 300),
      business: clean(page && page.business_name, 300) || null,
      instagram: instagram ? { id: clean(instagram.id, 100), username: clean(instagram.username, 300) } : null
    };
  }).filter(function (page) { return page.id; });
}

function selectManagedPage(pages, pageId) {
  pageId = clean(pageId, 100);
  return (Array.isArray(pages) ? pages : []).find(function (page) {
    return clean(page && page.id, 100) === pageId;
  }) || null;
}

module.exports = {
  API_VERSION: API_VERSION, AUTH_URL: AUTH_URL, GRAPH_URL: GRAPH_URL, SCOPES: SCOPES,
  validConfig: validConfig, buildAuthUrl: buildAuthUrl, exchangeCode: exchangeCode,
  exchangeLongLived: exchangeLongLived, fetchManagedPages: fetchManagedPages,
  publicManagedPages: publicManagedPages, selectManagedPage: selectManagedPage
};
