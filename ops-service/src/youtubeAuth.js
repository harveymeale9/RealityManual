// Google OAuth for the YouTube Data API — plain REST calls (Node 22's
// built-in fetch), deliberately no googleapis SDK dependency (this
// project avoids unnecessary dependencies, CLAUDE.md section 6, and
// everything needed here is two small token/identity calls). Tokens are
// only ever handled server-side (see server.js's youtube_oauth table) —
// the browser only ever learns connection status via GET
// /api/youtube/status, never the actual access/refresh token.
//
// Scopes requested are the strict minimum for what this app actually
// does, per Google's "least privilege" OAuth verification guidance:
// youtube.upload to publish videos on the connected channel's behalf,
// youtube.readonly to look up that channel's own name so Settings can
// show "Connected as <channel>" — nothing broader.
'use strict';

const AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly'
];

function isConfigured() {
  return !!(
    process.env.YOUTUBE_OAUTH_CLIENT_ID &&
    process.env.YOUTUBE_OAUTH_CLIENT_SECRET &&
    process.env.YOUTUBE_OAUTH_REDIRECT_URI
  );
}

// access_type=offline + prompt=consent guarantee a fresh refresh_token on
// every connect, including a reconnect after a previous disconnect —
// simpler than trying to detect "is this the first-ever consent."
function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.YOUTUBE_OAUTH_CLIENT_ID,
    redirect_uri: process.env.YOUTUBE_OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: state
  });
  return AUTH_BASE + '?' + params.toString();
}

async function exchangeCode(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: code,
      client_id: process.env.YOUTUBE_OAUTH_CLIENT_ID,
      client_secret: process.env.YOUTUBE_OAUTH_CLIENT_SECRET,
      redirect_uri: process.env.YOUTUBE_OAUTH_REDIRECT_URI,
      grant_type: 'authorization_code'
    })
  });
  if (!res.ok) throw new Error('Google token exchange failed (' + res.status + '): ' + (await res.text()));
  return res.json(); // { access_token, refresh_token, expires_in, ... }
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.YOUTUBE_OAUTH_CLIENT_ID,
      client_secret: process.env.YOUTUBE_OAUTH_CLIENT_SECRET,
      grant_type: 'refresh_token'
    })
  });
  if (!res.ok) throw new Error('Google token refresh failed (' + res.status + '): ' + (await res.text()));
  return res.json(); // { access_token, expires_in, ... } — no new refresh_token normally
}

async function fetchChannelInfo(accessToken) {
  const res = await fetch(CHANNELS_URL, { headers: { Authorization: 'Bearer ' + accessToken } });
  if (!res.ok) throw new Error('YouTube channel lookup failed (' + res.status + '): ' + (await res.text()));
  const data = await res.json();
  const item = (data.items || [])[0];
  if (!item) return null;
  return { channelId: item.id, channelTitle: (item.snippet && item.snippet.title) || item.id };
}

module.exports = { SCOPES, isConfigured, buildAuthUrl, exchangeCode, refreshAccessToken, fetchChannelInfo };
