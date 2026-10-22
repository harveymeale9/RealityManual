'use strict';

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DEFAULT_SLOTS = ['00:00', '12:00'];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
// 11 p.m. on 23 October 2026 in Bangkok (UTC+7). Future slots are elapsed
// hours from this instant, so the local publication clock deliberately moves.
const LONGFORM_ANCHOR = '2026-10-23T16:00:00.000Z';
const DEFAULT_LONGFORM_INTERVAL_HOURS = 60;

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

function nextAvailableBangkokSlots(after, postingSchedule, occupiedTimes, count) {
  const wanted = Math.max(1, Math.min(100, Number(count) || 1));
  const occupied = new Set((occupiedTimes || []).map(function (value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }).filter(function (value) { return value !== null; }));
  const slots = [];
  let cursor = after instanceof Date ? after.getTime() : Number(after);
  while (slots.length < wanted) {
    const next = Date.parse(nextBangkokSlot(cursor, postingSchedule));
    cursor = next;
    if (!occupied.has(next)) slots.push(new Date(next).toISOString());
  }
  return slots;
}

function isShortform(piece) {
  return ['ultra_short', 'short', 'long_short'].indexOf(piece && piece.contentType) !== -1;
}

function normalizeLongformIntervalHours(value) {
  const hours = Number(value);
  return Number.isInteger(hours) && hours >= 1 && hours <= 720 ? hours : DEFAULT_LONGFORM_INTERVAL_HOURS;
}

function nextLongformSlot(after, anchor, intervalHours) {
  const afterMs = after instanceof Date ? after.getTime() : Number(after);
  if (!Number.isFinite(afterMs)) throw new Error('A valid starting time is required.');
  const configuredAnchor = Date.parse(anchor || '');
  const anchorMs = Number.isFinite(configuredAnchor) ? configuredAnchor : Date.parse(LONGFORM_ANCHOR);
  const intervalMs = normalizeLongformIntervalHours(intervalHours) * 3600000;
  const step = Math.max(0, Math.floor((afterMs - anchorMs) / intervalMs) + 1);
  return new Date(anchorMs + step * intervalMs).toISOString();
}

function nextAvailableLongformSlots(after, anchor, intervalHours, occupiedTimes, count) {
  const afterMs = after instanceof Date ? after.getTime() : Number(after);
  if (!Number.isFinite(afterMs)) throw new Error('A valid starting time is required.');
  const wanted = Math.max(1, Math.min(120, Number(count) || 1));
  const occupiedSet = new Set((occupiedTimes || []).map(function (value) { return Date.parse(value); }).filter(Number.isFinite));
  const intervalMs = normalizeLongformIntervalHours(intervalHours) * 3600000;
  let candidate = Date.parse(nextLongformSlot(afterMs, anchor, intervalHours));
  const slots = [];
  while (slots.length < wanted) {
    if (!occupiedSet.has(candidate)) slots.push(new Date(candidate).toISOString());
    candidate += intervalMs;
  }
  return slots;
}

module.exports = {
  DEFAULT_SLOTS: DEFAULT_SLOTS,
  nextBangkokSlot: nextBangkokSlot,
  nextAvailableBangkokSlots: nextAvailableBangkokSlots,
  LONGFORM_ANCHOR: LONGFORM_ANCHOR,
  DEFAULT_LONGFORM_INTERVAL_HOURS: DEFAULT_LONGFORM_INTERVAL_HOURS,
  nextLongformSlot: nextLongformSlot,
  nextAvailableLongformSlots: nextAvailableLongformSlots,
  normalizeLongformIntervalHours: normalizeLongformIntervalHours,
  scheduleMap: scheduleMap,
  isShortform: isShortform
};
