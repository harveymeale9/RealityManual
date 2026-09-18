(function () {
  'use strict';

  var Store = window.RMStore;
  var Auth = window.RMAuth;

  var UPLOADED_INDEX = window.RMStore.STAGES.map(function (s) { return s.id; }).indexOf('uploaded');
  var MANUAL_STAGE_IDS = window.RMStore.STAGES.slice(0, UPLOADED_INDEX + 1).map(function (s) { return s.id; });
  var AUTO_STAGE_IDS = window.RMStore.STAGES.slice(UPLOADED_INDEX + 1).map(function (s) { return s.id; });

  // Platform preset applied when the content-type dropdown changes in the
  // editor, per Harvey: shorts default to everywhere except YT Longform,
  // longform defaults to just YT Longform + Facebook. Only fires on an
  // actual change during editing (see fieldContentType's change listener),
  // never on populateFields() for an already-saved piece.
  var PLATFORM_PRESET_BY_TYPE = {
    ultra_short: ['ytshort', 'tiktok', 'instagram', 'facebook'],
    short: ['ytshort', 'tiktok', 'instagram', 'facebook'],
    long_short: ['ytshort', 'tiktok', 'instagram', 'facebook'],
    longform: ['ytlong', 'facebook']
  };

  // Live across tab (re)activations so bootProjectManager can stop a prior
  // poller before starting a new one — panelMain.innerHTML gets wiped and
  // rebuilt every time this tab is (re)entered, which would otherwise leak
  // one extra setTimeout chain per visit.
  var pmSync = null;

  var TABS = [
    { id: 'project-manager', label: 'Project Manager' },
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
  var sideRail = document.getElementById('sideRail');

  function currentTabId() {
    var h = (location.hash || '').replace('#', '');
    var match = TABS.filter(function (t) { return t.id === h; })[0];
    return match ? match.id : TABS[0].id;
  }

  function renderTabs() {
    // Real <a href="#tab"> rather than a <button> with a click handler —
    // a button has no URL, so middle-click/ctrl+click "open in new tab"
    // silently does nothing on it (Harvey's report). An anchor gets that
    // for free from the browser; the click listener below still runs for
    // an ordinary left-click, same behavior as before.
    panelTabs.innerHTML = TABS.map(function (t) {
      return '<a href="#' + t.id + '" class="panel-tab" data-tab="' + t.id + '">' + t.label + '</a>';
    }).join('');
    panelTabs.querySelectorAll('.panel-tab[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () { location.hash = btn.dataset.tab; });
    });
  }

  /* The left icon rail is a second entry point into the same tabs above —
     it doesn't have its own state, just mirrors panelTabs via the same
     location.hash routing so the two navs can never disagree. Its buttons
     are real <a href="#tab"> in index.html for the same middle-click/
     new-tab reason as renderTabs() above. */
  function bindSideRail() {
    if (!sideRail) return;
    sideRail.querySelectorAll('.side-rail-btn[data-tab]').forEach(function (btn) {
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

  // The storefront's own backend — separate service, separate domain (see
  // CLAUDE.md §62/§65). Read-only, unauthenticated aggregate counts, no PII.
  var STOREFRONT_API_BASE = 'https://api.realitymanual.com';

  function renderWebsiteAnalytics() {
    panelMain.innerHTML = '<div class="tab-placeholder wide"><div class="eyebrow">Loading…</div><h2>Website Analytics</h2></div>';
    fetch(STOREFRONT_API_BASE + '/api/analytics/summary')
      .then(function (res) { if (!res.ok) throw new Error('bad_status'); return res.json(); })
      .then(function (data) {
        if (currentTabId() !== 'website-analytics') return; // navigated away before this resolved

        var funnelRows = data.funnel.map(function (f) {
          return '<div class="funnel-row"><span class="funnel-step">' + escapeHtml(f.step.replace(/_/g, ' ')) + '</span>' +
            '<span class="funnel-count">' + f.count + '</span><span class="funnel-sessions">' + f.unique_sessions + ' sessions</span></div>';
        }).join('');

        var utmRows = data.top_utm_sources.length
          ? data.top_utm_sources.map(function (u) {
              return '<div class="funnel-row"><span class="funnel-step">' + escapeHtml(u.source) + '</span><span class="funnel-sessions">' + u.sessions + ' sessions</span></div>';
            }).join('')
          : '<div class="empty-slot">No UTM-tagged traffic yet</div>';

        panelMain.innerHTML =
          '<div class="ops-panel">' +
            '<div class="overview-row">' +
              '<div class="overview-tile"><div class="overview-tile-head">Today</div>' +
                '<div class="overview-tile-stat"><span class="n">' + data.today.page_views + '</span> page views</div>' +
                '<div class="overview-tile-sub">' + data.today.unique_visitors + ' unique visitors</div></div>' +
              '<div class="overview-tile"><div class="overview-tile-head">Last 30 days</div>' +
                '<div class="overview-tile-stat"><span class="n">' + data.last_30_days.page_views + '</span> page views</div>' +
                '<div class="overview-tile-sub">' + data.last_30_days.unique_visitors + ' unique visitors</div></div>' +
            '</div>' +
            '<div class="funnel-section">' +
              '<div class="eyebrow">Funnel — last 30 days</div>' +
              '<div class="funnel-list">' + funnelRows + '</div>' +
            '</div>' +
            '<div class="funnel-section">' +
              '<div class="eyebrow">Top UTM sources — last 30 days</div>' +
              '<div class="funnel-list">' + utmRows + '</div>' +
            '</div>' +
          '</div>';
      })
      .catch(function () {
        if (currentTabId() !== 'website-analytics') return;
        renderAnalyticsPlaceholder('website-analytics');
      });
  }

  function renderActiveTab() {
    var active = currentTabId();
    panelTabs.querySelectorAll('.panel-tab').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.tab === active);
    });
    if (sideRail) {
      sideRail.querySelectorAll('.side-rail-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.tab === active);
      });
    }
    var backFab = document.getElementById('pmBackFab');
    if (backFab) backFab.classList.toggle('show', active !== 'project-manager');
    if (active !== 'project-manager' && pmSync) { pmSync.stop(); pmSync = null; }
    if (active === 'project-manager') {
      panelMain.innerHTML = PM_MARKUP;
      bootProjectManager();
    } else if (active === 'content-ops') {
      panelMain.innerHTML = OPS_MARKUP;
      bootContentOps();
    } else if (active === 'upload-files') {
      panelMain.innerHTML = UPLOAD_MARKUP;
      bootUploadFiles();
    } else if (active === 'settings') {
      panelMain.innerHTML = SETTINGS_MARKUP;
      bootSettings();
    } else if (active === 'website-analytics') {
      renderWebsiteAnalytics();
    } else {
      renderAnalyticsPlaceholder(active);
    }
  }

  function initApp() {
    if (appInitialized) { renderActiveTab(); return; }
    appInitialized = true;
    renderTabs();
    bindSideRail();
    bootModal();
    window.addEventListener('hashchange', renderActiveTab);
    if (!location.hash) location.hash = TABS[0].id;
    renderActiveTab();
  }

  /* ============================================================
     PROJECT MANAGER (chat with CC) — the default tab. Talks to the same
     backend voice/chat endpoints as voice-mobile.html, via the shared
     lib/voiceClient.js client. panelMain is rebuilt fresh every time this
     tab is (re)activated, same as every other tab here, so the visible
     thread only shows messages sent during the current activation — the
     conversation itself is never lost, it lives server-side (see
     CLAUDE.md §74/§75).
     ============================================================ */

  var PM_MARKUP =
    '<div class="pm-app">' +
      '<div class="pm-toolbar">' +
        '<a class="link-btn" id="pmMobileLink" href="voice-mobile.html" target="_blank" rel="noopener">Mobile view ↗</a>' +
        '<button type="button" class="pm-reset-btn" id="pmResetBtn">New conversation</button>' +
      '</div>' +
      '<div class="pm-columns">' +
        '<div class="pm-col pm-col-clean">' +
          '<div class="pm-thread" id="pmThread">' +
            '<div class="pm-empty">Type or speak to Claude Code — same project, same tools, full memory of RealityManual.</div>' +
          '</div>' +
          '<div class="pm-inputbar">' +
            '<div class="pm-image-preview" id="pmImagePreview" hidden></div>' +
            '<div class="pm-input-row">' +
              '<button type="button" class="pm-mic-btn" id="pmMicBtn" title="Record voice message" aria-label="Record voice message">' +
                '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/></svg>' +
              '</button>' +
              '<textarea id="pmTextInput" class="pm-textarea" rows="1" placeholder="Message Claude Code… (paste or drop an image too)"></textarea>' +
              '<button type="button" class="pm-send-btn" id="pmSendBtn" title="Send" aria-label="Send">' +
                '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4Z"/></svg>' +
              '</button>' +
            '</div>' +
            '<div class="pm-hint">Voice replies are spoken automatically. Typed replies show as text — tap ▶ to hear one.</div>' +
          '</div>' +
        '</div>' +
        '<div class="pm-col pm-col-activity">' +
          '<div class="pm-queue-section">' +
            '<div class="pm-activity-head">Queue <span class="pm-activity-hint" id="pmQueueHint"></span></div>' +
            '<div class="pm-queue-list" id="pmQueueList"><div class="pm-queue-empty">Nothing queued.</div></div>' +
          '</div>' +
          '<div class="pm-activity-section">' +
            '<div class="pm-activity-head">Activity <span class="pm-activity-hint">— what CC is doing, live</span></div>' +
            '<div class="pm-activity" id="pmActivity"><div class="pm-activity-empty" id="pmActivityEmpty">Nothing happening yet.</div></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  // How long to wait after sending a voice-originated question before
  // speaking a "got it, working on it" ack — canceled if the real reply
  // beats it (the common case: a quick question just gets its answer
  // spoken directly, no redundant ack first). If the ack does fire, the
  // real reply lands as text only, never spoken late — see onDone below.
  // 10s comfortably clears normal quick-question latency (observed ~5-6s
  // end to end) without making Harvey wait through a task that's
  // genuinely going to take minutes before hearing anything at all.
  var VOICE_ACK_DELAY_MS = 10000;
  // Neutral on purpose — this plays before CC knows whether the message
  // turns out to be a task or an actual question, so it can't presume
  // "I'll get to work on that" framing (Harvey: that phrasing is only
  // right for a genuine task, and it was playing for real questions too,
  // which then never got a spoken answer at all — see onDone below).
  var RESPOND_ACK_TEXT = 'Still working on that — I’ll have an answer for you in just a moment.';
  var EXECUTE_ACK_TEXT = 'Got it — I’ll take care of that now.';

  function bootProjectManager() {
    var Voice = window.RMVoice;
    var thread = document.getElementById('pmThread');
    var activityEl = document.getElementById('pmActivity');
    var queueListEl = document.getElementById('pmQueueList');
    var queueHintEl = document.getElementById('pmQueueHint');
    var textInput = document.getElementById('pmTextInput');
    var sendBtn = document.getElementById('pmSendBtn');
    var micBtn = document.getElementById('pmMicBtn');
    var resetBtn = document.getElementById('pmResetBtn');
    var imagePreviewEl = document.getElementById('pmImagePreview');
    var inputRow = textInput.closest('.pm-input-row');

    if (pmSync) { pmSync.stop(); pmSync = null; }

    var emptyNote = thread.querySelector('.pm-empty');
    function clearEmptyNote() { if (emptyNote && emptyNote.parentNode) { emptyNote.parentNode.removeChild(emptyNote); emptyNote = null; } }

    function replyToSnippet(replyToText) {
      return 'Re: ' + (replyToText.length > 80 ? replyToText.slice(0, 80) + '…' : replyToText);
    }
    function addMessage(kind, text, msgId, imageFile, replyToText) {
      clearEmptyNote();
      var el = document.createElement('div');
      el.className = 'pm-msg pm-msg-' + kind;
      if (msgId) el.dataset.msgId = msgId;
      if (!imageFile && !replyToText) {
        el.textContent = text;
        thread.appendChild(el);
        thread.scrollTop = thread.scrollHeight;
        return el;
      }
      if (replyToText) {
        var replyTo = document.createElement('div');
        replyTo.className = 'pm-msg-replyto';
        replyTo.textContent = replyToSnippet(replyToText);
        el.appendChild(replyTo);
      }
      if (imageFile) {
        var img = document.createElement('img');
        img.className = 'pm-msg-image';
        var reader = new FileReader();
        reader.onload = function () { img.src = reader.result; };
        reader.readAsDataURL(imageFile);
        el.appendChild(img);
      }
      if (text) {
        var textEl = document.createElement('div');
        if (imageFile) textEl.className = 'pm-msg-caption';
        textEl.textContent = text;
        el.appendChild(textEl);
      }
      thread.appendChild(el);
      thread.scrollTop = thread.scrollHeight;
      return el;
    }

    function addAssistantMessage(text, replyToText) {
      clearEmptyNote();
      var isAction = /^\[NEEDS_ACTION\]/i.test(text || '');
      var wrap = document.createElement('div');
      wrap.className = 'pm-msg pm-msg-assistant' + (isAction ? ' pm-msg-assistant--action' : '');
      if (replyToText) {
        var replyTo = document.createElement('div');
        replyTo.className = 'pm-msg-replyto';
        replyTo.textContent = replyToSnippet(replyToText);
        wrap.appendChild(replyTo);
      }
      var body = document.createElement('div');
      body.appendChild(Voice.renderMarkdownLite(text || ''));
      wrap.appendChild(body);
      var meta = document.createElement('div');
      meta.className = 'pm-msg-meta';
      var playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'pm-play-btn';
      playBtn.textContent = '▶ Play';
      var playing = false;
      function resetPlayBtn() { playing = false; playBtn.textContent = '▶ Play'; playBtn.classList.remove('pm-stop-btn'); }
      playBtn.addEventListener('click', function () {
        if (playing) { Voice.stopSpeaking(); resetPlayBtn(); return; }
        Voice.speak(text).then(function (audio) {
          if (!audio) return;
          playing = true;
          playBtn.textContent = '■ Stop';
          playBtn.classList.add('pm-stop-btn');
          audio.addEventListener('ended', resetPlayBtn);
        }).catch(function () {});
      });
      meta.appendChild(playBtn);
      wrap.appendChild(meta);
      thread.appendChild(wrap);
      thread.scrollTop = thread.scrollHeight;
      return wrap;
    }

    // --- Image attach: paste into the textarea or drop onto the input row.
    // Desktop only needs these two per Harvey (no dedicated button) — a
    // visible attach button is the mobile-specific gap (no paste gesture
    // there), added in voice-mobile.html instead.
    var pendingImage = null;
    function clearPendingImage() {
      pendingImage = null;
      imagePreviewEl.hidden = true;
      imagePreviewEl.innerHTML = '';
    }
    function setPendingImage(file) {
      pendingImage = file;
      var reader = new FileReader();
      reader.onload = function () {
        imagePreviewEl.innerHTML = '';
        var img = document.createElement('img');
        img.src = reader.result;
        imagePreviewEl.appendChild(img);
        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'pm-image-preview-remove';
        removeBtn.textContent = 'Remove image';
        removeBtn.addEventListener('click', clearPendingImage);
        imagePreviewEl.appendChild(removeBtn);
        imagePreviewEl.hidden = false;
      };
      reader.readAsDataURL(file);
    }
    textInput.addEventListener('paste', function (e) {
      var items = (e.clipboardData && e.clipboardData.items) || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image/') === 0) {
          var file = items[i].getAsFile();
          if (file) { setPendingImage(file); e.preventDefault(); }
          break;
        }
      }
    });
    if (inputRow) {
      inputRow.addEventListener('dragover', function (e) { e.preventDefault(); inputRow.classList.add('pm-drag-over'); });
      inputRow.addEventListener('dragleave', function () { inputRow.classList.remove('pm-drag-over'); });
      inputRow.addEventListener('drop', function (e) {
        e.preventDefault();
        inputRow.classList.remove('pm-drag-over');
        var files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length && files[0].type.indexOf('image/') === 0) setPendingImage(files[0]);
      });
    }

    // --- Queue panel: every poll gets the full current window of rows
    // (see lib/voiceClient.js syncThread's onTick), so this just re-derives
    // the in-flight + recently-completed lists from scratch each tick
    // rather than diffing. Completed items are shown too (not just
    // pending/running) so Harvey has a short trail of what CC just
    // finished, capped at RECENT_DONE_LIMIT and visually distinct from
    // what's actively running — older completions just fall off the
    // bottom rather than piling up.
    var RECENT_DONE_LIMIT = 5;
    function renderQueue(rows) {
      var inflight = rows.filter(function (r) { return r.status === 'pending' || r.status === 'running'; }).slice().reverse();
      var recentDone = rows.filter(function (r) { return r.status === 'done' || r.status === 'error'; })
        .slice()
        .sort(function (a, b) { return new Date(b.completed_at || b.created_at) - new Date(a.completed_at || a.created_at); })
        .slice(0, RECENT_DONE_LIMIT);
      queueListEl.innerHTML = '';
      if (!inflight.length && !recentDone.length) {
        queueHintEl.textContent = '';
        var empty = document.createElement('div');
        empty.className = 'pm-queue-empty';
        empty.textContent = 'Nothing queued.';
        queueListEl.appendChild(empty);
        return;
      }
      queueHintEl.textContent = inflight.length ? '— ' + inflight.length + ' in progress' : '';
      inflight.forEach(function (row, idx) {
        var item = document.createElement('div');
        item.className = 'pm-queue-item' + (row.status === 'running' ? ' pm-queue-active' : '');
        var num = document.createElement('span');
        num.className = 'pm-queue-num';
        num.textContent = (idx + 1) + '/' + inflight.length;
        var textEl = document.createElement('span');
        textEl.className = 'pm-queue-text';
        textEl.textContent = row.early_ack || row.transcript;
        item.appendChild(num);
        item.appendChild(textEl);
        queueListEl.appendChild(item);
      });
      if (recentDone.length) {
        var divider = document.createElement('div');
        divider.className = 'pm-queue-divider';
        divider.textContent = 'Recently completed';
        queueListEl.appendChild(divider);
        recentDone.forEach(function (row) {
          var item = document.createElement('div');
          item.className = 'pm-queue-item ' + (row.status === 'error' ? 'pm-queue-failed' : 'pm-queue-done');
          var mark = document.createElement('span');
          mark.className = 'pm-queue-num';
          mark.textContent = row.status === 'error' ? '✕' : '✓';
          var textEl = document.createElement('span');
          textEl.className = 'pm-queue-text';
          textEl.textContent = row.early_ack || row.transcript;
          item.appendChild(mark);
          item.appendChild(textEl);
          queueListEl.appendChild(item);
        });
      }
    }

    function addTyping(msgId) {
      clearEmptyNote();
      var el = document.createElement('div');
      el.className = 'pm-typing';
      if (msgId) el.dataset.msgId = msgId;
      el.textContent = 'CC is working on it…';
      thread.appendChild(el);
      thread.scrollTop = thread.scrollHeight;
      return el;
    }

    function removeTyping(msgId) {
      var el = thread.querySelector('.pm-typing[data-msg-id="' + msgId + '"]');
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    // Right-hand "code-like" pane — the raw tool-call/thinking trail, kept
    // deliberately separate from the clean thread on the left per Harvey:
    // this is the stuff he'll mostly ignore, not the stuff he reads.
    function renderActivity(lines) {
      activityEl.innerHTML = '';
      if (!lines || !lines.length) {
        var empty = document.createElement('div');
        empty.className = 'pm-activity-empty';
        empty.textContent = 'Nothing happening yet.';
        activityEl.appendChild(empty);
        return;
      }
      lines.forEach(function (line) {
        var el = document.createElement('div');
        el.className = 'pm-activity-line';
        el.textContent = line;
        activityEl.appendChild(el);
      });
      activityEl.scrollTop = activityEl.scrollHeight;
    }

    // Ids this device sent via voice on itself and wants spoken aloud once
    // the reply lands — never applied to a reply that shows up because
    // another device (or an earlier page load) triggered it. Each entry's
    // ackTimer speaks a "got it, working on it" ack if the real reply
    // hasn't landed within VOICE_ACK_DELAY_MS; ackFired records whether
    // that happened, so onDone knows whether the real reply should still
    // be spoken (fast turn, ack never fired) or stay text-only (ack
    // already covered it — speaking the real answer too, possibly minutes
    // later, is exactly what Harvey asked NOT to happen).
    var voiceAck = {};

    // The single source of truth for the thread: on first tick it loads
    // whatever's already in the table (so opening this tab resumes the last
    // conversation instead of a blank slate), and on every tick after it
    // picks up anything new — including messages sent from the phone app
    // while this tab just sits open. Locally-sent messages are rendered
    // optimistically by sendText() below and handed to markKnown() so this
    // loop updates them in place instead of duplicating them.
    // The very first tick replays the whole existing history through
    // onDone/onError (that's what makes opening this tab resume the last
    // conversation) — pinging for every one of those on load would be a
    // burst of chimes, not a notification. onTick fires once per tick,
    // after that tick's onDone/onError calls, so flipping this true there
    // suppresses exactly (and only) the first tick's replay.
    var pastFirstTick = false;

    pmSync = Voice.syncThread({
      onNewMessage: function (row) { addMessage('user', row.transcript, row.id); },
      onPending: function (row) { addTyping(row.id); },
      onEarlyAck: function (row) {
        // Swap the generic "CC is working on it…" placeholder for CC's own
        // real, contextual first line the moment it's available — visible
        // even for a typed/no-speech send, not just spoken.
        var typingEl = thread.querySelector('.pm-typing[data-msg-id="' + row.id + '"]');
        if (typingEl) typingEl.textContent = row.early_ack;
        var ack = voiceAck[row.id];
        if (!ack || ack.fired) return;
        ack.fired = true;
        ack.spokenText = row.early_ack;
        clearTimeout(ack.timer);
        Voice.speak(row.early_ack).catch(function () {});
      },
      onDone: function (row) {
        removeTyping(row.id);
        // Execute-mode replies are a real completion summary now (see
        // server.js buildVoicePrompt), not a throwaway line — show it like
        // any other reply instead of a generic "Done" placeholder.
        addAssistantMessage(row.reply_text || '', row.transcript);
        if (pastFirstTick && Voice.isActiveHere()) Voice.playPing();
        var ack = voiceAck[row.id];
        if (ack) {
          clearTimeout(ack.timer);
          delete voiceAck[row.id];
          // Always speak the real answer here, whether or not an ack
          // already fired — a question sent by voice deserves an actual
          // spoken answer, not silence (text-only) just because it took a
          // while to investigate. Skip only if the early ack we already
          // spoke turned out to BE the complete final answer verbatim (a
          // turn with no tool calls) — otherwise this would say the exact
          // same sentence twice in a row.
          var replyText = row.reply_text || '';
          var alreadySaidIt = ack.spokenText && replyText.trim() === ack.spokenText.trim();
          if (!alreadySaidIt) Voice.speak(replyText).catch(function () {});
        }
      },
      onError: function (row) {
        removeTyping(row.id);
        addMessage('error', row.error_message || 'Something went wrong.', null, null, row.transcript);
        if (pastFirstTick && Voice.isActiveHere()) Voice.playPing();
        var ack = voiceAck[row.id];
        if (ack) {
          clearTimeout(ack.timer);
          delete voiceAck[row.id];
          Voice.speak(row.error_message || 'Something went wrong.').catch(function () {});
        }
      },
      onActivity: function (row) { renderActivity(row.activity_log); },
      onTick: function (rows) { renderQueue(rows); pastFirstTick = true; }
    });

    // fired/spokenText: whichever comes first — CC's own real early_ack
    // (onEarlyAck above, the common case) or this timeout's generic
    // fallback phrase (only if early_ack somehow never showed up in time)
    // — claims the "something has now been said" slot so the other path
    // never also speaks on top of it.
    function scheduleVoiceAck(id, mode) {
      var entry = { fired: false, timer: null, spokenText: null };
      entry.timer = setTimeout(function () {
        entry.fired = true;
        entry.spokenText = mode === 'execute' ? EXECUTE_ACK_TEXT : RESPOND_ACK_TEXT;
        Voice.speak(entry.spokenText).catch(function () {});
      }, VOICE_ACK_DELAY_MS);
      voiceAck[id] = entry;
    }

    function sendText(text, mode, opts) {
      opts = opts || {};
      var autoSpeak = !!opts.autoSpeak;
      var image = opts.image || null;
      if (!text.trim() && !image) return;
      addMessage('user', text.trim(), null, image);
      var typingEl = addTyping();
      renderActivity(null);
      Voice.sendMessage(text.trim(), mode, image).then(function (created) {
        typingEl.dataset.msgId = created.id;
        if (autoSpeak) scheduleVoiceAck(created.id, mode);
        pmSync.markKnown(created);
      }).catch(function (err) {
        if (typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
        addMessage('error', (err && err.message) || 'Something went wrong.');
      });
    }

    // Typing means "reply in text" by default — voice is only for when
    // Harvey actually spoke. Exception per Harvey: if his immediately
    // preceding message was itself sent by voice, a quick typed follow-up
    // (e.g. fixing a misheard word) still gets a spoken reply too, so the
    // conversation doesn't abruptly go silent mid-voice-exchange. One-shot:
    // this resets to text-only after the typed message, not sticky forever.
    var lastSendWasVoice = false;

    sendBtn.addEventListener('click', function () {
      var text = textInput.value;
      var image = pendingImage;
      textInput.value = '';
      textInput.style.height = 'auto';
      var carryVoice = lastSendWasVoice;
      lastSendWasVoice = false;
      clearPendingImage();
      sendText(text, 'respond', { autoSpeak: carryVoice, image: image });
    });
    textInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendBtn.click();
      }
    });
    function autoresize() {
      textInput.style.height = 'auto';
      textInput.style.height = Math.min(textInput.scrollHeight, 160) + 'px';
    }
    textInput.addEventListener('input', autoresize);

    // Recording state: exactly one obvious action while recording — click
    // the (now pulsing) mic again to finish. Hiding Send removes the
    // "mic again or Send?" ambiguity Harvey flagged; showing it again the
    // moment recording stops means there's still a way to fix a stray word
    // before it goes out.
    function setRecordingUI(isRecording) {
      micBtn.classList.toggle('recording', isRecording);
      micBtn.title = isRecording ? 'Stop recording and send' : 'Record voice message';
      micBtn.setAttribute('aria-label', micBtn.title);
      sendBtn.hidden = isRecording;
    }

    var SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    var activeRecognition = null;
    var activeRecorder = null;

    // Preferred path: the browser's own live speech recognition (Chrome/
    // Edge) writes into the textarea as Harvey talks, same as him typing —
    // no separate "transcribing…" wait, and what he sees live is exactly
    // what gets sent, so there's no surprise mismatch against a second,
    // server-side transcription pass.
    function startLiveRecognition() {
      var recognition = new SpeechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      var finalTranscript = '';
      recognition.addEventListener('result', function (e) {
        var interim = '';
        for (var i = e.resultIndex; i < e.results.length; i++) {
          var chunk = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalTranscript += chunk + ' ';
          else interim += chunk;
        }
        textInput.value = (finalTranscript + interim).trim();
        autoresize();
      });
      recognition.addEventListener('end', function () {
        activeRecognition = null;
        setRecordingUI(false);
        var text = textInput.value;
        textInput.value = '';
        textInput.style.height = 'auto';
        if (text.trim()) { lastSendWasVoice = true; sendText(text, 'respond', { autoSpeak: true }); }
      });
      recognition.addEventListener('error', function (e) {
        activeRecognition = null;
        setRecordingUI(false);
        if (e.error !== 'aborted' && e.error !== 'no-speech') {
          addMessage('error', 'Voice recognition error: ' + e.error);
        }
      });
      activeRecognition = recognition;
      setRecordingUI(true);
      recognition.start();
    }

    // Fallback for browsers without live recognition (e.g. Firefox): the
    // original record-then-upload-then-transcribe flow, no live preview.
    function startRecordAndUpload() {
      Voice.startRecording().then(function (rec) {
        activeRecorder = rec;
        setRecordingUI(true);
      }).catch(function () {
        alert('Could not access the microphone. Check the browser has mic permission.');
      });
    }

    micBtn.addEventListener('click', function () {
      if (activeRecognition) { activeRecognition.stop(); return; }
      if (activeRecorder) {
        var rec = activeRecorder;
        activeRecorder = null;
        setRecordingUI(false);
        rec.stop().then(function (blob) { return Voice.transcribe(blob); })
          .then(function (text) {
            if (!text) return;
            lastSendWasVoice = true;
            sendText(text, 'respond', { autoSpeak: true });
          })
          .catch(function (err) { addMessage('error', (err && err.message) || 'Could not transcribe audio.'); });
        return;
      }
      if (SpeechRecognitionCtor) startLiveRecognition();
      else startRecordAndUpload();
    });

    resetBtn.addEventListener('click', function () {
      if (!confirm('Start a new conversation? CC will lose context from this one.')) return;
      Voice.resetSession().then(function () {
        addMessage('system', 'New conversation started.');
      });
    });

    textInput.focus();
  }

  /* ============================================================
     SHARED PIECE STATE (Content Ops + Upload Files read/write the
     same underlying `pieces` store — one board, two views onto it)
     ============================================================ */

  var pieces = {};
  var piecesLoadedPromise = null;

  // One-time backfill for pieces that predate the sequential-ID feature
  // (Harvey: "post 047" needs to mean something stable he can say out loud
  // to the Project Manager) — assigned in creation order so older pieces
  // keep lower numbers, continuing on from any already-numbered ones.
  function backfillMissingSeqs(rows) {
    var missing = rows.filter(function (r) { return typeof r.seq !== 'number'; })
      .sort(function (a, b) { return new Date(a.createdAt || 0) - new Date(b.createdAt || 0); });
    if (!missing.length) return;
    var next = Store.nextSeq(rows);
    missing.forEach(function (r) {
      r.seq = next++;
      Store.put('pieces', r);
    });
  }

  function ensurePiecesLoaded() {
    if (!piecesLoadedPromise) {
      piecesLoadedPromise = Store.getAll('pieces').then(function (rows) {
        rows.forEach(function (r) { pieces[r.id] = r; });
        backfillMissingSeqs(rows);
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

  // Fills as many consecutive shorts slots as there are ready pieces for,
  // rotating ultra_short -> short -> long_short -> repeat and skipping any
  // type with nothing ready right now (falls back to alternating between
  // whichever types DO have something, per Harvey). Runs the full pass
  // (not just "schedule this one piece") every time anything becomes ready,
  // since finishing several pieces in a row should fill several slots in
  // the correct rotation order, not just bump the one just finished to the
  // front. Schedules and persists every piece it touches itself (including
  // deriving its board stage) — a caller doesn't need to do that
  // separately for pieces other than the one it already knows about.
  function scheduleShorts(settings) {
    var ms = Store.cadenceMs(settings.cadence.shorts || Store.DEFAULT_CADENCE.shorts);
    var tail = 0;
    Object.keys(pieces).forEach(function (id) {
      var o = pieces[id];
      if (Store.SHORT_TYPES.indexOf(o.contentType) !== -1 && o.scheduledAt && (o.stage === 'scheduled' || o.stage === 'live')) {
        var t = new Date(o.scheduledAt).getTime();
        if (t > tail) tail = t;
      }
    });
    if (!tail) tail = Date.now();

    var pointer = Store.SHORT_TYPES.indexOf(settings.lastShortType);
    var settingsDirty = false;
    for (var guard = 0; guard < 200; guard++) {
      var found = null;
      for (var attempt = 1; attempt <= Store.SHORT_TYPES.length; attempt++) {
        var candidateIdx = (pointer + attempt) % Store.SHORT_TYPES.length;
        var candidateType = Store.SHORT_TYPES[candidateIdx];
        var ready = Object.keys(pieces).map(function (id) { return pieces[id]; })
          .filter(function (o) { return o.contentType === candidateType && o.hasVideo && o.audioTrackId && o.thumbnailDataUrl && !o.scheduledAt; })
          .sort(function (a, b) { return new Date(a.updatedAt) - new Date(b.updatedAt); });
        if (ready.length) { found = { piece: ready[0], idx: candidateIdx, type: candidateType }; break; }
      }
      if (!found) break;
      tail += ms;
      found.piece.scheduledAt = new Date(tail).toISOString();
      found.piece.updatedAt = nowIso();
      deriveAndApplyStage(found.piece);
      Store.put('pieces', found.piece);
      pointer = found.idx;
      settings.lastShortType = found.type;
      settingsDirty = true;
    }
    if (settingsDirty) Store.saveSettings(settings);
  }

  function maybeAutoSchedule(p) {
    if (!(p.hasVideo && p.audioTrackId && p.thumbnailDataUrl && !p.scheduledAt)) return Promise.resolve();
    return Store.getSettings().then(function (settings) {
      if (Store.SHORT_TYPES.indexOf(p.contentType) !== -1) {
        scheduleShorts(settings);
        return;
      }
      var cfg = settings.cadence.longform || Store.DEFAULT_CADENCE.longform;
      var ms = Store.cadenceMs(cfg);
      var latest = null;
      Object.keys(pieces).forEach(function (id) {
        var o = pieces[id];
        if (o.id !== p.id && o.contentType === 'longform' && o.scheduledAt && (o.stage === 'scheduled' || o.stage === 'live')) {
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
      ex.seq = i;
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
      platformGrid, metaCreated, metaUpdated, saveFlag, modalEyebrowText, modalIdBadge, btnDelete,
      videoSection, videoPreview, fieldTranscript, fieldAudioTrack, thumbPreview,
      pickFrameBtn, thumbScrub, scrubRange, captureFrameBtn, captionReadout,
      utmField, fieldUtmLink, copyUtmBtn, scheduleStatus,
      stageField, stageReadoutField, stageReadout,
      ytTitlesField, fieldYtTitle1, fieldYtTitle2, fieldYtTitle3;

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
    modalIdBadge = document.getElementById('modalIdBadge');
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
    ytTitlesField = document.getElementById('ytTitlesField');
    fieldYtTitle1 = document.getElementById('fieldYtTitle1');
    fieldYtTitle2 = document.getElementById('fieldYtTitle2');
    fieldYtTitle3 = document.getElementById('fieldYtTitle3');
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
    [fieldYtTitle1, fieldYtTitle2, fieldYtTitle3].forEach(function (el) {
      el.addEventListener('input', debounceSync);
      el.addEventListener('blur', function () { clearTimeout(saveTimer); syncFromForm(); });
    });
    fieldStage.addEventListener('change', function () { clearTimeout(saveTimer); syncFromForm(); });
    fieldContentType.addEventListener('change', function () {
      var preset = PLATFORM_PRESET_BY_TYPE[fieldContentType.value];
      if (preset) {
        platformGrid.querySelectorAll('.platform-toggle').forEach(function (t) {
          var checked = preset.indexOf(t.dataset.platform) !== -1;
          t.classList.toggle('checked', checked);
          t.querySelector('input').checked = checked;
        });
      }
      ytTitlesField.hidden = fieldContentType.value !== 'longform';
      clearTimeout(saveTimer);
      syncFromForm();
    });
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

    // Closing on a click "outside" the editor used to fire on the native
    // click event's own target — but a click event's target is computed
    // from where the mouse *released*, not where the drag started. Highlighting
    // a line of text (mousedown inside the editor) and dragging past its edge
    // before releasing landed the mouseup on the scrim, which read as an
    // outside click and closed the editor — annoying and not what "clicking
    // out" means. Fix: only close when BOTH the mousedown and the click
    // itself targeted the overlay — a drag that started inside never sets
    // mouseDownOnOverlay, so it can't trigger a close no matter where the
    // release lands. A genuine click outside still closes normally.
    var mouseDownOnOverlay = false;
    function markOverlayMouseDown(e) { mouseDownOnOverlay = (e.target === scrim || e.target === modalWrap); }
    scrim.addEventListener('mousedown', markOverlayMouseDown);
    modalWrap.addEventListener('mousedown', markOverlayMouseDown);
    function maybeCloseFromOverlayClick(e) {
      var wasOutsideMouseDown = mouseDownOnOverlay;
      mouseDownOnOverlay = false;
      if (wasOutsideMouseDown && (e.target === scrim || e.target === modalWrap)) closeModal();
    }
    scrim.addEventListener('click', maybeCloseFromOverlayClick);
    modalWrap.addEventListener('click', maybeCloseFromOverlayClick);

    document.getElementById('modalClose').addEventListener('click', closeModal);
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
    // utm_content uses the human-friendly #047 id, not the internal uuid —
    // it's what shows up in analytics, so it should be the same number
    // Harvey actually refers to the piece by.
    var contentId = typeof p.seq === 'number' ? String(p.seq).padStart(3, '0') : p.id;
    return base + sep + 'utm_source=' + encodeURIComponent(source) + '&utm_medium=video&utm_campaign=' + encodeURIComponent(p.contentType || 'longform') + '&utm_content=' + encodeURIComponent(contentId);
  }

  // Every content type now gets its own tracked link inserted into the
  // caption via a "[LINK]" shortcode (Harvey realized Shorts can carry
  // tracking links too, not just longform) — shorts and longform pull from
  // separate caption templates since longform's needs a real per-video
  // link every time while shorts can reuse the same wording.
  function captionTemplateFor(settings, contentType) {
    return contentType === 'longform' ? settings.captions.longform : settings.captions.shorts;
  }

  function renderCaptionText(p, settings) {
    var template = captionTemplateFor(settings, p.contentType);
    if (!template || !template.trim()) return 'No caption set for this type yet — add one in Settings.';
    return Store.applyCaptionLink(template, buildUtmLink(p, settings));
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

    ytTitlesField.hidden = p.contentType !== 'longform';
    var ytTitles = p.ytTitles || [];
    fieldYtTitle1.value = ytTitles[0] || '';
    fieldYtTitle2.value = ytTitles[1] || '';
    fieldYtTitle3.value = ytTitles[2] || '';

    if (!p.hasVideo) {
      videoSection.hidden = true;
      videoPreview.removeAttribute('src');
      return Promise.resolve();
    }

    videoSection.hidden = false;
    thumbScrub.hidden = true;
    fieldTranscript.value = p.transcript || '';
    thumbPreview.innerHTML = p.thumbnailDataUrl ? ('<img src="' + p.thumbnailDataUrl + '" alt="" />') : '<span class="thumb-empty">No thumbnail yet</span>';
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
        captionReadout.textContent = renderCaptionText(p, settings);
        fieldUtmLink.value = buildUtmLink(p, settings);
      })
    ]);
  }

  // Shown in the editor header too, not just the card — per Harvey, so
  // whatever's open matches the number he'd reference giving voice
  // feedback ("post 047, change X") without needing to close back to the
  // board to check which one he's looking at.
  function showModalIdBadge(piece) {
    if (typeof piece.seq === 'number') {
      modalIdBadge.textContent = '#' + String(piece.seq).padStart(3, '0');
      modalIdBadge.hidden = false;
    } else {
      modalIdBadge.hidden = true;
    }
  }

  function openPiece(id, closedCb) {
    activeId = id;
    isNewUnsaved = false;
    onModalClosed = closedCb || null;
    disarmDelete();
    var p = pieces[id];
    if (!p) return;
    modalEyebrowText.textContent = 'Editing piece';
    showModalIdBadge(p);
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

  function allPiecesArray() { return Object.keys(pieces).map(function (k) { return pieces[k]; }); }

  function createDraft(stageId, closedCb) {
    var id = Store.genId();
    pieces[id] = {
      id: id, seq: Store.nextSeq(allPiecesArray()), title: '', stage: stageId, platforms: [], contentType: 'short', notesHtml: '', hasVideo: false,
      order: minOrder(stageId) - 10,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    activeId = id;
    isNewUnsaved = true;
    onModalClosed = closedCb || null;
    disarmDelete();
    modalEyebrowText.textContent = 'New piece';
    showModalIdBadge(pieces[id]);
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
      platforms: platforms,
      ytTitles: [fieldYtTitle1.value, fieldYtTitle2.value, fieldYtTitle3.value].filter(function (t) { return t.trim(); })
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
      Store.getSettings().then(function (settings) {
        fieldUtmLink.value = buildUtmLink(p, settings);
        captionReadout.textContent = renderCaptionText(p, settings);
      });
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
        '<div class="ops-filters">' +
          '<input type="search" class="ops-search" id="opsSearch" placeholder="Search ideas…" />' +
          '<select class="ops-type-filter" id="opsTypeFilter"><option value="">All types</option>' +
            Store.CONTENT_TYPES.map(function (c) { return '<option value="' + c.id + '">' + c.label + '</option>'; }).join('') +
          '</select>' +
        '</div>' +
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
    var isAi = piece.createdBy === 'agent';
    var moveControl = isAuto
      ? '<span class="auto-stage-badge">Auto · ' + stageLabelOf(piece.stage) + '</span>'
      : (function () {
          var stageOpts = Store.STAGES.filter(function (s) { return MANUAL_STAGE_IDS.indexOf(s.id) !== -1; }).map(function (s) {
            return '<option value="' + s.id + '"' + (s.id === piece.stage ? ' selected' : '') + '>' + s.label + '</option>';
          }).join('');
          return '<select class="card-move" data-id="' + id + '">' + stageOpts + '</select>';
        })();
    var idBadge = typeof piece.seq === 'number' ? '<span class="card-id">#' + String(piece.seq).padStart(3, '0') + '</span>' : '';
    return '' +
      '<div class="card' + (isAuto ? ' card-auto' : '') + (isAi ? ' card-ai' : '') + '" draggable="' + (isAuto ? 'false' : 'true') + '" data-id="' + id + '"' + (isAi ? ' title="Created by Claude Code"' : '') + '>' +
        (isAuto ? '' : '<span class="card-grip">⋮⋮</span>') +
        idBadge +
        '<div class="' + titleClass + '">' + titleHtml + '</div>' +
        '<div class="chip-row">' + chipHtml(piece) + '</div>' +
        '<div class="card-foot">' +
          '<span class="card-time">' + fmtTime(piece.updatedAt) + '</span>' +
          moveControl +
        '</div>' +
      '</div>';
  }

  // Both the type filter and the search box remove non-matching cards
  // from each column outright (conventional filter semantics) — search
  // used to just dim non-matches in place instead, but Harvey wants
  // actual hide/show: type something, only real hits stay visible; clear
  // the box and everything comes back exactly as it was (nothing here
  // touches drag order or which column a card is in, since filtering only
  // affects what render() outputs, never the underlying piece data).
  var activeTypeFilter = '';
  var activeSearchQuery = '';

  function pieceMatchesSearch(piece, query) {
    if (!query) return true;
    var probe = document.createElement('div');
    probe.innerHTML = piece.notesHtml || '';
    var haystack = ((piece.title || '') + ' ' + probe.textContent + ' ' + (piece.transcript || '')).toLowerCase();
    return haystack.indexOf(query) !== -1;
  }

  function render() {
    var scrollLeft = boardWrap.scrollLeft;
    var query = activeSearchQuery.trim().toLowerCase();
    board.innerHTML = Store.STAGES.map(function (s, idx) {
      var ids = orderedIds(s.id);
      if (activeTypeFilter) ids = ids.filter(function (id) { return pieces[id].contentType === activeTypeFilter; });
      if (query) ids = ids.filter(function (id) { return pieceMatchesSearch(pieces[id], query); });
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
          (isAutoCol ? '' : '<button class="column-add" data-stage="' + s.id + '">+ Add card</button>') +
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

    activeTypeFilter = '';
    activeSearchQuery = '';
    document.getElementById('opsSearch').addEventListener('input', function (e) {
      activeSearchQuery = e.target.value;
      render();
    });
    document.getElementById('opsTypeFilter').addEventListener('change', function (e) {
      activeTypeFilter = e.target.value;
      render();
    });

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
        seq: Store.nextSeq(allPiecesArray()),
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
        '<p class="settings-hint">Just two cadences — Shorts covers ultra-short/short/long-short together, rotating ' +
          'through whichever of the three has something ready (ultra-short → short → long-short → repeat, skipping ' +
          'any type with nothing queued). Longform is its own timeline.</p>' +
        '<div class="cadence-grid" id="cadenceGrid"></div>' +
      '</section>' +
      '<section class="settings-section">' +
        '<h3>Ambient audio library</h3>' +
        '<p class="settings-hint">Backing tracks offered in the audio dropdown when editing an uploaded video.</p>' +
        '<label class="btn-secondary file-btn">Upload audio<input type="file" id="audioUpload" accept="audio/*" multiple hidden /></label>' +
        '<div class="audio-list" id="audioList"></div>' +
      '</section>' +
      '<section class="settings-section">' +
        '<h3>Captions</h3>' +
        '<p class="settings-hint">Separate template per type — Shorts can stay the same every time, Longform (or any ' +
          'type) usually wants a fresh link each time. Use the shortcode <code>[LINK]</code> anywhere in the text and ' +
          'it\'s replaced with that piece\'s own UTM-tracked link when the caption is shown or copied.</p>' +
        '<label class="field-label">Shorts caption <span class="field-hint">(ultra-short / short / long-short)</span></label>' +
        '<textarea class="notes-input settings-textarea" id="captionShortsInput" placeholder="e.g. Grab your copy of the book here [LINK]!"></textarea>' +
        '<label class="field-label" style="margin-top:14px;display:block;">YouTube Longform caption</label>' +
        '<textarea class="notes-input settings-textarea" id="captionLongformInput" placeholder="e.g. Grab your copy of the book here [LINK]!"></textarea>' +
      '</section>' +
      '<section class="settings-section">' +
        '<h3>Tracked link</h3>' +
        '<p class="settings-hint">Base URL used to build the UTM-tracked [LINK] for every piece, any type.</p>' +
        '<input class="title-input settings-input" id="baseLinkInput" />' +
      '</section>' +
      '<section class="settings-section">' +
        '<h3>API keys</h3>' +
        '<p class="settings-hint">Stored on the ops-service backend (same place as everything else here — the ' +
          'shared `settings` record), not just this browser, so any Claude Code session with server access can read ' +
          'them when it needs to. TikTok access still needs approving; the field is here for when it does.</p>' +
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

  var CADENCE_ROWS = [
    { key: 'shorts', label: 'Shorts', hint: 'ultra-short / short / long-short, rotated' },
    { key: 'longform', label: 'Longform', hint: 'YT / FB' }
  ];

  function renderCadenceGrid() {
    var grid = document.getElementById('cadenceGrid');
    grid.innerHTML = CADENCE_ROWS.map(function (row) {
      var cfg = settingsCache.cadence[row.key];
      return '<div class="cadence-row" data-key="' + row.key + '">' +
        '<span class="cadence-label">' + row.label + ' <span class="ink-faint">(' + row.hint + ')</span></span>' +
        '<span class="cadence-inputs">1 every <input type="number" min="1" step="1" class="cadence-every" value="' + cfg.every + '" /> ' +
        '<select class="cadence-unit"><option value="hours"' + (cfg.unit === 'hours' ? ' selected' : '') + '>hours</option><option value="days"' + (cfg.unit === 'days' ? ' selected' : '') + '>days</option></select></span>' +
      '</div>';
    }).join('');
    grid.querySelectorAll('.cadence-row').forEach(function (row) {
      var key = row.dataset.key;
      row.querySelector('.cadence-every').addEventListener('input', function (e) {
        settingsCache.cadence[key].every = Math.max(1, parseInt(e.target.value, 10) || 1);
        saveSettingsDebounced();
      });
      row.querySelector('.cadence-unit').addEventListener('change', function (e) {
        settingsCache.cadence[key].unit = e.target.value;
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

      var captionShortsInput = document.getElementById('captionShortsInput');
      captionShortsInput.value = settings.captions.shorts || '';
      captionShortsInput.addEventListener('input', function () {
        settingsCache.captions.shorts = captionShortsInput.value;
        saveSettingsDebounced();
      });

      var captionLongformInput = document.getElementById('captionLongformInput');
      captionLongformInput.value = settings.captions.longform || '';
      captionLongformInput.addEventListener('input', function () {
        settingsCache.captions.longform = captionLongformInput.value;
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
