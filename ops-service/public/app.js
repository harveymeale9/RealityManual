(function () {
  'use strict';

  var Store = window.RMStore;
  var Auth = window.RMAuth;

  var UPLOADED_INDEX = window.RMStore.STAGES.map(function (s) { return s.id; }).indexOf('uploaded');
  var MANUAL_STAGE_IDS = window.RMStore.STAGES.slice(0, UPLOADED_INDEX + 1).map(function (s) { return s.id; });
  var AUTO_STAGE_IDS = window.RMStore.STAGES.slice(UPLOADED_INDEX + 1).map(function (s) { return s.id; });

  var TABS = [
    { id: 'content-ops', label: 'Content Ops' },
    { id: 'upload-files', label: 'Upload Files' },
    { id: 'content-analytics', label: 'Content Analytics' },
    { id: 'sales-analytics', label: 'Sales Analytics' },
    { id: 'website-analytics', label: 'Website Analytics' },
    { id: 'settings', label: 'Settings' }
  ];

  /* ============================================================
     LOGIN GATE
     ============================================================ */

  var loginGate = document.getElementById('loginGate');
  var loginForm = document.getElementById('loginForm');
  var loginPassword = document.getElementById('loginPassword');
  var loginError = document.getElementById('loginError');
  var appShell = document.getElementById('appShell');
  var authChecking = document.getElementById('authChecking');

  function showApp() {
    authChecking.hidden = true;
    loginGate.hidden = true;
    appShell.hidden = false;
    initApp();
  }

  function showLogin() {
    authChecking.hidden = true;
    appShell.hidden = true;
    loginGate.hidden = false;
    setTimeout(function () { loginPassword.focus(); }, 50);
  }

  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    Auth.checkPassword(loginPassword.value).then(function (ok) {
      if (ok) {
        loginError.hidden = true;
        loginForm.reset();
        showApp();
      } else {
        loginError.hidden = false;
        loginPassword.value = '';
        loginPassword.focus();
      }
    });
  });

  document.getElementById('logoutBtn').addEventListener('click', function () {
    Auth.logout().then(showLogin);
  });

  /* ============================================================
     TAB SHELL
     ============================================================ */

  var appInitialized = false;
  var panelTabs = document.getElementById('panelTabs');
  var panelMain = document.getElementById('panelMain');

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
      btn.addEventListener('click', function () { location.hash = btn.dataset.tab; });
    });
  }

  var ANALYTICS_INFO = {
    'content-analytics': {
      title: 'Content Analytics',
      blurb: 'Per-video and per-content-type performance, once the YouTube / TikTok / Instagram / Facebook API keys in Settings are actually wired up to a backend that can call them.',
      metrics: [
        'Views — daily, weekly, monthly, per video and per content type',
        'Watch time / retention where the platform provides it',
        'Likes, comments, shares per video',
        'Performance by content type — ultra-short vs. short vs. long-short vs. longform',
        'Best and worst performing pieces this month'
      ]
    },
    'sales-analytics': {
      title: 'Sales Analytics',
      blurb: 'Order and revenue reporting once the storefront backend (backend/) is deployed with live Stripe and BookVault credentials.',
      metrics: [
        'Revenue — daily, weekly, monthly',
        'Orders completed, refunded',
        'Average order value',
        'Conversion rate — completed orders / checkout visitors',
        'Revenue by country',
        'Revenue by UTM source / campaign'
      ]
    },
    'website-analytics': {
      title: 'Website Analytics',
      blurb: 'First-party funnel analytics for realitymanual.com, once analytics ingestion is wired into the storefront backend.',
      metrics: [
        'Page views — daily, weekly, monthly',
        'Unique visitors',
        'Funnel: landing view → checkout view → checkout started → payment succeeded → order complete',
        'Landing page conversion rate — completed orders / unique landing visitors',
        'Checkout conversion rate — completed orders / checkout visitors',
        'Traffic by source / UTM campaign'
      ]
    }
  };

  function renderAnalyticsPlaceholder(tabId) {
    var info = ANALYTICS_INFO[tabId];
    panelMain.innerHTML =
      '<div class="tab-placeholder wide">' +
        '<div class="eyebrow">Not connected yet</div>' +
        '<h2>' + info.title + '</h2>' +
        '<p>' + info.blurb + '</p>' +
        '<ul class="metric-list">' + info.metrics.map(function (m) { return '<li>' + m + '</li>'; }).join('') + '</ul>' +
      '</div>';
  }

  function renderActiveTab() {
    var active = currentTabId();
    panelTabs.querySelectorAll('.panel-tab').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.tab === active);
    });
    if (active === 'content-ops') {
      panelMain.innerHTML = OPS_MARKUP;
      bootContentOps();
    } else if (active === 'upload-files') {
      panelMain.innerHTML = UPLOAD_MARKUP;
      bootUploadFiles();
    } else if (active === 'settings') {
      panelMain.innerHTML = SETTINGS_MARKUP;
      bootSettings();
    } else {
      renderAnalyticsPlaceholder(active);
    }
  }

  function initApp() {
    if (appInitialized) { renderActiveTab(); return; }
    appInitialized = true;
    renderTabs();
    bootModal();
    window.addEventListener('hashchange', renderActiveTab);
    if (!location.hash) location.hash = TABS[0].id;
    renderActiveTab();
  }

  /* ============================================================
     SHARED PIECE STATE (Content Ops + Upload Files read/write the
     same underlying `pieces` store — one board, two views onto it)
     ============================================================ */

  var pieces = {};
  var piecesLoadedPromise = null;

  function ensurePiecesLoaded() {
    if (!piecesLoadedPromise) {
      piecesLoadedPromise = Store.getAll('pieces').then(function (rows) {
        rows.forEach(function (r) { pieces[r.id] = r; });
        return maybeSeedExamples();
      });
    }
    return piecesLoadedPromise;
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

  function minOrder(stageId) {
    var ids = orderedIds(stageId);
    if (!ids.length) return 0;
    return pieces[ids[0]].order || 0;
  }

  function nowIso() { return Store.nowIso(); }

  function fmtTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    var diff = Date.now() - d.getTime();
    var min = Math.round(diff / 60000);
    if (min < 1 && min > -1) return 'just now';
    if (min >= 0 && min < 60) return min + 'm ago';
    var hr = Math.round(min / 60);
    if (hr >= 0 && hr < 24) return hr + 'h ago';
    var day = Math.round(hr / 24);
    if (day >= 0 && day < 30) return day + 'd ago';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtFull(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function contentTypeOf(id) {
    return Store.CONTENT_TYPES.filter(function (c) { return c.id === id; })[0] || Store.CONTENT_TYPES[1];
  }

  function stageLabelOf(id) {
    var s = Store.STAGES.filter(function (s) { return s.id === id; })[0];
    return s ? s.label : id;
  }

  /* ---------- auto-scheduling ---------- */

  /* Once a piece has a video attached, its stage is no longer something
     Harvey drags around on the board — it's derived entirely from what's
     been done to it (audio picked, thumbnail picked, scheduled), and
     "live" is reserved for when real posting confirmation exists. */
  function deriveAndApplyStage(p) {
    if (!p.hasVideo || p.stage === 'live') return;
    var target = 'processed'; // "Processing" — a video piece never sits at "Uploaded", that column is the plan archive
    if (p.thumbnailDataUrl) target = 'thumbnail';
    if (p.scheduledAt) target = 'scheduled';
    p.stage = target;
  }

  function maybeAutoSchedule(p) {
    if (!(p.hasVideo && p.audioTrackId && p.thumbnailDataUrl && !p.scheduledAt)) return Promise.resolve();
    return Store.getSettings().then(function (settings) {
      var cfg = settings.cadence[p.contentType] || Store.DEFAULT_CADENCE[p.contentType] || { every: 1, unit: 'days' };
      var ms = Store.cadenceMs(cfg);
      var latest = null;
      Object.keys(pieces).forEach(function (id) {
        var o = pieces[id];
        if (o.id !== p.id && o.contentType === p.contentType && o.scheduledAt && (o.stage === 'scheduled' || o.stage === 'live')) {
          var t = new Date(o.scheduledAt).getTime();
          if (!latest || t > latest) latest = t;
        }
      });
      var base = latest || Date.now();
      p.scheduledAt = new Date(base + ms).toISOString();
    });
  }

  function setPieceStage(p, newStage, cb) {
    p.stage = newStage;
    p.updatedAt = nowIso();
    maybeAutoSchedule(p).then(function () {
      return Store.put('pieces', p);
    }).then(function () {
      if (cb) cb();
    });
  }

  /* ---------- seed examples (first run only) ---------- */

  var SEEDED_KEY = 'rm_content_ops_seeded';

  function maybeSeedExamples() {
    var alreadySeeded = false;
    try { alreadySeeded = localStorage.getItem(SEEDED_KEY) === '1'; } catch (e) {}
    if (Object.keys(pieces).length || alreadySeeded) return;
    var now = Date.now();
    var examples = [
      {
        title: 'Example — "Why I wrote The Reality Manual" origin story',
        stage: 'ideation', platforms: ['ytlong', 'instagram'], contentType: 'longform',
        notesHtml: 'Delete or edit me. Rough idea: talk-to-camera on the personal turning point behind the book.<br>Hook candidates:<br>— "I spent 3 years trying to disprove my own book"<br>— The night everything clicked'
      },
      {
        title: 'Example — Unboxing the linen hardcover',
        stage: 'outline_completed', platforms: ['tiktok', 'ytshort', 'instagram'], contentType: 'short',
        notesHtml: 'Delete or edit me. Beat sheet:<br>1. Package arrives<br>2. Slow reveal of dust jacket<br>3. Texture close-up on linen<br>4. First page open, close on epigraph'
      },
      {
        title: 'Example — 3 ideas from the book, explained in 60s each',
        stage: 'edited', platforms: ['ytshort', 'tiktok'], contentType: 'ultra_short',
        notesHtml: 'Delete or edit me. Edit is locked, waiting on audio pass.'
      }
    ];
    examples.forEach(function (ex, i) {
      ex.id = Store.genId();
      ex.order = 10;
      ex.hasVideo = false;
      ex.notesHtml = ex.notesHtml || '';
      ex.createdAt = new Date(now - (3 - i) * 3600000).toISOString();
      ex.updatedAt = ex.createdAt;
      pieces[ex.id] = ex;
      Store.put('pieces', ex);
    });
    try { localStorage.setItem(SEEDED_KEY, '1'); } catch (e) {}
  }

  /* ============================================================
     SHARED MODAL — opens for both Content Ops cards and
     Upload Files video cards; shows the Video section only when
     the piece has an uploaded video attached.
     ============================================================ */

  var modalWrap, pieceModal, scrim, fieldTitle, fieldStage, fieldContentType, fieldNotes,
      platformGrid, metaCreated, metaUpdated, saveFlag, modalEyebrowText, btnDelete,
      videoSection, videoPreview, fieldTranscript, fieldAudioTrack, thumbPreview,
      pickFrameBtn, thumbScrub, scrubRange, captureFrameBtn, captionReadout,
      utmField, fieldUtmLink, copyUtmBtn, scheduleStatus,
      stageField, stageReadoutField, stageReadout;

  var activeId = null;
  var isNewUnsaved = false;
  var saveTimer = null;
  var deleteArmed = false;
  var deleteArmTimer = null;
  var currentVideoObjectUrl = null;
  var modalBound = false;
  var onModalClosed = null; // optional callback set by whichever tab opened the modal

  function bootModal() {
    if (modalBound) return;
    modalBound = true;

    modalWrap = document.getElementById('modalWrap');
    pieceModal = document.getElementById('pieceModal');
    scrim = document.getElementById('scrim');
    fieldTitle = document.getElementById('fieldTitle');
    fieldStage = document.getElementById('fieldStage');
    fieldContentType = document.getElementById('fieldContentType');
    fieldNotes = document.getElementById('fieldNotes');
    platformGrid = document.getElementById('platformGrid');
    metaCreated = document.getElementById('metaCreated');
    metaUpdated = document.getElementById('metaUpdated');
    saveFlag = document.getElementById('saveFlag');
    modalEyebrowText = document.getElementById('modalEyebrowText');
    btnDelete = document.getElementById('btnDelete');

    videoSection = document.getElementById('videoSection');
    videoPreview = document.getElementById('videoPreview');
    fieldTranscript = document.getElementById('fieldTranscript');
    fieldAudioTrack = document.getElementById('fieldAudioTrack');
    thumbPreview = document.getElementById('thumbPreview');
    pickFrameBtn = document.getElementById('pickFrameBtn');
    thumbScrub = document.getElementById('thumbScrub');
    scrubRange = document.getElementById('scrubRange');
    captureFrameBtn = document.getElementById('captureFrameBtn');
    captionReadout = document.getElementById('captionReadout');
    utmField = document.getElementById('utmField');
    fieldUtmLink = document.getElementById('fieldUtmLink');
    copyUtmBtn = document.getElementById('copyUtmBtn');
    scheduleStatus = document.getElementById('scheduleStatus');
    stageField = document.getElementById('stageField');
    stageReadoutField = document.getElementById('stageReadoutField');
    stageReadout = document.getElementById('stageReadout');

    Store.STAGES.filter(function (s) { return MANUAL_STAGE_IDS.indexOf(s.id) !== -1; }).forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.id; o.textContent = s.label;
      fieldStage.appendChild(o);
    });
    Store.CONTENT_TYPES.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.id; o.textContent = c.label + ' (' + c.hint + ')';
      fieldContentType.appendChild(o);
    });
    Store.PLATFORMS.forEach(function (p) {
      var label = document.createElement('label');
      label.className = 'platform-toggle';
      label.dataset.platform = p.id;
      label.innerHTML = '<input type="checkbox" value="' + p.id + '"><span class="dot" style="background:' + p.color + '"></span>' + p.label;
      platformGrid.appendChild(label);
    });

    bindNotesPaste();

    [fieldTitle].forEach(function (el) {
      el.addEventListener('input', debounceSync);
      el.addEventListener('blur', function () { clearTimeout(saveTimer); syncFromForm(); });
    });
    fieldNotes.addEventListener('input', debounceSync);
    fieldNotes.addEventListener('blur', function () { clearTimeout(saveTimer); syncFromForm(); });
    fieldTranscript.addEventListener('input', debounceSync);
    fieldTranscript.addEventListener('blur', function () { clearTimeout(saveTimer); syncFromForm(); });
    fieldStage.addEventListener('change', function () { clearTimeout(saveTimer); syncFromForm(); });
    fieldContentType.addEventListener('change', function () { clearTimeout(saveTimer); syncFromForm(); });
    fieldAudioTrack.addEventListener('change', function () { clearTimeout(saveTimer); syncFromForm(); });
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

    pickFrameBtn.addEventListener('click', function () {
      thumbScrub.hidden = false;
      if (videoPreview.duration) scrubRange.max = videoPreview.duration;
    });
    videoPreview.addEventListener('loadedmetadata', function () {
      if (videoPreview.duration) scrubRange.max = videoPreview.duration;
    });
    scrubRange.addEventListener('input', function () {
      try { videoPreview.currentTime = parseFloat(scrubRange.value); } catch (e) {}
    });
    captureFrameBtn.addEventListener('click', function () {
      if (!activeId) return;
      var canvas = document.createElement('canvas');
      canvas.width = videoPreview.videoWidth || 640;
      canvas.height = videoPreview.videoHeight || 360;
      var ctx = canvas.getContext('2d');
      try { ctx.drawImage(videoPreview, 0, 0, canvas.width, canvas.height); } catch (e) { return; }
      var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      thumbPreview.innerHTML = '<img src="' + dataUrl + '" alt="" />';
      thumbScrub.hidden = true;
      var p = pieces[activeId];
      if (p) {
        p.thumbnailDataUrl = dataUrl;
        p.updatedAt = nowIso();
        maybeAutoSchedule(p).then(function () {
          deriveAndApplyStage(p);
          return Store.put('pieces', p);
        }).then(function () {
          updateStageAndScheduleUI(p);
          flashSaved();
          notifyPiecesChanged();
        });
      }
    });
    copyUtmBtn.addEventListener('click', function () {
      fieldUtmLink.select();
      try { document.execCommand('copy'); } catch (e) {}
    });

    btnDelete.addEventListener('click', function () {
      if (!activeId) return;
      if (isNewUnsaved) {
        delete pieces[activeId];
        var closingId1 = activeId;
        activeId = null; isNewUnsaved = false;
        hideModal();
        notifyPiecesChanged();
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
      var p = pieces[id];
      disarmDelete();
      delete pieces[id];
      Store.del('pieces', id);
      if (p && p.hasVideo) Store.del('videos', id);
      activeId = null;
      hideModal();
      notifyPiecesChanged();
    });

    document.getElementById('modalClose').addEventListener('click', closeModal);
    scrim.addEventListener('click', closeModal);
    modalWrap.addEventListener('click', function (e) { if (e.target === modalWrap) closeModal(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modalWrap.classList.contains('open')) closeModal();
    });
  }

  function notifyPiecesChanged() {
    if (typeof window.__rmOnPiecesChanged === 'function') window.__rmOnPiecesChanged();
  }

  function disarmDelete() {
    deleteArmed = false;
    clearTimeout(deleteArmTimer);
    btnDelete.textContent = 'Delete piece';
    btnDelete.classList.remove('armed');
  }

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

  function buildUtmLink(p, settings) {
    var base = (settings.baseLinkUrl || 'https://realitymanual.com').trim() || 'https://realitymanual.com';
    var source = (p.platforms || []).indexOf('facebook') !== -1 && (p.platforms || []).indexOf('ytlong') === -1 ? 'facebook' : 'youtube';
    var sep = base.indexOf('?') === -1 ? '?' : '&';
    return base + sep + 'utm_source=' + encodeURIComponent(source) + '&utm_medium=video&utm_campaign=' + encodeURIComponent(p.contentType || 'longform') + '&utm_content=' + encodeURIComponent(p.id);
  }

  function updateStageAndScheduleUI(p) {
    stageReadout.textContent = stageLabelOf(p.stage);
    if (p.stage === 'scheduled' && p.scheduledAt) {
      scheduleStatus.textContent = 'Scheduled for ' + fmtFull(p.scheduledAt);
    } else if (p.stage === 'live') {
      scheduleStatus.textContent = p.scheduledAt ? ('Posted ' + fmtFull(p.scheduledAt)) : 'Posted — connect an API in Settings to confirm.';
    } else if (!p.audioTrackId) {
      scheduleStatus.textContent = 'Pick a backing audio track, then a thumbnail, and this schedules itself.';
    } else if (!p.thumbnailDataUrl) {
      scheduleStatus.textContent = 'Audio picked — pick a thumbnail frame and this schedules itself.';
    } else {
      scheduleStatus.textContent = 'Ready — this will schedule itself shortly.';
    }
  }

  function populateFields(p) {
    fieldTitle.value = p.title || '';
    fieldContentType.value = p.contentType || 'short';
    stageField.hidden = !!p.hasVideo;
    stageReadoutField.hidden = !p.hasVideo;
    if (p.hasVideo) stageReadout.textContent = stageLabelOf(p.stage);
    else fieldStage.value = p.stage;
    fieldNotes.innerHTML = p.notesHtml || '';
    platformGrid.querySelectorAll('.platform-toggle').forEach(function (t) {
      var checked = (p.platforms || []).indexOf(t.dataset.platform) !== -1;
      t.classList.toggle('checked', checked);
      t.querySelector('input').checked = checked;
    });

    if (currentVideoObjectUrl) { URL.revokeObjectURL(currentVideoObjectUrl); currentVideoObjectUrl = null; }

    if (!p.hasVideo) {
      videoSection.hidden = true;
      videoPreview.removeAttribute('src');
      return Promise.resolve();
    }

    videoSection.hidden = false;
    thumbScrub.hidden = true;
    fieldTranscript.value = p.transcript || '';
    thumbPreview.innerHTML = p.thumbnailDataUrl ? ('<img src="' + p.thumbnailDataUrl + '" alt="" />') : '<span class="thumb-empty">No thumbnail yet</span>';
    utmField.hidden = p.contentType !== 'longform';
    updateStageAndScheduleUI(p);

    return Promise.all([
      Store.get('videos', p.id).then(function (v) {
        if (v && v.blob) {
          currentVideoObjectUrl = URL.createObjectURL(v.blob);
          videoPreview.src = currentVideoObjectUrl;
        }
      }),
      Store.getAll('audioTracks').then(function (tracks) {
        fieldAudioTrack.innerHTML = '<option value="">No audio track selected</option>' +
          tracks.map(function (t) { return '<option value="' + t.id + '"' + (t.id === p.audioTrackId ? ' selected' : '') + '>' + escapeHtml(t.name) + '</option>'; }).join('');
      }),
      Store.getSettings().then(function (settings) {
        captionReadout.textContent = settings.sharedCaption && settings.sharedCaption.trim() ? settings.sharedCaption : 'No shared caption set yet — add one in Settings.';
        fieldUtmLink.value = buildUtmLink(p, settings);
      })
    ]);
  }

  function openPiece(id, closedCb) {
    activeId = id;
    isNewUnsaved = false;
    onModalClosed = closedCb || null;
    disarmDelete();
    var p = pieces[id];
    if (!p) return;
    modalEyebrowText.textContent = 'Editing piece';
    populateFields(p).then(function () {
      metaCreated.textContent = 'Created ' + fmtFull(p.createdAt);
      metaUpdated.textContent = 'Updated ' + fmtFull(p.updatedAt);
      showModal();
      var hasNotes = fieldNotes.textContent.trim().length > 0 || !!fieldNotes.querySelector('img');
      var hasTitle = (p.title || '').trim().length > 0;
      setTimeout(function () {
        if (p.hasVideo) fieldTitle.focus();
        else if (hasNotes) focusEndEditable(fieldNotes);
        else if (hasTitle) focusEndInput(fieldTitle);
        else fieldTitle.focus();
      }, 200);
    });
  }

  function createDraft(stageId, closedCb) {
    var id = Store.genId();
    pieces[id] = {
      id: id, title: '', stage: stageId, platforms: [], contentType: 'short', notesHtml: '', hasVideo: false,
      order: minOrder(stageId) - 10,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    activeId = id;
    isNewUnsaved = true;
    onModalClosed = closedCb || null;
    disarmDelete();
    modalEyebrowText.textContent = 'New piece';
    populateFields(pieces[id]);
    metaCreated.textContent = 'Not yet saved';
    metaUpdated.textContent = '—';
    notifyPiecesChanged();
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
    if (currentVideoObjectUrl) { URL.revokeObjectURL(currentVideoObjectUrl); currentVideoObjectUrl = null; }
    var cb = onModalClosed; onModalClosed = null;
    if (cb) cb();
  }

  function currentFormValues() {
    var platforms = [];
    platformGrid.querySelectorAll('.platform-toggle').forEach(function (t) {
      if (t.querySelector('input').checked) platforms.push(t.dataset.platform);
    });
    var p = pieces[activeId];
    var vals = {
      title: fieldTitle.value,
      contentType: fieldContentType.value,
      notesHtml: fieldNotes.innerHTML,
      platforms: platforms
    };
    if (p && p.hasVideo) {
      vals.transcript = fieldTranscript.value;
      vals.audioTrackId = fieldAudioTrack.value;
    } else {
      vals.stage = fieldStage.value;
    }
    return vals;
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
        Store.put('pieces', p).then(function () { flashSaved(); notifyPiecesChanged(); });
      } else {
        notifyPiecesChanged();
      }
      return;
    }

    if (p.hasVideo) {
      utmField.hidden = p.contentType !== 'longform';
      if (!utmField.hidden) {
        Store.getSettings().then(function (settings) { fieldUtmLink.value = buildUtmLink(p, settings); });
      }
    }

    maybeAutoSchedule(p).then(function () {
      deriveAndApplyStage(p);
      return Store.put('pieces', p);
    }).then(function () {
      if (p.hasVideo) updateStageAndScheduleUI(p);
      flashSaved();
      notifyPiecesChanged();
    });
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
      if (isNewUnsaved) delete pieces[activeId];
    }
    activeId = null;
    isNewUnsaved = false;
    hideModal();
    notifyPiecesChanged();
  }

  /* ---------- paste-image support in notes ---------- */

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
          w = Math.round(w * scale); h = Math.round(h * scale);
        }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(image, 0, 0, w, h);
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
        if (items[i].type && items[i].type.indexOf('image') === 0) { imageFile = items[i].getAsFile(); break; }
      }
      if (imageFile) {
        e.preventDefault();
        downscaleImage(imageFile, function (dataUrl) { insertImageAtCursor(dataUrl); debounceSync(); });
        return;
      }
      e.preventDefault();
      var text = cd.getData('text/plain');
      document.execCommand('insertText', false, text);
    });
  }

  /* ============================================================
     CONTENT OPS — kanban board
     ============================================================ */

  var OPS_MARKUP =
    '<div class="ops-panel">' +
      '<div class="ops-toolbar">' +
        '<div class="ops-stats" id="statStrip"></div>' +
        '<button class="btn-primary" id="btnNew">+ New Piece</button>' +
      '</div>' +
      '<div class="overview-row" id="overviewRow"></div>' +
      '<div class="board-wrap" id="boardWrap"><div class="board" id="board"></div></div>' +
    '</div>';

  var board, statStrip, overviewRow, boardWrap, draggingId = null;

  function renderStats() {
    var total = Object.keys(pieces).length;
    var liveCount = orderedIds('live').length;
    var activeCount = total - liveCount;
    statStrip.innerHTML =
      '<span><span class="n">' + total + '</span>total</span>' +
      '<span><span class="n">' + activeCount + '</span>in motion</span>' +
      '<span><span class="n">' + liveCount + '</span>live</span>';
  }

  function renderOverview() {
    if (!overviewRow) return;
    var now = Date.now();
    var tiles = Store.CONTENT_TYPES.map(function (ct) {
      var items = Object.keys(pieces).map(function (k) { return pieces[k]; }).filter(function (p) { return p.contentType === ct.id && p.hasVideo; });
      var scheduled = items.filter(function (p) { return p.stage === 'scheduled'; });
      var live = items.filter(function (p) { return p.stage === 'live'; });
      var furthest = 0;
      scheduled.forEach(function (p) {
        if (p.scheduledAt) {
          var days = (new Date(p.scheduledAt).getTime() - now) / 86400000;
          if (days > furthest) furthest = days;
        }
      });
      return '<div class="overview-tile">' +
        '<div class="overview-tile-head"><span class="dot" style="background:' + ct.color + '"></span>' + ct.label + '</div>' +
        '<div class="overview-tile-stat"><span class="n">' + scheduled.length + '</span> scheduled</div>' +
        '<div class="overview-tile-sub">' + (scheduled.length ? furthest.toFixed(1) + ' days out' : 'nothing queued') + '</div>' +
        '<div class="overview-tile-sub2">' + live.length + ' posted</div>' +
      '</div>';
    }).join('');
    overviewRow.innerHTML = tiles + '<div class="overview-tile overview-errors" id="overviewErrorsTile"><div class="overview-tile-head">Errors</div><div class="overview-tile-stat"><span class="n" id="overviewErrorCount">0</span> logged</div><div class="overview-tile-sub">none yet — this fills in once posting is connected</div></div>';
    Store.getAll('errors').then(function (rows) {
      var el = document.getElementById('overviewErrorCount');
      if (el) el.textContent = rows.length;
    });
  }

  function chipHtml(piece) {
    var out = '';
    (piece.platforms || []).forEach(function (pid) {
      var p = Store.PLATFORMS.filter(function (x) { return x.id === pid; })[0];
      if (!p) return;
      out += '<span class="chip"><span class="dot" style="background:' + p.color + '"></span>' + p.label + '</span>';
    });
    var ct = contentTypeOf(piece.contentType);
    out += '<span class="chip format"><span class="dot" style="background:' + ct.color + '"></span>' + ct.label + '</span>';
    if (piece.hasVideo) out += '<span class="chip video-chip">▶ video</span>';
    return out;
  }

  function cardHtml(id, piece) {
    var title = (piece.title || '').trim();
    var titleHtml = title ? escapeHtml(title) : 'Untitled piece';
    var titleClass = title ? 'card-title' : 'card-title untitled';
    var isAuto = !!piece.hasVideo;
    var moveControl = isAuto
      ? '<span class="auto-stage-badge">Auto · ' + stageLabelOf(piece.stage) + '</span>'
      : (function () {
          var stageOpts = Store.STAGES.filter(function (s) { return MANUAL_STAGE_IDS.indexOf(s.id) !== -1; }).map(function (s) {
            return '<option value="' + s.id + '"' + (s.id === piece.stage ? ' selected' : '') + '>' + s.label + '</option>';
          }).join('');
          return '<select class="card-move" data-id="' + id + '">' + stageOpts + '</select>';
        })();
    return '' +
      '<div class="card' + (isAuto ? ' card-auto' : '') + '" draggable="' + (isAuto ? 'false' : 'true') + '" data-id="' + id + '">' +
        (isAuto ? '' : '<span class="card-grip">⋮⋮</span>') +
        '<div class="' + titleClass + '">' + titleHtml + '</div>' +
        '<div class="chip-row">' + chipHtml(piece) + '</div>' +
        '<div class="card-foot">' +
          '<span class="card-time">' + fmtTime(piece.updatedAt) + '</span>' +
          moveControl +
        '</div>' +
      '</div>';
  }

  function render() {
    var scrollLeft = boardWrap.scrollLeft;
    board.innerHTML = Store.STAGES.map(function (s, idx) {
      var ids = orderedIds(s.id);
      var isAutoCol = AUTO_STAGE_IDS.indexOf(s.id) !== -1;
      var cards = ids.map(function (id) { return cardHtml(id, pieces[id]); }).join('');
      if (!cards) cards = '<div class="empty-slot">' + (isAutoCol ? 'Nothing here yet' : 'Nothing here yet') + '</div>';
      var num = String(idx + 1).padStart(2, '0');
      return '' +
        '<div class="column' + (isAutoCol ? ' column-auto' : '') + '" data-stage="' + s.id + '">' +
          '<div class="column-head">' +
            '<span class="column-index">' + num + '</span>' +
            '<span class="column-title">' + s.label + '</span>' +
            '<span class="column-count">' + ids.length + '</span>' +
            (isAutoCol ? '<span class="column-auto-note">automatic</span>' : '') +
          '</div>' +
          '<div class="column-body" data-stage="' + s.id + '">' + cards + '</div>' +
          (isAutoCol ? '' : '<button class="column-add" data-stage="' + s.id + '">+ add here</button>') +
        '</div>';
    }).join('');
    boardWrap.scrollLeft = scrollLeft;
    renderStats();
    renderOverview();
    bindBoardEvents();
  }

  function bindBoardEvents() {
    board.querySelectorAll('.card').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.closest('.card-move')) return;
        openPiece(el.dataset.id, render);
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
        var p = pieces[sel.dataset.id];
        if (!p) return;
        p.order = maxOrder(sel.value) + 10;
        setPieceStage(p, sel.value, render);
      });
    });

    board.querySelectorAll('.column').forEach(function (col) {
      if (AUTO_STAGE_IDS.indexOf(col.dataset.stage) !== -1) return; // system-managed — never a manual drop target
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

        var draggedP = pieces[draggingId];
        siblingIds.forEach(function (id, i) {
          var p = pieces[id];
          if (!p) return;
          var newOrder = (i + 1) * 10;
          if (id === draggingId) {
            p.order = newOrder;
            setPieceStage(p, stageId, render);
          } else if (p.order !== newOrder) {
            p.order = newOrder;
            p.updatedAt = nowIso();
            Store.put('pieces', p);
          }
        });
        render();
      });
    });

    board.querySelectorAll('.column-add').forEach(function (btn) {
      btn.addEventListener('click', function () { createDraft(btn.dataset.stage, render); });
    });
  }

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

  function bootContentOps() {
    board = document.getElementById('board');
    statStrip = document.getElementById('statStrip');
    overviewRow = document.getElementById('overviewRow');
    boardWrap = document.getElementById('boardWrap');

    bindPanning();
    document.getElementById('btnNew').addEventListener('click', function () { createDraft('ideation', render); });

    window.__rmOnPiecesChanged = render;
    ensurePiecesLoaded().then(render);
    render();
  }

  /* ============================================================
     UPLOAD FILES
     ============================================================ */

  var UPLOAD_MARKUP =
    '<div class="upload-panel">' +
      '<div class="dropzone" id="dropzone">' +
        '<div class="dropzone-title">Drop edited videos here</div>' +
        '<div class="dropzone-sub">or click to browse — cuts and captions done, ready for audio + thumbnail</div>' +
        '<input type="file" id="fileInput" accept="video/*" multiple hidden />' +
      '</div>' +
      '<h3 class="upload-heading">In production</h3>' +
      '<div class="upload-grid" id="uploadGrid"></div>' +
      '<h3 class="upload-heading">Posted</h3>' +
      '<div class="upload-grid" id="postedGrid"></div>' +
    '</div>';

  var dropzone, fileInput, uploadGrid, postedGrid;

  function videoCardHtml(id, p) {
    var thumb = p.thumbnailDataUrl ? '<img src="' + p.thumbnailDataUrl + '" alt="" />' : '<span class="video-card-noThumb">No thumbnail</span>';
    var ct = contentTypeOf(p.contentType);
    var scheduledLine = p.scheduledAt ? (p.stage === 'live' ? 'Posted ' : 'Scheduled ') + fmtFull(p.scheduledAt) : '';
    return '<div class="video-card" data-id="' + id + '">' +
      '<div class="video-card-thumb">' + thumb + '</div>' +
      '<div class="video-card-body">' +
        '<div class="video-card-title">' + escapeHtml(p.title || 'Untitled') + '</div>' +
        '<div class="video-card-meta"><span class="chip format"><span class="dot" style="background:' + ct.color + '"></span>' + ct.label + '</span><span class="video-card-stage">' + stageLabelOf(p.stage) + '</span></div>' +
        (scheduledLine ? '<div class="video-card-sched">' + scheduledLine + '</div>' : '') +
      '</div>' +
    '</div>';
  }

  function renderUploadLists() {
    var items = Object.keys(pieces).map(function (k) { return pieces[k]; }).filter(function (p) { return p.hasVideo; });
    var inProgress = items.filter(function (p) { return p.stage !== 'live'; }).sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    var posted = items.filter(function (p) { return p.stage === 'live'; }).sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); });

    uploadGrid.innerHTML = inProgress.length ? inProgress.map(function (p) { return videoCardHtml(p.id, p); }).join('') : '<div class="empty-slot wide">Nothing uploaded yet — drop a video above.</div>';
    postedGrid.innerHTML = posted.length ? posted.map(function (p) { return videoCardHtml(p.id, p); }).join('') : '<div class="empty-slot wide">Nothing posted yet.</div>';

    [uploadGrid, postedGrid].forEach(function (grid) {
      grid.querySelectorAll('.video-card').forEach(function (el) {
        el.addEventListener('click', function () { openPiece(el.dataset.id, renderUploadLists); });
      });
    });
  }

  function handleFiles(fileList) {
    Array.prototype.slice.call(fileList).forEach(function (file) {
      if (file.type.indexOf('video') !== 0) return;
      var id = Store.genId();
      var piece = {
        id: id,
        title: file.name.replace(/\.[^.]+$/, ''),
        stage: 'processed', // "Processing" — a brand-new opportunity, not the same thing as any plan in "Uploaded"
        platforms: [],
        contentType: 'short',
        notesHtml: '',
        hasVideo: true,
        transcript: '',
        audioTrackId: '',
        thumbnailDataUrl: '',
        scheduledAt: '',
        order: maxOrder('processed') + 10,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      pieces[id] = piece;
      Store.put('videos', { id: id, fileName: file.name, blob: file, sizeBytes: file.size, createdAt: nowIso() });
      Store.put('pieces', piece).then(renderUploadLists);
    });
    renderUploadLists();
  }

  function bootUploadFiles() {
    dropzone = document.getElementById('dropzone');
    fileInput = document.getElementById('fileInput');
    uploadGrid = document.getElementById('uploadGrid');
    postedGrid = document.getElementById('postedGrid');

    dropzone.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () { handleFiles(fileInput.files); fileInput.value = ''; });
    ['dragenter', 'dragover'].forEach(function (evt) {
      dropzone.addEventListener(evt, function (e) { e.preventDefault(); dropzone.classList.add('drag-over'); });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      dropzone.addEventListener(evt, function (e) { e.preventDefault(); dropzone.classList.remove('drag-over'); });
    });
    dropzone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
    });

    window.__rmOnPiecesChanged = renderUploadLists;
    ensurePiecesLoaded().then(renderUploadLists);
    renderUploadLists();
  }

  /* ============================================================
     SETTINGS
     ============================================================ */

  var SETTINGS_MARKUP =
    '<div class="settings-panel">' +
      '<section class="settings-section">' +
        '<h3>Publishing cadence</h3>' +
        '<p class="settings-hint">How often each content type gets scheduled. A new piece queues up after whatever’s already scheduled for that type.</p>' +
        '<div class="cadence-grid" id="cadenceGrid"></div>' +
      '</section>' +
      '<section class="settings-section">' +
        '<h3>Ambient audio library</h3>' +
        '<p class="settings-hint">Backing tracks offered in the audio dropdown when editing an uploaded video.</p>' +
        '<label class="btn-secondary file-btn">Upload audio<input type="file" id="audioUpload" accept="audio/*" multiple hidden /></label>' +
        '<div class="audio-list" id="audioList"></div>' +
      '</section>' +
      '<section class="settings-section">' +
        '<h3>Shared caption</h3>' +
        '<p class="settings-hint">Applied to every upload — shown read-only on each piece, edited here.</p>' +
        '<textarea class="notes-input settings-textarea" id="captionInput" placeholder="Caption text..."></textarea>' +
      '</section>' +
      '<section class="settings-section">' +
        '<h3>Longform link</h3>' +
        '<p class="settings-hint">Base URL used to build the UTM-tracked link for longform descriptions.</p>' +
        '<input class="title-input settings-input" id="baseLinkInput" />' +
      '</section>' +
      '<section class="settings-section">' +
        '<h3>API keys</h3>' +
        '<p class="settings-hint warn">Stored only in this browser’s local storage, never sent anywhere — there’s no backend wired up to use them yet. TikTok access still needs approving; the field is here for when it does.</p>' +
        '<div class="key-grid" id="keyGrid"></div>' +
      '</section>' +
    '</div>';

  var KEY_FIELDS = [
    { id: 'youtube', label: 'YouTube' },
    { id: 'instagram', label: 'Instagram' },
    { id: 'facebook', label: 'Facebook' },
    { id: 'tiktok', label: 'TikTok (pending access)' },
    { id: 'transcriptionProvider', label: 'Transcription provider', placeholder: 'e.g. AssemblyAI, Deepgram, Whisper' },
    { id: 'transcriptionKey', label: 'Transcription API key', type: 'password' }
  ];

  var settingsCache = null;
  var settingsSaveTimer = null;

  function saveSettingsDebounced() {
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = setTimeout(function () { Store.saveSettings(settingsCache); }, 400);
  }

  function renderCadenceGrid() {
    var grid = document.getElementById('cadenceGrid');
    grid.innerHTML = Store.CONTENT_TYPES.map(function (ct) {
      var cfg = settingsCache.cadence[ct.id];
      return '<div class="cadence-row" data-type="' + ct.id + '">' +
        '<span class="cadence-label"><span class="dot" style="background:' + ct.color + '"></span>' + ct.label + ' <span class="ink-faint">(' + ct.hint + ')</span></span>' +
        '<span class="cadence-inputs">1 every <input type="number" min="1" step="1" class="cadence-every" value="' + cfg.every + '" /> ' +
        '<select class="cadence-unit"><option value="hours"' + (cfg.unit === 'hours' ? ' selected' : '') + '>hours</option><option value="days"' + (cfg.unit === 'days' ? ' selected' : '') + '>days</option></select></span>' +
      '</div>';
    }).join('');
    grid.querySelectorAll('.cadence-row').forEach(function (row) {
      var type = row.dataset.type;
      row.querySelector('.cadence-every').addEventListener('input', function (e) {
        settingsCache.cadence[type].every = Math.max(1, parseInt(e.target.value, 10) || 1);
        saveSettingsDebounced();
      });
      row.querySelector('.cadence-unit').addEventListener('change', function (e) {
        settingsCache.cadence[type].unit = e.target.value;
        saveSettingsDebounced();
      });
    });
  }

  var audioListObjectUrls = [];

  function renderAudioList() {
    var list = document.getElementById('audioList');
    audioListObjectUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    audioListObjectUrls = [];
    Store.getAll('audioTracks').then(function (tracks) {
      if (!tracks.length) { list.innerHTML = '<div class="empty-slot wide">No ambient tracks yet.</div>'; return; }
      list.innerHTML = tracks.map(function (t) {
        var url = URL.createObjectURL(t.blob);
        audioListObjectUrls.push(url);
        return '<div class="audio-row" data-id="' + t.id + '">' +
          '<span class="audio-name">' + escapeHtml(t.name) + '</span>' +
          '<audio controls preload="none" src="' + url + '"></audio>' +
          '<button type="button" class="link-btn audio-delete" data-id="' + t.id + '">Delete</button>' +
        '</div>';
      }).join('');
      list.querySelectorAll('.audio-delete').forEach(function (btn) {
        btn.addEventListener('click', function () {
          Store.del('audioTracks', btn.dataset.id).then(renderAudioList);
        });
      });
    });
  }

  function renderKeyGrid() {
    var grid = document.getElementById('keyGrid');
    grid.innerHTML = KEY_FIELDS.map(function (f) {
      return '<div class="key-row">' +
        '<label for="key-' + f.id + '">' + f.label + '</label>' +
        '<input type="' + (f.type || 'text') + '" id="key-' + f.id + '" placeholder="' + (f.placeholder || '') + '" />' +
      '</div>';
    }).join('');
    KEY_FIELDS.forEach(function (f) {
      var input = document.getElementById('key-' + f.id);
      input.value = settingsCache.apiKeys[f.id] || '';
      input.addEventListener('input', function () {
        settingsCache.apiKeys[f.id] = input.value;
        saveSettingsDebounced();
      });
    });
  }

  function bootSettings() {
    Store.getSettings().then(function (settings) {
      settingsCache = settings;
      renderCadenceGrid();
      renderAudioList();
      renderKeyGrid();

      var captionInput = document.getElementById('captionInput');
      captionInput.value = settings.sharedCaption || '';
      captionInput.addEventListener('input', function () {
        settingsCache.sharedCaption = captionInput.value;
        saveSettingsDebounced();
      });

      var baseLinkInput = document.getElementById('baseLinkInput');
      baseLinkInput.value = settings.baseLinkUrl || '';
      baseLinkInput.addEventListener('input', function () {
        settingsCache.baseLinkUrl = baseLinkInput.value;
        saveSettingsDebounced();
      });

      var audioUpload = document.getElementById('audioUpload');
      audioUpload.addEventListener('change', function () {
        Array.prototype.slice.call(audioUpload.files).forEach(function (file) {
          Store.put('audioTracks', { id: Store.genId(), name: file.name, blob: file, createdAt: nowIso() });
        });
        audioUpload.value = '';
        setTimeout(renderAudioList, 200);
      });
    });
  }

  // Runs last, after OPS_MARKUP/UPLOAD_MARKUP/SETTINGS_MARKUP and all boot*
  // functions above are defined — calling this any earlier (it used to sit
  // right after the login form wiring) crashes on any visit where the
  // session check below resolves true, since showApp() renders a tab
  // immediately using markup that doesn't exist yet.
  Auth.checkSession().then(function (ok) { if (ok) showApp(); else showLogin(); });
})();
