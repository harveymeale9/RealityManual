// TikTok OAuth (Login Kit) + Content Posting API — plain REST calls
// (Node 22's built-in fetch), same "no SDK dependency" philosophy as
// youtubeAuth.js. Tokens are only ever handled server-side (see
// server.js's tiktok_oauth table) — the browser only ever learns
// connection status via GET /api/tiktok/status, never the actual
// access/refresh token.
//
// Scopes requested are the strict minimum for what this app actually
// does: user.info.basic to show "Connected as @handle" in Settings,
// video.publish to post an approved video to the connected account.
//
// Endpoint/format details below were confirmed directly against
// TikTok's current developer docs before writing this (auth flow, token
// exchange, user info, creator info, direct-post init/upload/status,
// chunking rules) — re-check developers.tiktok.com before changing any
// of this if TikTok's API shape has moved on.
'use strict';

const fs = require('fs');

const AUTH_BASE = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';
const CREATOR_INFO_URL = 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/';
const PUBLISH_INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/';
const PUBLISH_STATUS_URL = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';

const SCOPES = ['user.info.basic', 'video.publish'];

function isConfigured() {
  return !!(
    process.env.TIKTOK_CLIENT_KEY &&
    process.env.TIKTOK_CLIENT_SECRET &&
    process.env.TIKTOK_REDIRECT_URI
  );
}

// No PKCE for the web flow (code_verifier is mobile/desktop-only per
// TikTok's own docs) — just client_key/scope/redirect_uri/state, same
// shape as any standard OAuth authorization-code request.
function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY,
    scope: SCOPES.join(','),
    response_type: 'code',
    redirect_uri: process.env.TIKTOK_REDIRECT_URI,
    state: state
  });
  return AUTH_BASE + '?' + params.toString();
}

function isErrorResponse(data) {
  return !!(data && data.error && data.error.code && data.error.code !== 'ok');
}

async function exchangeCode(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: process.env.TIKTOK_REDIRECT_URI
    })
  });
  const data = await res.json();
  if (!res.ok || isErrorResponse(data)) throw new Error('TikTok token exchange failed: ' + JSON.stringify(data).slice(0, 300));
  return data; // { access_token, refresh_token, expires_in, refresh_expires_in, open_id, scope, token_type }
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });
  const data = await res.json();
  if (!res.ok || isErrorResponse(data)) throw new Error('TikTok token refresh failed: ' + JSON.stringify(data).slice(0, 300));
  return data; // TikTok may issue a new refresh_token here — caller must persist whatever comes back
}

async function fetchUserInfo(accessToken) {
  const res = await fetch(USER_INFO_URL + '?fields=open_id,display_name', {
    headers: { Authorization: 'Bearer ' + accessToken }
  });
  const data = await res.json();
  if (!res.ok || isErrorResponse(data)) throw new Error('TikTok user info lookup failed: ' + JSON.stringify(data).slice(0, 300));
  const user = data.data && data.data.user;
  if (!user) return null;
  return { openId: user.open_id, displayName: user.display_name || user.open_id };
}

// Required before showing/using posting options, per TikTok's Content
// Sharing Guidelines ("display the account's available privacy level
// options" before posting) — also the only way to know which
// privacy_level values this specific account is actually allowed to use
// (an unaudited/sandbox app is restricted to SELF_ONLY regardless of
// what's requested).
async function queryCreatorInfo(accessToken) {
  const res = await fetch(CREATOR_INFO_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json; charset=UTF-8' }
  });
  const data = await res.json();
  if (!res.ok || isErrorResponse(data)) throw new Error('TikTok creator info query failed: ' + JSON.stringify(data).slice(0, 300));
  return data.data; // { creator_username, creator_nickname, privacy_level_options, max_video_post_duration_sec, ... }
}

async function initPublish(accessToken, opts) {
  const res = await fetch(PUBLISH_INIT_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      post_info: {
        title: (opts.title || 'Untitled').slice(0, 2200),
        privacy_level: opts.privacyLevel,
        // Branded Content disclosure toggle, per TikTok's Content Sharing
        // Guidelines (2026-09-20) — sourced from a checkbox on the Final
        // Check card, not guessed. Note for later: TikTok's own docs say a
        // branded-content post cannot use SELF_ONLY privacy, which is what
        // this app is forced to while unaudited (§143) — not handled here
        // since Harvey's real content is never actually branded content,
        // but worth knowing if that combination ever gets hit and TikTok
        // rejects it.
        brand_content_toggle: !!opts.brandedContent
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: opts.videoSize,
        chunk_size: opts.chunkSize,
        total_chunk_count: opts.totalChunkCount
      }
    })
  });
  const data = await res.json();
  if (!res.ok || isErrorResponse(data)) throw new Error('TikTok publish init failed: ' + JSON.stringify(data).slice(0, 300));
  return { publishId: data.data.publish_id, uploadUrl: data.data.upload_url };
}

// Chunking per TikTok's Media Transfer Guide: each chunk must be
// 5MB-64MB except the final one (which absorbs the remainder, up to
// 128MB), 1-1000 chunks total. A video that already fits in one 64MB
// chunk just goes out as a single PUT.
const MIN_CHUNK_BYTES = 5 * 1024 * 1024;
const MAX_CHUNK_BYTES = 64 * 1024 * 1024;

function computeChunkPlan(videoSize) {
  if (videoSize <= MAX_CHUNK_BYTES) return { chunkSize: videoSize, totalChunkCount: 1 };
  const chunkSize = MAX_CHUNK_BYTES;
  const totalChunkCount = Math.floor(videoSize / chunkSize);
  return { chunkSize: chunkSize, totalChunkCount: totalChunkCount };
}

async function uploadVideoChunks(uploadUrl, filePath, videoSize, mimeType, chunkSize, totalChunkCount) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    for (let i = 0; i < totalChunkCount; i++) {
      const start = i * chunkSize;
      const isLast = i === totalChunkCount - 1;
      const end = isLast ? videoSize - 1 : start + chunkSize - 1;
      const length = end - start + 1;
      const buf = Buffer.alloc(length);
      await fh.read(buf, 0, length, start);
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': mimeType || 'video/mp4',
          'Content-Length': String(length),
          'Content-Range': 'bytes ' + start + '-' + end + '/' + videoSize
        },
        body: buf
      });
      if (!res.ok) throw new Error('TikTok chunk upload failed (' + res.status + '): ' + (await res.text()).slice(0, 300));
    }
  } finally {
    await fh.close();
  }
}

async function checkPublishStatus(accessToken, publishId) {
  const res = await fetch(PUBLISH_STATUS_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ publish_id: publishId })
  });
  const data = await res.json();
  if (!res.ok || isErrorResponse(data)) throw new Error('TikTok status check failed: ' + JSON.stringify(data).slice(0, 300));
  return data.data; // { status, fail_reason, publicaly_available_post_id, uploaded_bytes }
}

// High-level orchestration mirroring youtubeAuth.uploadVideo's single-
// call shape for server.js to consume: query creator info (also doubles
// as the pre-post privacy-level check), init a FILE_UPLOAD publish,
// upload the file in chunks, then poll status until it reaches a
// terminal state (TikTok processes the upload asynchronously after the
// last chunk lands, so a real result isn't available immediately).
async function publishVideo(accessToken, filePath, mimeType, metadata) {
  const stat = fs.statSync(filePath);
  const creatorInfo = await queryCreatorInfo(accessToken);
  const allowedLevels = (creatorInfo && creatorInfo.privacy_level_options) || ['SELF_ONLY'];
  // Sandbox/unaudited apps are forced to SELF_ONLY regardless of what's
  // requested — ask for it explicitly (safest, and matches what YouTube's
  // side defaults to as well) rather than whatever might otherwise be
  // requested, falling back to whatever this account's own options allow
  // if SELF_ONLY somehow isn't offered.
  const privacyLevel = allowedLevels.indexOf('SELF_ONLY') !== -1 ? 'SELF_ONLY' : allowedLevels[0];

  const plan = computeChunkPlan(stat.size);
  const init = await initPublish(accessToken, {
    title: metadata.title,
    privacyLevel: privacyLevel,
    videoSize: stat.size,
    chunkSize: plan.chunkSize,
    totalChunkCount: plan.totalChunkCount,
    brandedContent: !!metadata.brandedContent
  });

  await uploadVideoChunks(init.uploadUrl, filePath, stat.size, mimeType, plan.chunkSize, plan.totalChunkCount);

  // 2s interval, up to ~2 minutes — long enough for TikTok's own
  // processing in normal cases, without hanging the background job
  // forever if something gets stuck.
  let last = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(function (resolve) { setTimeout(resolve, 2000); });
    last = await checkPublishStatus(accessToken, init.publishId);
    if (last.status === 'PUBLISH_COMPLETE' || last.status === 'FAILED') break;
  }
  if (!last || last.status === 'FAILED') {
    throw new Error('TikTok publish failed: ' + ((last && last.fail_reason) || 'unknown reason'));
  }
  if (last.status !== 'PUBLISH_COMPLETE') {
    throw new Error('TikTok publish did not finish processing in time (last status: ' + last.status + ')');
  }
  return { publishId: init.publishId, privacyLevel: privacyLevel };
}

module.exports = {
  SCOPES, isConfigured, buildAuthUrl, exchangeCode, refreshAccessToken,
  fetchUserInfo, queryCreatorInfo, publishVideo
};
