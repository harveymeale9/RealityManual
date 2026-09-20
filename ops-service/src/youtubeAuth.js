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

const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

// Real publish, using YouTube's resumable-upload protocol directly (no
// googleapis SDK — same "plain REST calls" philosophy as the rest of this
// file). Two requests: (1) POST the metadata to open an upload session and
// get back a one-time `Location` URL, (2) PUT the actual video bytes,
// streamed straight off disk rather than buffered into memory, since a
// longform upload can be a real amount of data — Node's fetch supports a
// streaming request body as long as `duplex: 'half'` is set.
async function uploadVideo(accessToken, filePath, mimeType, metadata) {
  const fs = require('fs');
  const stat = fs.statSync(filePath);
  const privacyStatus = ['private', 'unlisted', 'public'].indexOf(metadata.privacyStatus) !== -1
    ? metadata.privacyStatus : 'private';

  const initRes = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType || 'video/mp4',
      'X-Upload-Content-Length': String(stat.size)
    },
    body: JSON.stringify({
      snippet: {
        title: (metadata.title || 'Untitled').slice(0, 100),
        description: (metadata.description || '').slice(0, 5000)
      },
      status: { privacyStatus: privacyStatus }
    })
  });
  if (!initRes.ok) throw new Error('YouTube upload session could not be created (' + initRes.status + '): ' + (await initRes.text()));
  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) throw new Error('YouTube did not return a resumable upload URL');

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType || 'video/mp4',
      'Content-Length': String(stat.size)
    },
    body: fs.createReadStream(filePath),
    duplex: 'half'
  });
  if (!putRes.ok) throw new Error('YouTube upload failed (' + putRes.status + '): ' + (await putRes.text()));
  const data = await putRes.json();
  if (!data.id) throw new Error('YouTube upload response had no video id: ' + JSON.stringify(data).slice(0, 300));
  return { videoId: data.id };
}

module.exports = { SCOPES, isConfigured, buildAuthUrl, exchangeCode, refreshAccessToken, fetchChannelInfo, uploadVideo };
