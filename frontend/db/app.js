(function () {
  'use strict';

  var PANEL_PASSWORD = 'ormiston';
  var AUTH_KEY = 'rm_panel_auth';
  var SEEDED_KEY = 'rm_content_ops_seeded';

  var TABS = [
    { id: 'content-ops', label: 'Content Ops' },
    { id: 'content-analytics', label: 'Content Analytics' },
    { id: 'sales-analytics', label: 'Sales Analytics' }
  ];

  /* ============================================================
     LOGIN GATE
     ============================================================ */

  var loginGate = document.getElementById('loginGate');
  var loginForm = document.getElementById('loginForm');
  var loginPassword = document.getElementById('loginPassword');
  var loginError = document.getElementById('loginError');
  var appShell = document.getElementById('appShell');

  function isAuthed() {
    try { return localStorage.getItem(AUTH_KEY) === '1'; }
    catch (e) { return false; }
  }

  function setAuthed(v) {
    try {
      if (v) localStorage.setItem(AUTH_KEY, '1');
      else localStorage.removeItem(AUTH_KEY);
    } catch (e) {}
  }

  function showApp() {
    loginGate.hidden = true;
    appShell.hidden = false;
    initApp();
  }

  function showLogin() {
    appShell.hidden = true;
    loginGate.hidden = false;
    setTimeout(function () { loginPassword.focus(); }, 50);
  }

  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (loginPassword.value === PANEL_PASSWORD) {
      setAuthed(true);
      loginError.hidden = true;
      loginForm.reset();
      showApp();
    } else {
      loginError.hidden = false;
      loginPassword.value = '';
      loginPassword.focus();
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', function () {
    setAuthed(false);
    showLogin();
  });

  if (isAuthed()) showApp(); else showLogin();

  /* ============================================================
     TAB SHELL
     ============================================================ */

  var appInitialized = false;
  var panelTabs = document.getElementById('panelTabs');
  var panelMain = document.getElementById('panelMain');
  var contentOpsBooted = false;

  function currentTabId() {
    var h = (location.hash || '').replace('#', '');
    var match = TABS.filter(function (t) { return t.id === h; })[0];
    return match ? match.id : TABS[0].id;
  }

  function renderTabs() {
    panelTabs.innerHTML = TABS.map(function (t) {
      return '<button class="panel-tab" data-tab="' + t.id + '">' + t.label + '</button>';
    }).join('');
    panelTabs.querySelectorAll('.panel-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        location.hash = btn.dataset.tab;
      });
    });
  }

  function renderActiveTab() {
    var active = currentTabId();
    panelTabs.querySelectorAll('.panel-tab').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.tab === active);
    });
    if (active === 'content-ops') {
      panelMain.innerHTML = OPS_MARKUP;
      bootContentOps();
    } else {
      var label = TABS.filter(function (t) { return t.id === active; })[0].label;
      panelMain.innerHTML =
        '<div class="tab-placeholder">' +
          '<div class="eyebrow">Coming soon</div>' +
          '<h2>' + label + '</h2>' +
          '<p>This section isn\'t built yet — it\'ll live here alongside Content Ops as the rest of the control panel comes online.</p>' +
        '</div>';
    }
  }

  function initApp() {
    if (appInitialized) { renderActiveTab(); return; }
    appInitialized = true;
    renderTabs();
    window.addEventListener('hashchange', renderActiveTab);
    if (!location.hash) location.hash = TABS[0].id;
    renderActiveTab();
  }

  /* ============================================================
     CONTENT OPS — markup mounted into #panelMain
     ============================================================ */

  var OPS_MARKUP =
    '<div class="ops-panel">' +
      '<div class="ops-toolbar">' +
        '<div class="ops-stats" id="statStrip"></div>' +
        '<button class="btn-primary" id="btnNew">+ New Piece</button>' +
      '</div>' +
      '<div class="storage-note" id="storageNote">Stored locally in this browser — not yet synced across devices.</div>' +
      '<div class="board-wrap" id="boardWrap"><div class="board" id="board"></div></div>' +
    '</div>';

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

  var PLATFORMS = [
    { id: 'ytlong', label: 'YT · Long', color: '#c9683a' },
    { id: 'ytshort', label: 'YT · Shorts', color: '#c9683a' },
    { id: 'tiktok', label: 'TikTok', color: '#4a9b96' },
    { id: 'instagram', label: 'Instagram', color: '#b8577e' },
    { id: 'facebook', label: 'Facebook', color: '#5b80b0' }
  ];

  /* ---------- tiny IndexedDB wrapper ---------- */

  var DB_NAME = 'rm_content_ops';
  var STORE = 'pieces';
  var idbPromise = null;

  function openDb() {
    if (idbPromise) return idbPromise;
    idbPromise = new Promise(function (resolve) {
      if (!window.indexedDB) { resolve(null); return; }
      var req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { resolve(null); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
    });
    return idbPromise;
  }

  function idbGetAll() {
    return openDb().then(function (db) {
      if (!db) return [];
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { resolve([]); };
      });
    });
  }

  function idbPut(piece) {
    return openDb().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(piece);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      });
    });
  }

  function idbDelete(id) {
    return openDb().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      });
    });
  }

  function genId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function nowIso() { return new Date().toISOString(); }

  /* ---------- state ---------- */

  var pieces = {};
  var activeId = null;
  var isNewUnsaved = false;
  var draggingId = null;
  var saveTimer = null;
  var deleteArmed = false;
  var deleteArmTimer = null;

  var board, statStrip, storageNote, boardWrap;
  var modalWrap, pieceModal, scrim, fieldTitle, fieldStage, fieldFormat, fieldNotes,
      platformGrid, metaCreated, metaUpdated, saveFlag, modalEyebrowText, btnDelete;

  function fmtTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    var diff = Date.now() - d.getTime();
    var min = Math.round(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + 'm ago';
    var hr = Math.round(min / 60);
    if (hr < 24) return hr + 'h ago';
    var day = Math.round(hr / 24);
    if (day < 30) return day + 'd ago';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtFull(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function orderedIds(stageId) {
    return Object.keys(pieces)
      .filter(function (id) { return pieces[id].stage === stageId; })
      .sort(function (a, b) { return (pieces[a].order || 0) - (pieces[b].order || 0); });
  }

  function maxOrder(stageId) {
    var ids = orderedIds(stageId);
    if (!ids.length) return 0;
    return pieces[ids[ids.length - 1]].order || 0;
  }

  function renderStats() {
    var total = Object.keys(pieces).length;
    var liveCount = orderedIds('live').length;
    var activeCount = total - liveCount;
    statStrip.innerHTML =
      '<span><span class="n">' + total + '</span>total</span>' +
      '<span><span class="n">' + activeCount + '</span>in motion</span>' +
      '<span><span class="n">' + liveCount + '</span>live</span>';
  }

  function chipHtml(piece) {
    var out = '';
    (piece.platforms || []).forEach(function (pid) {
      var p = PLATFORMS.filter(function (x) { return x.id === pid; })[0];
      if (!p) return;
      out += '<span class="chip"><span class="dot" style="background:' + p.color + '"></span>' + p.label + '</span>';
    });
    if (piece.format) {
      out += '<span class="chip format">' + (piece.format === 'long' ? 'Long-form' : 'Short-form') + '</span>';
    }
    return out;
  }

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function cardHtml(id, piece) {
    var title = (piece.title || '').trim();
    var titleHtml = title ? escapeHtml(title) : 'Untitled piece';
    var titleClass = title ? 'card-title' : 'card-title untitled';
    var stageOpts = STAGES.map(function (s) {
      return '<option value="' + s.id + '"' + (s.id === piece.stage ? ' selected' : '') + '>' + s.label + '</option>';
    }).join('');
    return '' +
      '<div class="card" draggable="true" data-id="' + id + '">' +
        '<span class="card-grip">⋮⋮</span>' +
        '<div class="' + titleClass + '">' + titleHtml + '</div>' +
        '<div class="chip-row">' + chipHtml(piece) + '</div>' +
        '<div class="card-foot">' +
          '<span class="card-time">' + fmtTime(piece.updatedAt) + '</span>' +
          '<select class="card-move" data-id="' + id + '">' + stageOpts + '</select>' +
        '</div>' +
      '</div>';
  }

  function render() {
    var scrollLeft = boardWrap.scrollLeft;
    board.innerHTML = STAGES.map(function (s, idx) {
      var ids = orderedIds(s.id);
      var cards = ids.map(function (id) { return cardHtml(id, pieces[id]); }).join('');
      if (!cards) cards = '<div class="empty-slot">Nothing here yet</div>';
      var num = String(idx + 1).padStart(2, '0');
      return '' +
        '<div class="column" data-stage="' + s.id + '">' +
          '<div class="column-head">' +
            '<span class="column-index">' + num + '</span>' +
            '<span class="column-title">' + s.label + '</span>' +
            '<span class="column-count">' + ids.length + '</span>' +
          '</div>' +
          '<div class="column-body" data-stage="' + s.id + '">' + cards + '</div>' +
          '<button class="column-add" data-stage="' + s.id + '">+ add here</button>' +
        '</div>';
    }).join('');
    boardWrap.scrollLeft = scrollLeft;
    renderStats();
    bindBoardEvents();
  }

  function bindBoardEvents() {
    board.querySelectorAll('.card').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.closest('.card-move')) return;
        openPiece(el.dataset.id);
      });
      el.addEventListener('dragstart', function (e) {
        draggingId = el.dataset.id;
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', draggingId); } catch (err) {}
      });
      el.addEventListener('dragend', function () {
        el.classList.remove('dragging');
        draggingId = null;
        board.querySelectorAll('.column').forEach(function (c) { c.classList.remove('drag-target'); });
      });
    });

    board.querySelectorAll('.card-move').forEach(function (sel) {
      sel.addEventListener('click', function (e) { e.stopPropagation(); });
      sel.addEventListener('change', function () {
        moveCard(sel.dataset.id, sel.value, maxOrder(sel.value) + 10);
      });
    });

    board.querySelectorAll('.column').forEach(function (col) {
      col.addEventListener('dragover', function (e) {
        if (!draggingId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        col.classList.add('drag-target');
      });
      col.addEventListener('dragleave', function (e) {
        if (e.target === col) col.classList.remove('drag-target');
      });
      col.addEventListener('drop', function (e) {
        e.preventDefault();
        col.classList.remove('drag-target');
        if (!draggingId) return;
        var stageId = col.dataset.stage;
        var body = col.querySelector('.column-body');

        var cardEls = Array.prototype.slice.call(body.querySelectorAll('.card'));
        var afterEl = cardEls.find(function (c) {
          var r = c.getBoundingClientRect();
          return e.clientY < r.top + r.height / 2;
        });

        var siblingIds = orderedIds(stageId).filter(function (id) { return id !== draggingId; });
        var insertAt = siblingIds.length;
        if (afterEl) {
          var idx = siblingIds.indexOf(afterEl.dataset.id);
          if (idx !== -1) insertAt = idx;
        }
        siblingIds.splice(insertAt, 0, draggingId);

        siblingIds.forEach(function (id, i) {
          var newOrder = (i + 1) * 10;
          var p = pieces[id];
          if (!p) return;
          var changedStage = (id === draggingId && p.stage !== stageId);
          if (p.order !== newOrder || changedStage) {
            p.order = newOrder;
            if (changedStage) p.stage = stageId;
            p.updatedAt = nowIso();
            idbPut(p);
          }
        });
        render();
      });
    });

    board.querySelectorAll('.column-add').forEach(function (btn) {
      btn.addEventListener('click', function () { createDraft(btn.dataset.stage); });
    });
  }

  function moveCard(id, stageId, order) {
    var p = pieces[id];
    if (!p) return;
    p.stage = stageId;
    p.order = order;
    p.updatedAt = nowIso();
    idbPut(p);
    render();
  }

  /* ---------- click-and-drag horizontal panning ---------- */

  function bindPanning() {
    var isPanning = false, startX = 0, startScroll = 0;
    boardWrap.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (e.target.closest('.card, .card-move, button, select, input, textarea, [contenteditable]')) return;
      isPanning = true;
      startX = e.clientX;
      startScroll = boardWrap.scrollLeft;
      try { boardWrap.setPointerCapture(e.pointerId); } catch (err) {}
      boardWrap.classList.add('panning');
    });
    boardWrap.addEventListener('pointermove', function (e) {
      if (!isPanning) return;
      boardWrap.scrollLeft = startScroll - (e.clientX - startX);
    });
    function endPan() { isPanning = false; boardWrap.classList.remove('panning'); }
    boardWrap.addEventListener('pointerup', endPan);
    boardWrap.addEventListener('pointercancel', endPan);
  }

  /* ---------- modal ---------- */

  function focusEndInput(el) {
    el.focus();
    var len = el.value.length;
    try { el.setSelectionRange(len, len); } catch (e) {}
  }

  function focusEndEditable(el) {
    el.focus();
    var range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    el.scrollTop = el.scrollHeight;
  }

  function populateFields(p) {
    fieldTitle.value = p.title || '';
    fieldStage.value = p.stage;
    fieldFormat.value = p.format || 'short';
    fieldNotes.innerHTML = p.notesHtml || '';
    platformGrid.querySelectorAll('.platform-toggle').forEach(function (t) {
      var checked = (p.platforms || []).indexOf(t.dataset.platform) !== -1;
      t.classList.toggle('checked', checked);
      t.querySelector('input').checked = checked;
    });
  }

  function openPiece(id) {
    activeId = id;
    isNewUnsaved = false;
    disarmDelete();
    var p = pieces[id];
    modalEyebrowText.textContent = 'Editing piece';
    populateFields(p);
    metaCreated.textContent = 'Created ' + fmtFull(p.createdAt);
    metaUpdated.textContent = 'Updated ' + fmtFull(p.updatedAt);
    showModal();
    var hasNotes = fieldNotes.textContent.trim().length > 0 || !!fieldNotes.querySelector('img');
    var hasTitle = (p.title || '').trim().length > 0;
    setTimeout(function () {
      if (hasNotes) focusEndEditable(fieldNotes);
      else if (hasTitle) focusEndInput(fieldTitle);
      else fieldTitle.focus();
    }, 200);
  }

  function createDraft(stageId) {
    var id = genId();
    pieces[id] = {
      id: id, title: '', stage: stageId, platforms: [], format: 'short', notesHtml: '',
      order: maxOrder(stageId) + 10,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    activeId = id;
    isNewUnsaved = true;
    disarmDelete();
    modalEyebrowText.textContent = 'New piece';
    populateFields(pieces[id]);
    metaCreated.textContent = 'Not yet saved';
    metaUpdated.textContent = '—';
    render();
    showModal();
    setTimeout(function () { fieldTitle.focus(); }, 200);
  }

  function showModal() {
    modalWrap.classList.add('open');
    pieceModal.setAttribute('aria-hidden', 'false');
    scrim.classList.add('show');
  }

  function hideModal() {
    modalWrap.classList.remove('open');
    pieceModal.setAttribute('aria-hidden', 'true');
    scrim.classList.remove('show');
  }

  function currentFormValues() {
    var platforms = [];
    platformGrid.querySelectorAll('.platform-toggle').forEach(function (t) {
      if (t.querySelector('input').checked) platforms.push(t.dataset.platform);
    });
    return {
      title: fieldTitle.value,
      stage: fieldStage.value,
      format: fieldFormat.value,
      notesHtml: fieldNotes.innerHTML,
      platforms: platforms
    };
  }

  function flashSaved() {
    saveFlag.classList.add('show');
    clearTimeout(saveFlag._t);
    saveFlag._t = setTimeout(function () { saveFlag.classList.remove('show'); }, 1400);
  }

  function hasText(v) {
    if ((v.title || '').trim()) return true;
    var probe = document.createElement('div');
    probe.innerHTML = v.notesHtml || '';
    return probe.textContent.trim().length > 0 || !!probe.querySelector('img');
  }

  function syncFromForm() {
    if (!activeId) return;
    var p = pieces[activeId];
    if (!p) return;
    var vals = currentFormValues();
    Object.assign(p, vals);
    p.updatedAt = nowIso();
    metaUpdated.textContent = 'Updated ' + fmtFull(p.updatedAt);

    if (isNewUnsaved) {
      if (hasText(vals)) {
        isNewUnsaved = false;
        modalEyebrowText.textContent = 'Editing piece';
        metaCreated.textContent = 'Created ' + fmtFull(p.createdAt);
        idbPut(p);
        flashSaved();
      }
      render();
      return;
    }

    idbPut(p);
    render();
    flashSaved();
  }

  function debounceSync() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(syncFromForm, 500);
  }

  function closeModal() {
    clearTimeout(saveTimer);
    disarmDelete();
    if (activeId) {
      syncFromForm();
      if (isNewUnsaved) {
        delete pieces[activeId];
      }
    }
    hideModal();
    activeId = null;
    isNewUnsaved = false;
    render();
  }

  function disarmDelete() {
    deleteArmed = false;
    clearTimeout(deleteArmTimer);
    btnDelete.textContent = 'Delete piece';
    btnDelete.classList.remove('armed');
  }

  /* ---------- paste-image support ---------- */

  var MAX_IMG_DIM = 1400;

  function insertImageAtCursor(dataUrl) {
    var img = document.createElement('img');
    img.className = 'note-img';
    img.src = dataUrl;
    var sel = window.getSelection();
    if (sel && sel.rangeCount && fieldNotes.contains(sel.anchorNode)) {
      var range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(img);
      range.setStartAfter(img);
      range.setEndAfter(img);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      fieldNotes.appendChild(img);
    }
  }

  function downscaleImage(file, cb) {
    var reader = new FileReader();
    reader.onload = function (ev) {
      var image = new Image();
      image.onload = function () {
        var w = image.width, h = image.height;
        if (w > MAX_IMG_DIM || h > MAX_IMG_DIM) {
          var scale = Math.min(MAX_IMG_DIM / w, MAX_IMG_DIM / h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, w, h);
        cb(canvas.toDataURL('image/jpeg', 0.85));
      };
      image.onerror = function () { cb(ev.target.result); };
      image.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  function bindNotesPaste() {
    fieldNotes.addEventListener('paste', function (e) {
      var cd = e.clipboardData || window.clipboardData;
      if (!cd) return;
      var items = cd.items || [];
      var imageFile = null;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image') === 0) {
          imageFile = items[i].getAsFile();
          break;
        }
      }
      if (imageFile) {
        e.preventDefault();
        downscaleImage(imageFile, function (dataUrl) {
          insertImageAtCursor(dataUrl);
          debounceSync();
        });
        return;
      }
      e.preventDefault();
      var text = cd.getData('text/plain');
      document.execCommand('insertText', false, text);
    });
  }

  /* ---------- seed examples ---------- */

  function seedExamples() {
    var now = Date.now();
    var examples = [
      {
        title: 'Example — "Why I wrote The Reality Manual" origin story',
        stage: 'ideation', platforms: ['ytlong', 'instagram'], format: 'long',
        notesHtml: 'Delete or edit me. Rough idea: talk-to-camera on the personal turning point behind the book.<br>Hook candidates:<br>— "I spent 3 years trying to disprove my own book"<br>— The night everything clicked'
      },
      {
        title: 'Example — Unboxing the linen hardcover',
        stage: 'outline_completed', platforms: ['tiktok', 'ytshort', 'instagram'], format: 'short',
        notesHtml: 'Delete or edit me. Beat sheet:<br>1. Package arrives<br>2. Slow reveal of dust jacket<br>3. Texture close-up on linen<br>4. First page open, close on epigraph'
      },
      {
        title: 'Example — 3 ideas from the book, explained in 60s each',
        stage: 'edited', platforms: ['ytshort', 'tiktok'], format: 'short',
        notesHtml: 'Delete or edit me. Edit is locked, waiting on audio pass.'
      },
      {
        title: 'Example — Full read-through of Chapter 1 (long-form)',
        stage: 'scheduled', platforms: ['ytlong'], format: 'long',
        notesHtml: 'Delete or edit me. Scheduled for release alongside launch week push.'
      }
    ];
    examples.forEach(function (ex, i) {
      ex.id = genId();
      ex.order = 10;
      ex.createdAt = new Date(now - (4 - i) * 3600000).toISOString();
      ex.updatedAt = ex.createdAt;
      pieces[ex.id] = ex;
      idbPut(ex);
    });
  }

  /* ---------- boot ---------- */

  function bootContentOps() {
    board = document.getElementById('board');
    statStrip = document.getElementById('statStrip');
    storageNote = document.getElementById('storageNote');
    boardWrap = document.getElementById('boardWrap');

    modalWrap = document.getElementById('modalWrap');
    pieceModal = document.getElementById('pieceModal');
    scrim = document.getElementById('scrim');
    fieldTitle = document.getElementById('fieldTitle');
    fieldStage = document.getElementById('fieldStage');
    fieldFormat = document.getElementById('fieldFormat');
    fieldNotes = document.getElementById('fieldNotes');
    platformGrid = document.getElementById('platformGrid');
    metaCreated = document.getElementById('metaCreated');
    metaUpdated = document.getElementById('metaUpdated');
    saveFlag = document.getElementById('saveFlag');
    modalEyebrowText = document.getElementById('modalEyebrowText');
    btnDelete = document.getElementById('btnDelete');

    render();
    bindPanning();

    if (contentOpsBooted) return;
    contentOpsBooted = true;

    if (fieldStage.children.length === 0) {
      STAGES.forEach(function (s) {
        var o = document.createElement('option');
        o.value = s.id; o.textContent = s.label;
        fieldStage.appendChild(o);
      });
    }
    if (platformGrid.children.length === 0) {
      PLATFORMS.forEach(function (p) {
        var label = document.createElement('label');
        label.className = 'platform-toggle';
        label.dataset.platform = p.id;
        label.innerHTML = '<input type="checkbox" value="' + p.id + '"><span class="dot" style="background:' + p.color + '"></span>' + p.label;
        platformGrid.appendChild(label);
      });
    }

    bindNotesPaste();

    [fieldTitle].forEach(function (el) {
      el.addEventListener('input', debounceSync);
      el.addEventListener('blur', function () { clearTimeout(saveTimer); syncFromForm(); });
    });
    fieldNotes.addEventListener('input', debounceSync);
    fieldNotes.addEventListener('blur', function () { clearTimeout(saveTimer); syncFromForm(); });
    fieldStage.addEventListener('change', function () { clearTimeout(saveTimer); syncFromForm(); });
    fieldFormat.addEventListener('change', function () { clearTimeout(saveTimer); syncFromForm(); });
    platformGrid.addEventListener('click', function (e) {
      var toggle = e.target.closest('.platform-toggle');
      if (!toggle) return;
      setTimeout(function () {
        var checked = toggle.querySelector('input').checked;
        toggle.classList.toggle('checked', checked);
        clearTimeout(saveTimer);
        syncFromForm();
      }, 0);
    });

    btnDelete.addEventListener('click', function () {
      if (!activeId) return;
      if (isNewUnsaved) {
        delete pieces[activeId];
        activeId = null;
        isNewUnsaved = false;
        hideModal();
        render();
        return;
      }
      if (!deleteArmed) {
        deleteArmed = true;
        btnDelete.textContent = 'Click again to confirm';
        btnDelete.classList.add('armed');
        deleteArmTimer = setTimeout(disarmDelete, 3500);
        return;
      }
      var id = activeId;
      disarmDelete();
      delete pieces[id];
      idbDelete(id);
      activeId = null;
      hideModal();
      render();
    });

    document.getElementById('btnNew').addEventListener('click', function () { createDraft('ideation'); });
    document.getElementById('modalClose').addEventListener('click', closeModal);
    scrim.addEventListener('click', closeModal);
    modalWrap.addEventListener('click', function (e) {
      if (e.target === modalWrap) closeModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modalWrap.classList.contains('open')) closeModal();
    });

    if (!window.indexedDB) {
      storageNote.textContent = 'This browser has no local storage available — changes will be lost when you close the tab.';
      storageNote.classList.add('warn');
      render();
      return;
    }

    idbGetAll().then(function (rows) {
      rows.forEach(function (r) { pieces[r.id] = r; });
      var alreadySeeded = false;
      try { alreadySeeded = localStorage.getItem(SEEDED_KEY) === '1'; } catch (e) {}
      if (!rows.length && !alreadySeeded) {
        seedExamples();
        try { localStorage.setItem(SEEDED_KEY, '1'); } catch (e) {}
      }
      render();
    });
  }
})();
