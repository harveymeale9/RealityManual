'use strict';

const MANIFEST_KEY = 'facebook-repost/2026-11-17/manifest.json';
const RETAINED_VIDEO_ID = '2076843426329537';

function bangkokSlot(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).filter(function (part) { return part.type !== 'literal'; })
    .map(function (part) { return [part.type, part.value]; }));
  if (!['Wed', 'Fri', 'Sun'].includes(parts.weekday) || Number(parts.hour) !== 22) return '';
  return parts.year + '-' + parts.month + '-' + parts.day;
}

function eligibleJob(jobs, publishedIds) {
  return jobs.find(function (job) {
    return job.status === 'pending' && !publishedIds.has(job.old_video_id);
  }) || null;
}

module.exports = { MANIFEST_KEY, RETAINED_VIDEO_ID, bangkokSlot, eligibleJob };
