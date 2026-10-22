(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RMQueueCoverage = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var DAY_MS = 86400000;
  var BANGKOK_OFFSET_MS = 7 * 3600000;
  var PREPARATION_LEAD_MS = 20 * 60000;
  var SHORT_TYPES = ['ultra_short', 'short', 'long_short'];
  var DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  function timestamp(value) {
    var parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  function localMidnight(ms) { return Math.floor((ms + BANGKOK_OFFSET_MS) / DAY_MS) * DAY_MS - BANGKOK_OFFSET_MS; }
  function localDayKey(ms) { return Math.floor((ms + BANGKOK_OFFSET_MS) / DAY_MS); }
  function timeParts(value) {
    var match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
    return [Number(match[1]), Number(match[2])];
  }
  function isShort(piece) { return SHORT_TYPES.indexOf(piece && piece.contentType) !== -1; }
  function isReady(piece) {
    return piece && piece.hasVideo && piece.stage === 'publishing_queue' &&
      Array.isArray(piece.queuedPublishDestinations) && piece.queuedPublishDestinations.length > 0;
  }
  function futureScheduled(piece, now) { return piece && piece.stage === 'scheduled' && timestamp(piece.scheduledAt) > now; }

  function longformSlots(now, anchor, intervalHours, count) {
    var start = timestamp(anchor);
    if (start === null) start = Date.parse('2026-10-23T16:00:00.000Z');
    var hours = Number(intervalHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) hours = 60;
    var interval = hours * 3600000;
    var first = start + Math.max(0, Math.floor((now - start) / interval) + 1) * interval;
    var slots = [];
    for (var i = 0; i < count; i++) slots.push(first + i * interval);
    return slots;
  }

  function shortformSlots(now, pieces, postingSchedule, count) {
    var schedule = {};
    (Array.isArray(postingSchedule) ? postingSchedule : []).forEach(function (day) {
      var key = String(day && day.day || '').toLowerCase().slice(0, 3);
      if (DAY_NAMES.indexOf(key) === -1 || day.paused) return;
      var times = (Array.isArray(day.times) ? day.times : []).map(timeParts).filter(Boolean);
      if (times.length) schedule[key] = times;
    });
    var slots = [];
    if (Object.keys(schedule).length) {
      for (var d = 0; d < 90 && slots.length < count; d++) {
        var midnight = localMidnight(now) + d * DAY_MS;
        var dayName = DAY_NAMES[new Date(midnight + BANGKOK_OFFSET_MS).getUTCDay()];
        (schedule[dayName] || []).forEach(function (time) {
          var slot = midnight + time[0] * 3600000 + time[1] * 60000;
          if (slot > now) slots.push(slot);
        });
      }
      return { slots: slots.sort(function (a, b) { return a - b; }).slice(0, count), estimated: false };
    }
    // During Buffer API outages, use the last actual short slot's Bangkok
    // wall-clock time as a clearly labelled daily estimate, never the old
    // midnight/noon fallback that the publishing worker deliberately rejects.
    var history = pieces.filter(isShort).filter(function (piece) {
      return piece.stage === 'live' || piece.stage === 'scheduled';
    }).map(function (piece) { return timestamp(piece.scheduledAt || piece.postedAt); })
      .filter(function (value) { return value !== null; }).sort(function (a, b) { return b - a; });
    if (!history.length) return { slots: [], estimated: true };
    var lastLocalTime = (history[0] - localMidnight(history[0])) % DAY_MS;
    var first = localMidnight(now) + lastLocalTime;
    if (first <= now) first += DAY_MS;
    for (var n = 0; n < count; n++) slots.push(first + n * DAY_MS);
    return { slots: slots, estimated: true };
  }

  function coverageFor(type, pieces, now, slots, estimated) {
    var matches = pieces.filter(function (piece) { return type === 'longform' ? piece.contentType === 'longform' : isShort(piece); });
    var waiting = matches.filter(isReady).length;
    var scheduled = matches.filter(function (piece) { return futureScheduled(piece, now); })
      .map(function (piece) { return timestamp(piece.scheduledAt); });
    var timeline = [];
    var deadline = null;
    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      var scheduledIndex = scheduled.findIndex(function (value) {
        return estimated
          ? localDayKey(value) === localDayKey(slot)
          : Math.abs(value - slot) < 60 * 60000;
      });
      var state = 'open';
      if (scheduledIndex !== -1) { state = 'scheduled'; scheduled.splice(scheduledIndex, 1); }
      else if (waiting > 0) { state = 'queued'; waiting--; }
      if (state === 'open' && deadline === null) deadline = slot - PREPARATION_LEAD_MS;
      timeline.push({ at: slot, state: state });
    }
    var covered = timeline.findIndex(function (item) { return item.state === 'open'; });
    if (covered === -1) covered = timeline.length;
    return {
      type: type, estimated: !!estimated, readyCount: matches.filter(isReady).length,
      scheduledCount: matches.filter(function (piece) { return futureScheduled(piece, now); }).length,
      coveredSlots: covered, coveredThrough: covered ? timeline[covered - 1].at : null,
      nextNeededAt: deadline, daysUntilNeeded: deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / DAY_MS)),
      timeline: timeline.slice(0, type === 'longform' ? 15 : 6), allSlots: timeline
    };
  }

  function calculate(options) {
    options = options || {};
    var pieces = Array.isArray(options.pieces) ? options.pieces : [];
    var now = Number(options.now) || Date.now();
    // Include the full visible 15-day path even when the queue is empty or
    // Buffer has several posting times on a single day.
    var count = Math.max(120, pieces.length + 3);
    var shorts = shortformSlots(now, pieces, options.postingSchedule, count);
    var longform = coverageFor('longform', pieces, now,
      longformSlots(now, options.longformAnchor, options.longformIntervalHours, count), false);
    var shortform = coverageFor('shortform', pieces, now, shorts.slots, shorts.estimated);
    // Past slots are omitted from the refill calculation, but a post that
    // actually went live today should remain visible on the 15-day map.
    var published = pieces.filter(function (piece) { return piece && piece.stage === 'live'; })
      .map(function (piece) { return { piece: piece, at: timestamp(piece.postedAt) }; })
      .filter(function (item) { return item.at !== null && item.at <= now; });
    var firstDay = localMidnight(now);
    var days = [];
    for (var day = 0; day < 15; day++) {
      var at = firstDay + day * DAY_MS;
      var key = localDayKey(at);
      var publishedToday = published.filter(function (item) { return localDayKey(item.at) === key; });
      days.push({ at: at, today: day === 0,
        publishedLongform: publishedToday.filter(function (item) { return item.piece.contentType === 'longform'; })
          .map(function (item) { return { at: item.at, state: 'published' }; }),
        publishedShortform: publishedToday.filter(function (item) { return isShort(item.piece); })
          .map(function (item) { return { at: item.at, state: 'published' }; }),
        longform: longform.allSlots.filter(function (slot) { return localDayKey(slot.at) === key; }),
        shortform: shortform.allSlots.filter(function (slot) { return localDayKey(slot.at) === key; }) });
    }
    return { longform: longform, shortform: shortform, days: days };
  }

  return { calculate: calculate, longformSlots: longformSlots, shortformSlots: shortformSlots };
});
