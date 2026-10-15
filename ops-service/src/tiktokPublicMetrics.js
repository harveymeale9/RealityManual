'use strict';

const VIDEO_URL = /^https:\/\/(?:www\.)?tiktok\.com\/@[^/]+\/video\/(\d+)(?:[/?#]|$)/i;
const REHYDRATION_SCRIPT = /<script[^>]+id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i;

function nonNegative(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function videoIdFromUrl(value) {
  const match = String(value || '').trim().match(VIDEO_URL);
  return match ? match[1] : '';
}

function parsePublicMetrics(html, expectedVideoId) {
  const match = String(html || '').match(REHYDRATION_SCRIPT);
  if (!match) return null;
  let payload;
  try { payload = JSON.parse(match[1]); } catch (error) { return null; }
  const detail = payload && payload.__DEFAULT_SCOPE__ && payload.__DEFAULT_SCOPE__['webapp.video-detail'];
  const item = detail && detail.itemInfo && detail.itemInfo.itemStruct;
  if (!item || !item.stats || (expectedVideoId && String(item.id) !== String(expectedVideoId))) return null;
  return {
    views: nonNegative(item.stats.playCount),
    likes: nonNegative(item.stats.diggCount),
    comments: nonNegative(item.stats.commentCount),
    shares: nonNegative(item.stats.shareCount),
    saves: nonNegative(item.stats.collectCount)
  };
}

async function fetchPublicMetrics(url, fetchImpl) {
  const videoId = videoIdFromUrl(url);
  if (!videoId) return null;
  fetchImpl = fetchImpl || fetch;
  const response = await fetchImpl(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined
  });
  if (!response.ok) return null;
  return parsePublicMetrics(await response.text(), videoId);
}

function freshestCount(primary, fallback) {
  const first = nonNegative(primary);
  const second = nonNegative(fallback);
  if (first == null) return second;
  if (second == null) return first;
  return Math.max(first, second);
}

function bufferMetric(metrics, names) {
  for (const name of names) {
    if (metrics && metrics[name] && metrics[name].value != null) return nonNegative(metrics[name].value);
  }
  return null;
}

function mergeMetrics(bufferMetrics, publicMetrics) {
  const totalTimeWatched = bufferMetric(bufferMetrics, ['totalTimeWatched']);
  return {
    views: freshestCount(bufferMetric(bufferMetrics, ['views']), publicMetrics && publicMetrics.views),
    likes: freshestCount(bufferMetric(bufferMetrics, ['reactions', 'likes']), publicMetrics && publicMetrics.likes),
    comments: freshestCount(bufferMetric(bufferMetrics, ['comments']), publicMetrics && publicMetrics.comments),
    shares: freshestCount(bufferMetric(bufferMetrics, ['shares', 'reposts']), publicMetrics && publicMetrics.shares),
    saves: freshestCount(bufferMetric(bufferMetrics, ['saves']), publicMetrics && publicMetrics.saves),
    reach: bufferMetric(bufferMetrics, ['reach']),
    watchTimeSeconds: totalTimeWatched == null ? null : totalTimeWatched * 60,
    averageWatchSeconds: bufferMetric(bufferMetrics, ['averageTimeWatched'])
  };
}

module.exports = {
  videoIdFromUrl: videoIdFromUrl,
  parsePublicMetrics: parsePublicMetrics,
  fetchPublicMetrics: fetchPublicMetrics,
  freshestCount: freshestCount,
  mergeMetrics: mergeMetrics
};
