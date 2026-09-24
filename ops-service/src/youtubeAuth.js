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
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const CHANNELS_LIST_URL = 'https://www.googleapis.com/youtube/v3/channels';
const PLAYLIST_ITEMS_URL = 'https://www.googleapis.com/youtube/v3/playlistItems';

async function youtubeGet(accessToken, url, label) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
  if (!res.ok) throw new Error(label + ' failed (' + res.status + '): ' + (await res.text()));
  return res.json();
}

function competitorChannelFilter(value) {
  let input = String(value || '').trim();
  if (!input) throw new Error('Enter a YouTube @handle or channel URL.');
  if (/^https?:\/\//i.test(input)) {
    let parsed;
    try { parsed = new URL(input); } catch (error) { throw new Error('That is not a valid YouTube channel URL.'); }
    if (!/(^|\.)youtube\.com$/i.test(parsed.hostname)) throw new Error('Enter a youtube.com channel URL.');
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts[0] === 'channel' && /^UC[A-Za-z0-9_-]{20,}$/.test(parts[1] || '')) return { key: 'id', value: parts[1] };
    if (parts[0] && parts[0][0] === '@') input = parts[0];
    else throw new Error('Use the channel’s @handle URL or /channel/UC… URL.');
  }
  if (/^UC[A-Za-z0-9_-]{20,}$/.test(input)) return { key: 'id', value: input };
  const handle = input.replace(/^@/, '').trim();
  if (!/^[A-Za-z0-9._-]{3,100}$/.test(handle)) throw new Error('Enter a valid YouTube @handle.');
  return { key: 'forHandle', value: handle };
}

function isoDurationSeconds(value) {
  const match = String(value || '').match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!match) return null;
  return Math.round((Number(match[1] || 0) * 86400) + (Number(match[2] || 0) * 3600) + (Number(match[3] || 0) * 60) + Number(match[4] || 0));
}

function medianNumber(values) {
  if (!values.length) return 0;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : Math.round((values[middle - 1] + values[middle]) / 2);
}

function markOneInTenOutliers(videos) {
  const sortedViewCounts = videos.map(function (video) { return video.views; }).sort(function (a, b) { return a - b; });
  const medianViews = medianNumber(sortedViewCounts);
  const midpoint = Math.floor(sortedViewCounts.length / 2);
  const q1Views = medianNumber(sortedViewCounts.slice(0, midpoint));
  const q3Views = medianNumber(sortedViewCounts.slice(Math.ceil(sortedViewCounts.length / 2)));
  const outlierThreshold = Math.round(q3Views + (1.5 * Math.max(0, q3Views - q1Views)));
  const topDecileCount = videos.length >= 10 ? Math.max(1, Math.ceil(videos.length / 10)) : 0;
  videos.forEach(function (video) {
    // A real one-in-ten candidate must be in the sample's top decile AND clear
    // the conventional high-outlier fence. This produces zero results when a
    // channel's videos all perform similarly instead of always manufacturing
    // five "outliers" from every 50-video sample.
    video.isOneInTenOutlier = topDecileCount > 0 && video.baselineViewRank <= topDecileCount && video.views > outlierThreshold;
  });
  return {
    medianViews: medianViews,
    outlierThreshold: outlierThreshold,
    outlierCount: videos.filter(function (video) { return video.isOneInTenOutlier; }).length
  };
}

// Public competitor discovery deliberately reuses the app's existing
// youtube.readonly token. No competitor authorization or additional scope is
// needed: every field returned here is already public on YouTube. Requiring a
// handle/channel URL avoids the separate search.list quota bucket entirely.
async function fetchCompetitorChannel(accessToken, input) {
  const filter = competitorChannelFilter(input);
  const channelUrl = new URL(CHANNELS_LIST_URL);
  channelUrl.searchParams.set('part', 'snippet,contentDetails,statistics');
  channelUrl.searchParams.set(filter.key, filter.value);
  const channelData = await youtubeGet(accessToken, channelUrl, 'YouTube competitor channel lookup');
  const channel = (channelData.items || [])[0];
  if (!channel) throw new Error('No YouTube channel matched that handle or URL.');
  const uploadsPlaylistId = channel.contentDetails && channel.contentDetails.relatedPlaylists && channel.contentDetails.relatedPlaylists.uploads;
  if (!uploadsPlaylistId) throw new Error('YouTube did not expose this channel’s uploads playlist.');

  const playlistUrl = new URL(PLAYLIST_ITEMS_URL);
  playlistUrl.searchParams.set('part', 'contentDetails');
  playlistUrl.searchParams.set('playlistId', uploadsPlaylistId);
  // Fifty is YouTube's maximum page size and gives the performance baseline a
  // useful sample without adding another request. The UI still ranks the ten
  // most recent uploads against one another; all fifty feed its averages.
  playlistUrl.searchParams.set('maxResults', '50');
  const playlistData = await youtubeGet(accessToken, playlistUrl, 'YouTube competitor uploads lookup');
  const orderedIds = (playlistData.items || []).map(function (item) {
    return item.contentDetails && item.contentDetails.videoId;
  }).filter(Boolean);

  let videoItems = [];
  if (orderedIds.length) {
    const videosUrl = new URL(VIDEOS_URL);
    videosUrl.searchParams.set('part', 'snippet,statistics,contentDetails');
    videosUrl.searchParams.set('id', orderedIds.join(','));
    const videosData = await youtubeGet(accessToken, videosUrl, 'YouTube competitor video lookup');
    videoItems = videosData.items || [];
  }
  const byId = new Map(videoItems.map(function (item) { return [item.id, item]; }));
  const videos = orderedIds.map(function (id) { return byId.get(id); }).filter(Boolean).slice(0, 50).map(function (item) {
    const thumbs = item.snippet && item.snippet.thumbnails || {};
    const thumb = thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium || thumbs.default || {};
    const stats = item.statistics || {};
    return {
      id: item.id,
      title: item.snippet && item.snippet.title || item.id,
      description: item.snippet && item.snippet.description || '',
      publishedAt: item.snippet && item.snippet.publishedAt || null,
      thumbnailUrl: thumb.url || '',
      durationSeconds: isoDurationSeconds(item.contentDetails && item.contentDetails.duration),
      views: Number(stats.viewCount) || 0,
      likes: stats.likeCount == null ? null : (Number(stats.likeCount) || 0),
      comments: stats.commentCount == null ? null : (Number(stats.commentCount) || 0)
    };
  });
  const baselineRanked = videos.slice().sort(function (a, b) { return b.views - a.views || String(b.publishedAt).localeCompare(String(a.publishedAt)); });
  const baselineRanks = new Map(baselineRanked.map(function (video, index) { return [video.id, index + 1]; }));
  videos.forEach(function (video) { video.baselineViewRank = baselineRanks.get(video.id); });
  const recentVideos = videos.slice(0, 10);
  const recentRanked = recentVideos.slice().sort(function (a, b) { return b.views - a.views || String(b.publishedAt).localeCompare(String(a.publishedAt)); });
  const recentRanks = new Map(recentRanked.map(function (video, index) { return [video.id, index + 1]; }));
  videos.forEach(function (video) { video.recentViewRank = recentRanks.get(video.id) || null; });
  const outlierStats = markOneInTenOutliers(videos);
  // Descriptions are needed only for genuine outlier creative reads. Do not
  // ship/store up to fifty 5,000-character descriptions when the UI never uses
  // the remainder; every refresh can select the current outliers afresh.
  videos.forEach(function (video) {
    if (!video.isOneInTenOutlier) delete video.description;
  });

  const channelThumbs = channel.snippet && channel.snippet.thumbnails || {};
  const channelThumb = channelThumbs.high || channelThumbs.medium || channelThumbs.default || {};
  const subscriberHidden = !!(channel.statistics && channel.statistics.hiddenSubscriberCount);
  return {
    channelId: channel.id,
    input: String(input).trim(),
    handle: filter.key === 'forHandle' ? '@' + filter.value : '',
    title: channel.snippet && channel.snippet.title || channel.id,
    description: channel.snippet && channel.snippet.description || '',
    thumbnailUrl: channelThumb.url || '',
    subscriberCount: subscriberHidden ? null : (Number(channel.statistics && channel.statistics.subscriberCount) || 0),
    subscriberHidden: subscriberHidden,
    totalVideoCount: Number(channel.statistics && channel.statistics.videoCount) || 0,
    uploadsPlaylistId: uploadsPlaylistId,
    videos: videos,
    averageViews: videos.length ? Math.round(videos.reduce(function (sum, video) { return sum + video.views; }, 0) / videos.length) : 0,
    medianViews: outlierStats.medianViews,
    outlierThreshold: outlierStats.outlierThreshold,
    outlierCount: outlierStats.outlierCount,
    baselineVideoCount: videos.length,
    recentVideoCount: recentVideos.length,
    sampleVersion: 4,
    fetchedAt: new Date().toISOString()
  };
}

async function fetchVideoStatistics(accessToken, videoIds) {
  const ids = Array.from(new Set((videoIds || []).map(String).filter(Boolean)));
  const results = [];
  for (let i = 0; i < ids.length; i += 50) {
    const url = new URL(VIDEOS_URL);
    url.searchParams.set('part', 'snippet,statistics');
    url.searchParams.set('id', ids.slice(i, i + 50).join(','));
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!res.ok) throw new Error('YouTube video statistics lookup failed (' + res.status + '): ' + (await res.text()));
    const data = await res.json();
    (data.items || []).forEach(function (item) {
      const stats = item.statistics || {};
      results.push({
        id: item.id,
        title: item.snippet && item.snippet.title || item.id,
        publishedAt: item.snippet && item.snippet.publishedAt || null,
        views: Number(stats.viewCount) || 0,
        likes: Number(stats.likeCount) || 0,
        comments: Number(stats.commentCount) || 0
      });
    });
  }
  return results;
}

// Used by the daily Posted / Live audit. An authenticated videos.list call
// returns the connected channel's private/unlisted items as well as public
// ones; an id omitted from a successful response is no longer available to
// this channel (normally deleted). Keep this separate from statistics so the
// audit's public/private decision never depends on engagement fields.
async function fetchVideoStatuses(accessToken, videoIds) {
  const ids = Array.from(new Set((videoIds || []).map(String).filter(Boolean)));
  const results = [];
  for (let i = 0; i < ids.length; i += 50) {
    const url = new URL(VIDEOS_URL);
    url.searchParams.set('part', 'status');
    url.searchParams.set('id', ids.slice(i, i + 50).join(','));
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!res.ok) throw new Error('YouTube video status lookup failed (' + res.status + '): ' + (await res.text()));
    const data = await res.json();
    (data.items || []).forEach(function (item) {
      results.push({
        id: item.id,
        privacyStatus: item.status && item.status.privacyStatus || null,
        uploadStatus: item.status && item.status.uploadStatus || null
      });
    });
  }
  return results;
}

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

module.exports = { SCOPES, isConfigured, buildAuthUrl, exchangeCode, refreshAccessToken, fetchChannelInfo, fetchVideoStatistics, fetchVideoStatuses, fetchCompetitorChannel, competitorChannelFilter, markOneInTenOutliers, uploadVideo };
