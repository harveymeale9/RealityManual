'use strict';

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DEFAULT_SLOTS = ['00:00', '12:00'];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function normalizeTime(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

function scheduleMap(postingSchedule) {
  const map = {};
  (Array.isArray(postingSchedule) ? postingSchedule : []).forEach(function (day) {
    const key = String(day && day.day || '').toLowerCase().slice(0, 3);
    if (DAY_NAMES.indexOf(key) === -1 || (day && day.paused)) return;
    const times = (Array.isArray(day.times) ? day.times : []).map(normalizeTime).filter(Boolean).sort();
    if (times.length) map[key] = Array.from(new Set(times));
  });
  return map;
}

function fallbackSchedule() {
  const map = {};
  DAY_NAMES.forEach(function (day) { map[day] = DEFAULT_SLOTS.slice(); });
  return map;
}

// Buffer's connected Reality Manual channel and Content Studio both operate in
// Asia/Bangkok (UTC+7, with no daylight-saving changes). Treat the local wall
// clock as UTC while doing calendar arithmetic, then subtract seven hours to
// produce the real instant. This keeps midnight/noon slots exact and avoids the
// host/container timezone affecting the result.
function nextBangkokSlot(after, postingSchedule) {
  const afterMs = after instanceof Date ? after.getTime() : Number(after);
  if (!Number.isFinite(afterMs)) throw new Error('A valid starting time is required.');
  const configured = scheduleMap(postingSchedule);
  const schedule = Object.keys(configured).length ? configured : fallbackSchedule();
  const localAfter = new Date(afterMs + BANGKOK_OFFSET_MS);
  const localMidnight = Date.UTC(localAfter.getUTCFullYear(), localAfter.getUTCMonth(), localAfter.getUTCDate());

  for (let dayOffset = 0; dayOffset < 15; dayOffset++) {
    const localDayMs = localMidnight + dayOffset * 86400000;
    const localDay = new Date(localDayMs);
    const times = schedule[DAY_NAMES[localDay.getUTCDay()]] || [];
    for (const time of times) {
      const parts = time.split(':').map(Number);
      const candidate = localDayMs + parts[0] * 3600000 + parts[1] * 60000 - BANGKOK_OFFSET_MS;
      if (candidate > afterMs) return new Date(candidate).toISOString();
    }
  }
  throw new Error('No active short-form posting slot is available in the next two weeks.');
}

function isShortform(piece) {
  return ['ultra_short', 'short', 'long_short'].indexOf(piece && piece.contentType) !== -1;
}

function normalizeLongformTime(value) {
  return normalizeTime(value) || '07:55';
}

// Longform uses a three-calendar-day Bangkok rhythm at one chosen wall-clock
// time. Using the prior longform's local calendar date as the anchor means the
// normal case is exactly 72 hours, while changing the chosen time deliberately
// shifts the next release to that new wall-clock time.
function nextBangkokLongformSlot(after, selectedTime, latestScheduledAt) {
  const afterMs = after instanceof Date ? after.getTime() : Number(after);
  if (!Number.isFinite(afterMs)) throw new Error('A valid starting time is required.');
  const time = normalizeLongformTime(selectedTime).split(':').map(Number);
  const latestMs = Date.parse(latestScheduledAt || '');
  const anchorMs = Number.isFinite(latestMs) ? latestMs : afterMs;
  const anchorLocal = new Date(anchorMs + BANGKOK_OFFSET_MS);
  let localDay = Date.UTC(anchorLocal.getUTCFullYear(), anchorLocal.getUTCMonth(), anchorLocal.getUTCDate());
  if (Number.isFinite(latestMs)) localDay += 3 * 86400000;
  let candidate = localDay + time[0] * 3600000 + time[1] * 60000 - BANGKOK_OFFSET_MS;
  if (!Number.isFinite(latestMs) && candidate <= afterMs) candidate += 86400000;
  while (candidate <= afterMs) candidate += 3 * 86400000;
  return new Date(candidate).toISOString();
}

module.exports = {
  DEFAULT_SLOTS: DEFAULT_SLOTS,
  nextBangkokSlot: nextBangkokSlot,
  nextBangkokLongformSlot: nextBangkokLongformSlot,
  normalizeLongformTime: normalizeLongformTime,
  scheduleMap: scheduleMap,
  isShortform: isShortform
};
