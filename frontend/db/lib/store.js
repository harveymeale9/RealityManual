// Shared data layer for the Reality Manual control panel.
// Talks to the rm-ops-service backend (ops.realitymanual.com) instead of
// browser-local IndexedDB, so data syncs across devices. Used by both the
// main dashboard (app.js) and the quick-add shortcut (quick-add.html).
window.RMStore = (function () {
  var API_BASE = 'https://ops.realitymanual.com';
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

  var STAGES = [
    { id: 'ideation', label: 'Ideation' },
    { id: 'outline_started', label: 'Outline Started' },
    { id: 'outline_completed', label: 'Outline Completed' },
    { id: 'filmed', label: 'Filmed' },
    { id: 'edited', label: 'Edited' },
    { id: 'uploaded', label: 'Uploaded' },
    { id: 'processed', label: 'Processing' },
    { id: 'thumbnail', label: 'Thumbnail Selected' },
    { id: 'scheduled', label: 'Scheduled' },
    { id: 'live', label: 'Posted / Live' }
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

  var DEFAULT_CADENCE = {
    ultra_short: { every: 8, unit: 'hours' },
    short: { every: 1, unit: 'days' },
    long_short: { every: 3, unit: 'days' },
    longform: { every: 7, unit: 'days' }
  };

  var SETTINGS_ID = 'settings';

  function defaultSettings() {
    return {
      id: SETTINGS_ID,
      cadence: JSON.parse(JSON.stringify(DEFAULT_CADENCE)),
      sharedCaption: '',
      baseLinkUrl: 'https://realitymanual.com',
      apiKeys: { youtube: '', instagram: '', facebook: '', tiktok: '', transcriptionProvider: '', transcriptionKey: '' }
    };
  }

  function getSettings() {
    return get('settings', SETTINGS_ID).then(function (s) {
      if (!s) return defaultSettings();
      var d = defaultSettings();
      s.cadence = Object.assign(d.cadence, s.cadence || {});
      s.apiKeys = Object.assign(d.apiKeys, s.apiKeys || {});
      if (typeof s.sharedCaption !== 'string') s.sharedCaption = '';
      if (typeof s.baseLinkUrl !== 'string') s.baseLinkUrl = d.baseLinkUrl;
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

  return {
    API_BASE: API_BASE,
    getAll: getAll, get: get, put: put, del: del,
    genId: genId, nowIso: nowIso,
    STAGES: STAGES, CONTENT_TYPES: CONTENT_TYPES, PLATFORMS: PLATFORMS,
    DEFAULT_CADENCE: DEFAULT_CADENCE,
    getSettings: getSettings, saveSettings: saveSettings, cadenceMs: cadenceMs
  };
})();
