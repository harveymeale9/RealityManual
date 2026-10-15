'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const API_VERSION = 'v26.0';
const GRAPH_URL = 'https://graph.facebook.com/' + API_VERSION;
const GRAPH_VIDEO_URL = 'https://graph-video.facebook.com/' + API_VERSION;

function clean(value, max) { return String(value == null ? '' : value).trim().slice(0, max || 1000); }

function setup(options) {
  options = options || {};
  const fetchImpl = options.fetchImpl || fetch;
  const sleep = options.sleep || function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
  const openAsBlob = options.openAsBlob || fs.openAsBlob;
  const mediaBaseUrl = clean(options.mediaBaseUrl || 'https://ops.realitymanual.com', 500).replace(/\/$/, '');

  async function jsonResponse(response, label) {
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok || payload.error) {
      const detail = payload.error && (payload.error.error_user_msg || payload.error.message);
      throw new Error(label + ': ' + clean(detail || ('HTTP ' + response.status), 500));
    }
    return payload;
  }

  function signMedia(pieceId, expires, secret) {
    return crypto.createHmac('sha256', clean(secret, 1000)).update(clean(pieceId, 128) + '\n' + String(expires)).digest('hex');
  }

  function mediaUrl(pieceId, secret, lifetimeMs) {
    if (!clean(secret, 1000)) throw new Error('Meta App Secret is not configured.');
    const expires = Date.now() + (Number(lifetimeMs) || 60 * 60 * 1000);
    return mediaBaseUrl + '/api/meta/media/' + encodeURIComponent(pieceId) + '?expires=' + expires + '&sig=' + signMedia(pieceId, expires, secret);
  }

  function verifyMediaSignature(pieceId, expires, signature, secret) {
    const expiresNumber = Number(expires);
    if (!clean(secret, 1000) || !Number.isFinite(expiresNumber) || expiresNumber < Date.now() || expiresNumber > Date.now() + 24 * 60 * 60 * 1000) return false;
    const expected = Buffer.from(signMedia(pieceId, expiresNumber, secret), 'hex');
    let actual;
    try { actual = Buffer.from(String(signature || ''), 'hex'); } catch (error) { return false; }
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }

  async function publishFacebookVideo(input) {
    const videoUrl = clean(input.videoUrl, 2000);
    let body;
    let headers;
    if (videoUrl) {
      body = new URLSearchParams({
        access_token: clean(input.pageToken, 2000),
        title: clean(input.title, 255),
        description: clean(input.description, 60000),
        file_url: videoUrl
      });
      headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    } else {
      const video = await openAsBlob(input.videoPath, { type: clean(input.mimeType, 100) || 'video/mp4' });
      body = new FormData();
      body.set('access_token', clean(input.pageToken, 2000));
      body.set('title', clean(input.title, 255));
      body.set('description', clean(input.description, 60000));
      body.set('source', video, path.basename(input.videoPath) + '.mp4');
    }
    const response = await fetchImpl(GRAPH_VIDEO_URL + '/' + encodeURIComponent(clean(input.pageId, 100)) + '/videos', {
      method: 'POST', headers: headers, body: body
    });
    const payload = await jsonResponse(response, 'Facebook video publish failed');
    if (!payload.id) throw new Error('Facebook video publish failed: no video id returned.');
    return { id: clean(payload.id, 100), url: 'https://www.facebook.com/watch/?v=' + encodeURIComponent(clean(payload.id, 100)) };
  }

  // Meta's file_url path can time out while fetching multi-gigabyte long-form
  // masters. Its page-video upload session accepts small sequential chunks,
  // so no single request waits for the entire file to cross the network.
  async function publishFacebookVideoResumable(input) {
    const filePath = input.videoPath;
    const fileSize = fs.statSync(filePath).size;
    const endpoint = GRAPH_VIDEO_URL + '/' + encodeURIComponent(clean(input.pageId, 100)) + '/videos';
    async function phase(fields, chunk) {
      const body = new FormData();
      Object.keys(fields).forEach(function (key) { body.set(key, String(fields[key])); });
      body.set('access_token', clean(input.pageToken, 2000));
      if (chunk) body.set('video_file_chunk', new Blob([chunk], { type: 'application/octet-stream' }), 'chunk.mp4');
      const response = await fetchImpl(endpoint, { method: 'POST', body: body });
      return jsonResponse(response, 'Facebook video ' + fields.upload_phase + ' failed');
    }

    const started = await phase({ upload_phase: 'start', file_size: fileSize });
    const sessionId = clean(started.upload_session_id, 100);
    const videoId = clean(started.video_id, 100);
    if (!sessionId || !videoId) throw new Error('Facebook did not return a video upload session.');
    let start = Number(started.start_offset);
    let end = Number(started.end_offset);
    const file = await fs.promises.open(filePath, 'r');
    try {
      while (start < fileSize) {
        const length = Math.min(end - start, fileSize - start);
        if (!Number.isSafeInteger(length) || length <= 0 || length > 100 * 1024 * 1024) {
          throw new Error('Facebook returned an invalid video chunk range.');
        }
        const chunk = Buffer.allocUnsafe(length);
        const read = await file.read(chunk, 0, length, start);
        if (read.bytesRead !== length) throw new Error('Could not read the complete Facebook video chunk.');
        let transferred;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            transferred = await phase({ upload_phase: 'transfer', upload_session_id: sessionId, start_offset: start }, chunk);
            break;
          } catch (error) {
            if (attempt === 2) throw error;
            await sleep(2000 * (attempt + 1));
          }
        }
        const nextStart = Number(transferred.start_offset);
        const nextEnd = Number(transferred.end_offset);
        if (!Number.isSafeInteger(nextStart) || nextStart <= start || !Number.isSafeInteger(nextEnd)) {
          throw new Error('Facebook video transfer did not advance.');
        }
        start = nextStart;
        end = nextEnd;
      }
    } finally { await file.close(); }
    const finished = await phase({
      upload_phase: 'finish', upload_session_id: sessionId,
      title: clean(input.title, 255), description: clean(input.description, 60000)
    });
    if (finished.success !== true) throw new Error('Facebook did not confirm the finished video upload.');
    return { id: videoId, url: 'https://www.facebook.com/watch/?v=' + encodeURIComponent(videoId) };
  }

  async function graphPost(pathname, fields, label) {
    const response = await fetchImpl(GRAPH_URL + pathname, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields)
    });
    return jsonResponse(response, label);
  }

  async function graphGet(pathname, fields, label) {
    const params = new URLSearchParams(fields);
    const response = await fetchImpl(GRAPH_URL + pathname + '?' + params.toString());
    return jsonResponse(response, label);
  }

  async function publishInstagramReel(input) {
    const accountId = encodeURIComponent(clean(input.instagramAccountId, 100));
    const token = clean(input.pageToken, 2000);
    const created = await graphPost('/' + accountId + '/media', {
      media_type: 'REELS', video_url: clean(input.videoUrl, 2000),
      caption: clean(input.caption, 2200), share_to_feed: 'true', access_token: token
    }, 'Instagram Reel container creation failed');
    if (!created.id) throw new Error('Instagram Reel container creation failed: no container id returned.');

    const maxPolls = Math.max(1, Number(input.maxPolls) || 60);
    let ready = false;
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      const status = await graphGet('/' + encodeURIComponent(clean(created.id, 100)), {
        fields: 'status_code,status', access_token: token
      }, 'Instagram Reel processing check failed');
      if (status.status_code === 'FINISHED') { ready = true; break; }
      if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
        throw new Error('Instagram Reel processing failed: ' + clean(status.status || status.status_code, 500));
      }
      await sleep(Number(input.pollMs) || 5000);
    }
    if (!ready) throw new Error('Instagram Reel processing timed out before Meta marked it ready.');

    const published = await graphPost('/' + accountId + '/media_publish', {
      creation_id: clean(created.id, 100), access_token: token
    }, 'Instagram Reel publish failed');
    if (!published.id) throw new Error('Instagram Reel publish failed: no media id returned.');
    let details = {};
    try {
      details = await graphGet('/' + encodeURIComponent(clean(published.id, 100)), {
        fields: 'id,permalink', access_token: token
      }, 'Instagram Reel permalink lookup failed');
    } catch (error) { /* publishing succeeded; a missing permalink is non-fatal */ }
    return { id: clean(published.id, 100), url: clean(details.permalink, 1000) || null, containerId: clean(created.id, 100) };
  }

  function insightValue(rows, name) {
    const row = (rows || []).find(function (item) { return item && item.name === name; });
    if (!row) return null;
    if (row.total_value && row.total_value.value != null) return row.total_value.value;
    return row.values && row.values[0] ? row.values[0].value : null;
  }

  function sumValues(value) {
    if (value == null) return 0;
    if (typeof value === 'number') return value;
    if (typeof value !== 'object') return Number(value) || 0;
    return Object.keys(value).reduce(function (sum, key) { return sum + sumValues(value[key]); }, 0);
  }

  function namedValue(value, names) {
    if (!value || typeof value !== 'object') return 0;
    const wanted = names.map(function (name) { return name.toLowerCase(); });
    const key = Object.keys(value).find(function (candidate) { return wanted.indexOf(candidate.toLowerCase()) !== -1; });
    return key ? Number(value[key]) || 0 : 0;
  }

  async function fetchFacebookVideoMetrics(input) {
    const id = encodeURIComponent(clean(input.videoId, 100));
    const token = clean(input.pageToken, 2000);
    const responses = await Promise.all([
      graphGet('/' + id + '/video_insights', { access_token: token }, 'Facebook Reel insights lookup failed'),
      graphGet('/' + id, { fields: 'likes.summary(true),comments.summary(true)', access_token: token }, 'Facebook Reel engagement lookup failed')
    ]);
    const rows = responses[0].data || [];
    const details = responses[1] || {};
    const social = insightValue(rows, 'post_video_social_actions') || {};
    const reactions = insightValue(rows, 'post_video_likes_by_reaction_type') || {};
    const views = insightValue(rows, 'fb_reels_total_plays');
    const initialPlays = insightValue(rows, 'blue_reels_play_count');
    return {
      views: views == null ? initialPlays : views,
      likes: details.likes && details.likes.summary ? Number(details.likes.summary.total_count) || sumValues(reactions) : sumValues(reactions),
      comments: details.comments && details.comments.summary ? Number(details.comments.summary.total_count) || 0 : namedValue(social, ['comments', 'comment']),
      shares: namedValue(social, ['shares', 'share']),
      watchTimeSeconds: Number(insightValue(rows, 'post_video_view_time')) / 1000 || 0,
      averageWatchSeconds: Number(insightValue(rows, 'post_video_avg_time_watched')) / 1000 || 0
    };
  }

  async function fetchInstagramMediaMetrics(input) {
    const id = encodeURIComponent(clean(input.mediaId, 100));
    const token = clean(input.pageToken, 2000);
    const details = await graphGet('/' + id, {
      fields: 'id,permalink,like_count,comments_count', access_token: token
    }, 'Instagram Reel engagement lookup failed');
    let insightRows = [];
    let insightsAvailable = true;
    let insightsError = '';
    try {
      const insights = await graphGet('/' + id + '/insights', {
        metric: 'views,reach,saved,shares,total_interactions', metric_type: 'total_value', access_token: token
      }, 'Instagram Reel insights lookup failed');
      insightRows = insights.data || [];
    } catch (error) {
      insightsAvailable = false;
      insightsError = clean(error.message, 300);
    }
    return {
      views: insightValue(insightRows, 'views'), reach: insightValue(insightRows, 'reach'),
      likes: Number(details.like_count) || 0, comments: Number(details.comments_count) || 0,
      shares: insightValue(insightRows, 'shares'), saves: insightValue(insightRows, 'saved'),
      insightsAvailable: insightsAvailable, insightsError: insightsError
    };
  }

  async function fetchAudienceMetrics(input) {
    const token = clean(input.pageToken, 2000);
    const results = {};
    if (input.pageId) {
      const page = await graphGet('/' + encodeURIComponent(clean(input.pageId, 100)), {
        fields: 'followers_count,fan_count', access_token: token
      }, 'Facebook audience lookup failed');
      results.facebook = { followers: Number(page.followers_count) || Number(page.fan_count) || 0 };
    }
    if (input.instagramAccountId) {
      const instagram = await graphGet('/' + encodeURIComponent(clean(input.instagramAccountId, 100)), {
        fields: 'followers_count,media_count', access_token: token
      }, 'Instagram audience lookup failed');
      results.instagram = { followers: Number(instagram.followers_count) || 0, mediaCount: Number(instagram.media_count) || 0 };
    }
    return results;
  }

  return {
    mediaUrl: mediaUrl,
    verifyMediaSignature: verifyMediaSignature,
    publishFacebookVideo: publishFacebookVideo,
    publishFacebookVideoResumable: publishFacebookVideoResumable,
    publishInstagramReel: publishInstagramReel,
    fetchFacebookVideoMetrics: fetchFacebookVideoMetrics,
    fetchInstagramMediaMetrics: fetchInstagramMediaMetrics,
    fetchAudienceMetrics: fetchAudienceMetrics
  };
}

module.exports = { setup: setup, API_VERSION: API_VERSION, GRAPH_URL: GRAPH_URL, GRAPH_VIDEO_URL: GRAPH_VIDEO_URL };
