// Shared data layer for the Reality Manual control panel.
// Used by both the main dashboard (app.js) and the quick-add shortcut
// (quick-add.html), so a new idea captured on a phone home screen lands
// in the same IndexedDB store the dashboard reads from.
window.RMStore = (function () {
  var DB_NAME = 'rm_content_ops';
  var DB_VERSION = 2;
  var dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      if (!window.indexedDB) { resolve(null); return; }
      var req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { resolve(null); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        ['pieces', 'videos', 'audioTracks', 'settings', 'errors'].forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
    });
    return dbPromise;
  }

  function getAll(storeName) {
    return openDb().then(function (db) {
      if (!db) return [];
      return new Promise(function (resolve) {
        var req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { resolve([]); };
      });
    });
  }

  function get(storeName, id) {
    return openDb().then(function (db) {
      if (!db) return undefined;
      return new Promise(function (resolve) {
        var req = db.transaction(storeName, 'readonly').objectStore(storeName).get(id);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(undefined); };
      });
    });
  }

  function put(storeName, record) {
    return openDb().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve) {
        var t = db.transaction(storeName, 'readwrite');
        t.objectStore(storeName).put(record);
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { resolve(); };
      });
    });
  }

  function del(storeName, id) {
    return openDb().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve) {
        var t = db.transaction(storeName, 'readwrite');
        t.objectStore(storeName).delete(id);
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { resolve(); };
      });
    });
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
    { id: 'processed', label: 'Processed (Audio)' },
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
    openDb: openDb, getAll: getAll, get: get, put: put, del: del,
    genId: genId, nowIso: nowIso,
    STAGES: STAGES, CONTENT_TYPES: CONTENT_TYPES, PLATFORMS: PLATFORMS,
    DEFAULT_CADENCE: DEFAULT_CADENCE,
    getSettings: getSettings, saveSettings: saveSettings, cadenceMs: cadenceMs
  };
})();
