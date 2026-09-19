// Shared data layer for the Reality Manual control panel.
// Talks to the rm-ops-service backend (ops.realitymanual.com) instead of
// browser-local IndexedDB, so data syncs across devices. Used by both the
// main dashboard (app.js) and the quick-add shortcut (quick-add.html).
window.RMStore = (function () {
  var API_BASE = ''; // same-origin now that the panel is served by rm-ops-service itself
  var FILE_STORES = ['videos', 'audioTracks'];

  function apiFetch(path, opts) {
    opts = opts || {};
    opts.credentials = 'include';
    return fetch(API_BASE + path, opts);
  }

  function attachBlob(storeName, record) {
    return apiFetch('/api/files/' + storeName + '/' + encodeURIComponent(record.id))
      .then(function (r) {
        if (!r.ok) return record;
        return r.blob().then(function (blob) { record.blob = blob; return record; });
      })
      .catch(function () { return record; });
  }

  function getAll(storeName) {
    return apiFetch('/api/store/' + storeName)
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (records) {
        if (FILE_STORES.indexOf(storeName) === -1) return records;
        return Promise.all(records.map(function (rec) { return attachBlob(storeName, rec); }));
      })
      .catch(function () { return []; });
  }

  function get(storeName, id) {
    return apiFetch('/api/store/' + storeName + '/' + encodeURIComponent(id))
      .then(function (r) { return r.ok ? r.json() : undefined; })
      .then(function (record) {
        if (!record || FILE_STORES.indexOf(storeName) === -1) return record;
        return attachBlob(storeName, record);
      })
      .catch(function () { return undefined; });
  }

  function put(storeName, record) {
    if (FILE_STORES.indexOf(storeName) !== -1 && record.blob instanceof Blob) {
      var fd = new FormData();
      var meta = {};
      Object.keys(record).forEach(function (k) { if (k !== 'blob') meta[k] = record[k]; });
      fd.append('file', record.blob, record.fileName || record.name || 'file');
      fd.append('meta', JSON.stringify(meta));
      return apiFetch('/api/files/' + storeName + '/' + encodeURIComponent(record.id), {
        method: 'POST',
        body: fd
      }).then(function (r) { return r.ok ? r.json() : undefined; }).catch(function () {});
    }
    var body = {};
    Object.keys(record).forEach(function (k) { if (k !== 'blob') body[k] = record[k]; });
    return apiFetch('/api/store/' + storeName + '/' + encodeURIComponent(record.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.ok ? r.json() : undefined; }).catch(function () {});
  }

  function del(storeName, id) {
    return apiFetch('/api/store/' + storeName + '/' + encodeURIComponent(id), { method: 'DELETE' })
      .then(function () {})
      .catch(function () {});
  }

  function genId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function nowIso() { return new Date().toISOString(); }

  // "Thumbnail Selected" used to be its own stage — replaced (Harvey's
  // call) with a "thumbnail selected" tag shown on the card instead (see
  // TAGS below and app.js's cardHtml/tagsFor), since it was really a
  // sub-state of "Processing," not a genuinely separate stage worth its
  // own kanban column. "Final Check" is new — a video sits here after
  // Harvey explicitly sends it for review (thumbnail/audio/titles all
  // picked) and before he approves it into "Scheduled"; approving is what
  // actually assigns its scheduledAt now, not picking a thumbnail/audio
  // combination automatically the way it used to.
  var STAGES = [
    { id: 'archived', label: 'Archived Ideas' },
    { id: 'ideation', label: 'Ideation' },
    { id: 'outline_started', label: 'Outline Started' },
    { id: 'outline_completed', label: 'Outline Completed' },
    { id: 'filmed', label: 'Filmed' },
    { id: 'edited', label: 'Edited' },
    { id: 'uploaded', label: 'Uploaded' },
    { id: 'processed', label: 'Processing' },
    { id: 'final_check', label: 'Final Check' },
    { id: 'scheduled', label: 'Scheduled' },
    { id: 'live', label: 'Posted / Live' }
  ];

  // Replaces the old "Thumbnail Selected" stage — set automatically by the
  // app the moment each corresponding action happens (never something
  // Harvey picks manually), shown as small chips on a video card.
  var TAGS = [
    { id: 'thumbnail_selected', label: 'Thumbnail selected' },
    { id: 'titles_selected', label: 'Titles selected' },
    { id: 'music_added', label: 'Music added' }
  ];

  var CONTENT_TYPES = [
    { id: 'ultra_short', label: 'Ultra-short', hint: '10–20 sec', color: '#4a9b96' },
    { id: 'short', label: 'Short', hint: '~1 min', color: '#b8577e' },
    { id: 'long_short', label: 'Long-short', hint: 'up to 3 min', color: '#c9a24d' },
    { id: 'longform', label: 'Longform', hint: 'YT / FB', color: '#5b80b0' }
  ];

  var PLATFORMS = [
    { id: 'ytlong', label: 'YT · Long', color: '#c9683a' },
    { id: 'ytshort', label: 'YT · Shorts', color: '#c9683a' },
    { id: 'tiktok', label: 'TikTok', color: '#4a9b96' },
    { id: 'instagram', label: 'Instagram', color: '#b8577e' },
    { id: 'facebook', label: 'Facebook', color: '#5b80b0' }
  ];

  // Only two cadences now, per Harvey — "shorts" covers ultra_short/short/
  // long_short collectively (app.js rotates which of the three gets the
  // next slot; see scheduleShorts), "longform" is its own timeline.
  var SHORT_TYPES = ['ultra_short', 'short', 'long_short'];
  var DEFAULT_CADENCE = {
    shorts: { every: 8, unit: 'hours' },
    longform: { every: 7, unit: 'days' }
  };

  var SETTINGS_ID = 'settings';

  function defaultSettings() {
    return {
      id: SETTINGS_ID,
      cadence: JSON.parse(JSON.stringify(DEFAULT_CADENCE)),
      lastShortType: '',
      // Separate templates per Harvey: shorts reuse the same caption every
      // time, longform needs a fresh per-video tracked link. Both support
      // a "[LINK]" placeholder (see app.js buildUtmLink/applyCaptionLink)
      // since he later realized Shorts can carry tracking links too.
      // tiktok/igfb (added later) are optional platform-specific overrides
      // — used instead of shorts/longform when a piece is tagged for that
      // platform and the field isn't left blank (see app.js
      // captionTemplateFor).
      captions: { shorts: '', longform: '', tiktok: '', igfb: '' },
      baseLinkUrl: 'https://realitymanual.com',
      apiKeys: { youtube: '', instagram: '', facebook: '', tiktok: '', transcriptionProvider: '', transcriptionKey: '' }
    };
  }

  function getSettings() {
    return get('settings', SETTINGS_ID).then(function (s) {
      if (!s) return defaultSettings();
      var d = defaultSettings();
      // Migrate the old per-content-type cadence/single-caption shape
      // (four cadence keys, one sharedCaption string) if this settings row
      // predates today's restructure — best-effort, not a precise mapping.
      if (s.cadence && (s.cadence.ultra_short || s.cadence.short || s.cadence.long_short) && !s.cadence.shorts) {
        s.cadence = { shorts: s.cadence.ultra_short || d.cadence.shorts, longform: s.cadence.longform || d.cadence.longform };
      }
      s.cadence = Object.assign(d.cadence, s.cadence || {});
      s.apiKeys = Object.assign(d.apiKeys, s.apiKeys || {});
      if (!s.captions) s.captions = {};
      if (typeof s.sharedCaption === 'string' && !s.captions.shorts && !s.captions.longform) {
        s.captions.shorts = s.sharedCaption;
        s.captions.longform = s.sharedCaption;
      }
      s.captions = Object.assign(d.captions, s.captions);
      if (typeof s.baseLinkUrl !== 'string') s.baseLinkUrl = d.baseLinkUrl;
      if (typeof s.lastShortType !== 'string') s.lastShortType = '';
      return s;
    });
  }

  function saveSettings(s) {
    s.id = SETTINGS_ID;
    return put('settings', s);
  }

  function cadenceMs(cfg) {
    var n = (cfg && cfg.every) || 1;
    var unit = (cfg && cfg.unit) || 'days';
    return unit === 'hours' ? n * 3600000 : n * 86400000;
  }

  // Sequential, human-friendly card IDs ("047", not the internal uuid) —
  // computed from whatever's already loaded rather than a separate
  // persisted counter, so quick-add.html (which already fetches all
  // pieces to compute ordering) and app.js both get the same next number
  // without a shared counter to keep in sync. Never reused after a
  // deletion (always max+1), so a number Harvey references by voice stays
  // meaningful even if an earlier piece is later removed.
  function nextSeq(rows) {
    var max = -1;
    (rows || []).forEach(function (r) { if (typeof r.seq === 'number' && r.seq > max) max = r.seq; });
    return max + 1;
  }

  // Substitutes the "[LINK]" shortcode in a caption template with a real
  // per-piece link (case-insensitive, e.g. "[link]" also matches).
  function applyCaptionLink(template, link) {
    return (template || '').replace(/\[LINK\]/gi, link);
  }

  return {
    API_BASE: API_BASE,
    SHORT_TYPES: SHORT_TYPES,
    nextSeq: nextSeq,
    applyCaptionLink: applyCaptionLink,
    getAll: getAll, get: get, put: put, del: del,
    genId: genId, nowIso: nowIso,
    STAGES: STAGES, TAGS: TAGS, CONTENT_TYPES: CONTENT_TYPES, PLATFORMS: PLATFORMS,
    DEFAULT_CADENCE: DEFAULT_CADENCE,
    getSettings: getSettings, saveSettings: saveSettings, cadenceMs: cadenceMs
  };
})();
