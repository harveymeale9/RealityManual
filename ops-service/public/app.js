(function () {
  'use strict';

  var Store = window.RMStore;
  var Auth = window.RMAuth;

  // Set once login/session-check resolves (see showLogin/showApp wiring
  // below). A youtube-reviewer session gets the exact same SPA, just with
  // Project Manager/Analytics hidden and a strict "view everything, edit
  // only what you created yourself" gate over Content Ops/Production/
  // Settings — see every IS_REVIEWER check below. This is UX only; the
  // real enforcement lives server-side (server.js's per-route ownership
  // checks), so nothing here needs to be airtight against a user editing
  // this script themselves.
  var CURRENT_ROLE = 'admin';
  var IS_REVIEWER = false;
  var REVIEWER_ALLOWED_TABS = ['content-ops', 'upload-files', 'settings'];
  function isOwnedByReviewer(p) { return !!(p && p.createdBy === 'youtube-reviewer'); }
  // True for admin always; true for a reviewer only on a piece it made
  // itself. Every place in this file that lets Harvey edit/delete/drag/
  // publish a piece should gate on this, not just IS_REVIEWER alone.
  function canEditPiece(p) { return !IS_REVIEWER || isOwnedByReviewer(p); }

  var UPLOADED_INDEX = window.RMStore.STAGES.map(function (s) { return s.id; }).indexOf('uploaded');
  var MANUAL_STAGE_IDS = window.RMStore.STAGES.slice(0, UPLOADED_INDEX + 1).map(function (s) { return s.id; });
  var AUTO_STAGE_IDS = window.RMStore.STAGES.slice(UPLOADED_INDEX + 1).map(function (s) { return s.id; });

  // Platform preset applied when the content-type dropdown changes in the
  // editor, per Harvey: any shortform type defaults to YT Shorts +
  // TikTok + Instagram + Facebook (all four — briefly dropped Facebook
  // from this list on 2026-09-20, corrected back the same day, "fb also
  // for shorts"), longform defaults to YT Long + Facebook. Only fires on
  // an actual change during editing (see fieldContentType's change
  // listener), never on populateFields() for an already-saved piece.
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
  // Same leak-avoidance reasoning as pmSync above — unsubscribe the
  // previous tab visit's speaking-state listener before registering a new
  // one in bootProjectManager().
  var pmSpeakingUnsub = null;

  // Nav hierarchy (Harvey's restructure, 2026-09-19): top level is just
  // Project Manager / Content Ops / Analytics — each of the latter two is
  // a group of real leaf tabs, not a routable panel itself. Leaf tab ids
  // are unchanged from before this restructure (only labels/grouping
  // changed) so nothing downstream that already keys off e.g.
  // active === 'content-ops' needed to change.
  var GROUPS = [
    { label: 'Project Manager', tabs: [
        { id: 'project-manager', label: 'Project Manager' }
      ] },
    { label: 'Content Ops', tabs: [
        { id: 'content-ops', label: 'Content Pipeline' },
        { id: 'content-ideation', label: 'Content Ideation' },
        { id: 'upload-files', label: 'Content Production' },
        { id: 'settings', label: 'Content Settings' }
      ] },
    { label: 'Analytics', tabs: [
        { id: 'content-analytics', label: 'Content Analytics' },
        { id: 'sales-analytics', label: 'Sales Analytics' },
        { id: 'website-analytics', label: 'Website Analytics' }
      ] },
    // Rail-only utility: routable like every other leaf, deliberately
    // omitted from the horizontal product-area navigation.
    { label: 'Manuscript', railOnly: true, tabs: [
        { id: 'manuscript', label: 'The Reality Manual' }
      ] }
  ];
  var TABS = GROUPS.reduce(function (acc, g) { return acc.concat(g.tabs); }, []);
  function groupForTab(tabId) {
    return GROUPS.filter(function (g) { return g.tabs.some(function (t) { return t.id === tabId; }); })[0] || GROUPS[0];
  }

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
    Auth.checkPassword(loginPassword.value).then(function (result) {
      if (result) {
        CURRENT_ROLE = result.role || 'admin';
        IS_REVIEWER = CURRENT_ROLE === 'youtube-reviewer';
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
  var panelSubtabs = document.getElementById('panelSubtabs');
  var panelMain = document.getElementById('panelMain');
  var sideRail = document.getElementById('sideRail');

  function currentTabId() {
    var h = (location.hash || '').replace('#', '');
    var match = TABS.filter(function (t) { return t.id === h; })[0];
    return match ? match.id : TABS[0].id;
  }

  // One link per GROUP now, not per leaf tab — each links to its group's
  // first leaf (e.g. "Content Ops" -> #content-ops, which is the Content
  // Pipeline leaf), and is marked active whenever the current leaf is any
  // member of that group (data-tabs carries the whole member list for
  // renderActiveTab to check against). Real <a href="#tab">, not a
  // <button>, so middle-click/ctrl+click "open in new tab" still works.
  function renderTabs() {
    var groups = IS_REVIEWER ? GROUPS.filter(function (g) { return g.label === 'Content Ops'; }) : GROUPS.filter(function (g) { return !g.railOnly; });
    panelTabs.innerHTML = groups.map(function (g) {
      var ids = g.tabs.map(function (t) { return t.id; });
      return '<a href="#' + ids[0] + '" class="panel-tab" data-tabs="' + ids.join(',') + '">' + g.label + '</a>';
    }).join('');
  }

  // Secondary strip shown under the top tabs whenever the active group has
  // more than one leaf (Content Ops, Analytics) — this is the only way to
  // reach a group's non-default leaf (e.g. Content Production, Sales
  // Analytics) from the top nav now that renderTabs() above collapses each
  // group to one link. Rebuilt on every renderActiveTab() call rather than
  // once at init, since which group is active (and therefore what belongs
  // in this strip) changes as Harvey navigates.
  function renderSubtabs(active) {
    if (!panelSubtabs) return;
    var group = groupForTab(active);
    var visibleTabs = IS_REVIEWER ? group.tabs.filter(function (t) { return REVIEWER_ALLOWED_TABS.indexOf(t.id) !== -1; }) : group.tabs;
    if (visibleTabs.length < 2) { panelSubtabs.innerHTML = ''; return; }
    panelSubtabs.innerHTML = visibleTabs.map(function (t) {
      return '<a href="#' + t.id + '" class="panel-subtab' + (t.id === active ? ' active' : '') + '">' + t.label + '</a>';
    }).join('');
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
    // A reviewer session hand-editing the URL hash (or a stale bookmark
    // to #project-manager/#website-analytics/etc.) gets bounced back to
    // Content Pipeline rather than ever rendering a tab it shouldn't see —
    // the real access control is server-side, but there's no reason to
    // let the UI even try to render something it'll just get 401/403s
    // back from anyway.
    if (IS_REVIEWER && REVIEWER_ALLOWED_TABS.indexOf(active) === -1) {
      location.hash = 'content-ops';
      return;
    }
    panelTabs.querySelectorAll('.panel-tab').forEach(function (btn) {
      var ids = (btn.dataset.tabs || '').split(',');
      btn.classList.toggle('active', ids.indexOf(active) !== -1);
    });
    renderSubtabs(active);
    if (sideRail) {
      sideRail.querySelectorAll('.side-rail-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.tab === active);
      });
    }
    var backFab = document.getElementById('pmBackFab');
    if (backFab) backFab.classList.toggle('show', active !== 'project-manager');
    panelMain.classList.toggle('panel-main--ideation', active === 'content-ideation');
    panelMain.classList.toggle('panel-main--manuscript', active === 'manuscript');
    if (active !== 'project-manager' && pmSync) { pmSync.stop(); pmSync = null; }
    if (active === 'project-manager') {
      panelMain.innerHTML = PM_MARKUP;
      bootProjectManager();
    } else if (active === 'content-ops') {
      panelMain.innerHTML = OPS_MARKUP;
      bootContentOps();
    } else if (active === 'content-ideation') {
      window.RMIdeation.mount(panelMain);
    } else if (active === 'manuscript') {
      window.RMManuscript.mount(panelMain);
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
    document.body.classList.toggle('role-reviewer', IS_REVIEWER);
    if (IS_REVIEWER) {
      var avatarBtn = document.getElementById('logoutBtn');
      if (avatarBtn) { avatarBtn.textContent = 'R'; avatarBtn.title = 'Log out (Reviewer account)'; }
    }
    renderTabs();
    bindSideRail();
    bootModal();
    window.addEventListener('hashchange', renderActiveTab);
    if (!location.hash) location.hash = IS_REVIEWER ? 'content-ops' : TABS[0].id;
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
      '<div class="pm-columns">' +
        '<div class="pm-col pm-col-clean">' +
          '<div class="pm-toolbar">' +
            '<div class="pm-agent-switch" role="group" aria-label="Active agent">' +
              '<button type="button" class="pm-agent-option" data-agent="claude">Claude</button>' +
              '<button type="button" class="pm-agent-option" data-agent="codex">Codex</button>' +
              '<button type="button" class="pm-agent-option pm-usage-option" aria-haspopup="dialog">Usage</button>' +
            '</div>' +
            '<a class="link-btn" id="pmMobileLink" href="voice-mobile.html" target="_blank" rel="noopener">Mobile view ↗</a>' +
            '<button type="button" class="pm-reset-btn" id="pmResetBtn">New conversation</button>' +
          '</div>' +
          '<div class="pm-thread" id="pmThread">' +
            '<div class="pm-empty">Type or speak to your VPS Project Manager — same project, same tools, persistent memory.</div>' +
          '</div>' +
          '<div class="pm-inputbar">' +
            '<div class="pm-reply-preview" id="pmReplyPreview" hidden>' +
              '<span class="pm-reply-preview-label">Replying to:</span>' +
              '<span class="pm-reply-preview-text" id="pmReplyPreviewText"></span>' +
              '<button type="button" class="pm-reply-preview-cancel" id="pmReplyPreviewCancel" aria-label="Cancel reply">✕</button>' +
            '</div>' +
            '<div class="pm-image-preview" id="pmImagePreview" hidden></div>' +
            '<div class="pm-input-row">' +
              '<button type="button" class="pm-mic-btn" id="pmMicBtn" title="Record voice message" aria-label="Record voice message">' +
                '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/></svg>' +
              '</button>' +
              '<textarea id="pmTextInput" class="pm-textarea" rows="1" placeholder="Message Claude… (paste or drop an image too)"></textarea>' +
              '<button type="button" class="pm-send-btn" id="pmSendBtn" title="Send" aria-label="Send">' +
                '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4Z"/></svg>' +
              '</button>' +
            '</div>' +
            '<div class="pm-hint">Voice replies are spoken automatically. Typed replies show as text — tap ▶ to hear one.</div>' +
          '</div>' +
        '</div>' +
        '<div class="pm-col pm-col-activity">' +
          '<div class="pm-queue-section">' +
            '<div class="pm-activity-head">Task List <span class="pm-activity-hint" id="pmQueueHint"></span></div>' +
            '<div class="pm-queue-list" id="pmQueueList"><div class="pm-queue-empty">No tasks right now.</div></div>' +
          '</div>' +
          '<div class="pm-activity-section">' +
            '<div class="pm-activity-head">Activity <span class="pm-activity-hint">— what the selected agent is doing, live</span></div>' +
            '<div class="pm-activity" id="pmActivity"><div class="pm-activity-empty" id="pmActivityEmpty">Nothing happening yet.</div></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

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
    var replyPreviewEl = document.getElementById('pmReplyPreview');
    var replyPreviewTextEl = document.getElementById('pmReplyPreviewText');
    var replyPreviewCancelBtn = document.getElementById('pmReplyPreviewCancel');
    var agentButtons = Array.prototype.slice.call(document.querySelectorAll('.pm-agent-option[data-agent]'));
    var usageButton = document.querySelector('.pm-usage-option');
    var selectedAgent = 'claude';
    var agentPreferenceVersion = 0;

    function agentName(agent) { return agent === 'codex' ? 'Codex' : 'Claude'; }
    function applySelectedAgent(agent) {
      selectedAgent = agent === 'codex' ? 'codex' : 'claude';
      agentButtons.forEach(function (btn) {
        var active = btn.dataset.agent === selectedAgent;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      textInput.placeholder = 'Message ' + agentName(selectedAgent) + '… (paste or drop an image too)';
    }
    function refreshAgentPreference() {
      var requestedAtVersion = agentPreferenceVersion;
      Voice.getAgentPreference().then(function (agent) {
        // A polling GET that began before a local click must not visually
        // undo that newer click while its PUT is in flight.
        if (requestedAtVersion === agentPreferenceVersion) applySelectedAgent(agent);
      }).catch(function () {});
    }
    applySelectedAgent('claude');
    refreshAgentPreference();
    agentButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var previous = selectedAgent;
        agentPreferenceVersion++;
        applySelectedAgent(btn.dataset.agent);
        Voice.setAgentPreference(selectedAgent).catch(function () { applySelectedAgent(previous); });
      });
    });
    if (window.RMUsage) window.RMUsage.attach(usageButton);

    // Tap-to-reply: selecting one of CC's earlier messages (via the Reply
    // button added in addAssistantMessage below) sets this, shows the
    // preview strip above the compose box, and gets threaded into the next
    // send — both as an optimistic "Re:" quote on Harvey's own bubble and
    // as reply_to_id sent to the backend, which weaves it into the actual
    // prompt CC sees (server.js) so a short follow-up like "yes do that"
    // stays unambiguous even after several things have been discussed.
    var pendingReplyTo = null;
    function setPendingReplyTo(msgId, text) {
      if (!msgId) return;
      var snippet = (text || '').trim();
      if (!snippet) return;
      pendingReplyTo = { id: msgId, snippet: snippet };
      replyPreviewTextEl.textContent = snippet.length > 80 ? snippet.slice(0, 80) + '…' : snippet;
      replyPreviewEl.hidden = false;
      textInput.focus();
    }
    function clearPendingReplyTo() {
      pendingReplyTo = null;
      replyPreviewEl.hidden = true;
    }
    replyPreviewCancelBtn.addEventListener('click', clearPendingReplyTo);

    if (pmSync) { pmSync.stop(); pmSync = null; }

    // One shared listener drives the "speaking" highlight/button state for
    // every bubble in the thread, whichever one is currently playing —
    // covers both a manual Play-button click and auto-speak starting
    // playback on its own, which is what desktop was missing before (the
    // button's own local "am I playing" flag never got set when playback
    // started from outside its own click handler).
    if (pmSpeakingUnsub) pmSpeakingUnsub();
    pmSpeakingUnsub = Voice.onSpeakingChange(function (activeId) {
      thread.querySelectorAll('.pm-speaking').forEach(function (el) {
        el.classList.remove('pm-speaking');
        var btn = el.querySelector('.pm-play-btn');
        if (btn) { btn.textContent = '▶ Play'; btn.classList.remove('pm-stop-btn'); }
      });
      if (activeId === null || typeof activeId === 'undefined') return;
      var active = thread.querySelector('[data-msg-id="' + activeId + '"]');
      if (!active) return;
      active.classList.add('pm-speaking');
      var btn = active.querySelector('.pm-play-btn');
      if (btn) { btn.textContent = '■ Stop'; btn.classList.add('pm-stop-btn'); }
    });

    var emptyNote = thread.querySelector('.pm-empty');
    function clearEmptyNote() { if (emptyNote && emptyNote.parentNode) { emptyNote.parentNode.removeChild(emptyNote); emptyNote = null; } }

    function replyToSnippet(replyToText) {
      return 'Re: ' + (replyToText.length > 80 ? replyToText.slice(0, 80) + '…' : replyToText);
    }
    // Two messages can genuinely be in flight at once (Harvey can start
    // recording a second one before the first's reply lands — §108), and
    // each one's own typing placeholder sits wherever it was appended when
    // that message was sent. Without this, a delayed reply always landed
    // at the thread's current end regardless of where its placeholder was,
    // so a slower older reply could render visually *below* a newer
    // message sent while it was still working — confusing, out-of-order
    // bubbles. Inserting in the placeholder's original slot (when it still
    // exists) keeps replies in the order they actually correspond to.
    function insertMessageEl(el, insertBeforeEl) {
      if (insertBeforeEl && insertBeforeEl.parentNode === thread) {
        thread.insertBefore(el, insertBeforeEl);
      } else {
        thread.appendChild(el);
      }
      thread.scrollTop = thread.scrollHeight;
    }
    function addMessage(kind, text, msgId, imageFile, replyToText, insertBeforeEl) {
      clearEmptyNote();
      var el = document.createElement('div');
      el.className = 'pm-msg pm-msg-' + kind;
      if (msgId) el.dataset.msgId = msgId;
      if (!imageFile && !replyToText) {
        el.textContent = text;
        insertMessageEl(el, insertBeforeEl);
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
      insertMessageEl(el, insertBeforeEl);
      return el;
    }

    function addAssistantMessage(text, replyToText, msgId, insertBeforeEl, agent) {
      clearEmptyNote();
      agent = agent === 'codex' ? 'codex' : 'claude';
      var isAction = /^\[NEEDS_ACTION\]/i.test(text || '');
      var wrap = document.createElement('div');
      wrap.className = 'pm-msg pm-msg-assistant pm-msg-assistant--' + agent + (isAction ? ' pm-msg-assistant--action' : '');
      if (msgId) wrap.dataset.msgId = msgId;
      var agentLabel = document.createElement('div');
      agentLabel.className = 'pm-msg-agent-label';
      agentLabel.textContent = agentName(agent) + ':';
      wrap.appendChild(agentLabel);
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
      // Button state is driven entirely by the shared onSpeakingChange
      // listener (registered once in bootProjectManager) rather than a
      // local "am I playing" flag here — that flag used to only ever get
      // set from this button's own click, so audio started elsewhere
      // (auto-speak) left the button stuck showing "Play" while audio was
      // actually going, and clicking it then restarted the same text
      // instead of stopping it.
      playBtn.addEventListener('click', function () {
        playBtn.classList.remove('pm-play-btn-error');
        playBtn.removeAttribute('title');
        if (Voice.currentlySpeaking() === msgId) { Voice.stopSpeaking(); return; }
        playBtn.textContent = 'Loading audio…';
        Voice.speak(text, msgId, agent).then(function (audio) {
          if (!audio && Voice.currentlySpeaking() !== msgId) playBtn.textContent = '▶ Play';
        }).catch(function (error) {
          playBtn.textContent = error && error.code === 'openai_tts_not_configured'
            ? 'OpenAI key needed'
            : 'Audio unavailable';
          playBtn.title = error && error.message ? error.message : 'Could not play this response.';
          playBtn.classList.add('pm-play-btn-error');
        });
      });
      meta.appendChild(playBtn);
      if (msgId) {
        var replyBtn = document.createElement('button');
        replyBtn.type = 'button';
        replyBtn.className = 'pm-reply-btn';
        replyBtn.textContent = '↩ Reply';
        replyBtn.addEventListener('click', function () { setPendingReplyTo(msgId, text); });
        meta.appendChild(replyBtn);
      }
      wrap.appendChild(meta);
      insertMessageEl(wrap, insertBeforeEl);
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
        empty.textContent = 'No tasks right now.';
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
        textEl.textContent = agentName(row.agent) + ': ' + (row.early_ack || row.transcript);
        var copy = document.createElement('span');
        copy.className = 'pm-queue-copy';
        copy.appendChild(textEl);
        if (row.status === 'running' && row.activity_log && row.activity_log.length) {
          var progressEl = document.createElement('span');
          progressEl.className = 'pm-queue-progress';
          progressEl.textContent = row.activity_log[row.activity_log.length - 1];
          copy.appendChild(progressEl);
        }
        item.appendChild(num);
        item.appendChild(copy);
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
          textEl.textContent = agentName(row.agent) + ': ' + (row.early_ack || row.transcript);
          item.appendChild(mark);
          item.appendChild(textEl);
          queueListEl.appendChild(item);
        });
      }
    }

    function addTyping(msgId, agent) {
      clearEmptyNote();
      var el = document.createElement('div');
      agent = agent === 'codex' ? 'codex' : 'claude';
      el.className = 'pm-typing pm-typing--' + agent;
      if (msgId) el.dataset.msgId = msgId;
      el.textContent = agentName(agent) + ' is working on it…';
      thread.appendChild(el);
      thread.scrollTop = thread.scrollHeight;
      return el;
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

    // Ids this device sent via voice on itself and wants spoken aloud —
    // never applied to a reply that shows up because another device (or an
    // earlier page load) triggered it. No fallback timer/canned phrase
    // anymore (removed per Harvey: the repeated generic line was worse than
    // the problem it solved) — CC's own real early_ack (server.js's
    // unconditional acknowledgment rule) is spoken the moment it arrives,
    // full stop, no race against a timeout. Whether the final reply is
    // *also* spoken depends on whether the turn actually did any work: a
    // quick, no-tool-call turn's early_ack more or less IS its answer, so
    // onDone speaks the real reply too (the common case, feels instant); a
    // turn that used tools only gets the one spoken acknowledgment, with
    // the real answer landing as text — see onDone below.
    var voiceAutoSpeak = {};

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
      onNewMessage: function (row) { addMessage('user', row.transcript, row.id, null, row.reply_to_snippet); },
      onPending: function (row) { addTyping(row.id, row.agent); },
      onEarlyAck: function (row) {
        // Swap the generic "CC is working on it…" placeholder for CC's own
        // real, contextual first line the moment it's available — visible
        // even for a typed/no-speech send, not just spoken.
        var typingEl = thread.querySelector('.pm-typing[data-msg-id="' + row.id + '"]');
        if (typingEl) typingEl.textContent = row.early_ack;
        if (!voiceAutoSpeak[row.id] || row.agent === 'codex') return;
        Voice.speak(row.early_ack, row.id, row.agent).catch(function () {});
      },
      onDone: function (row) {
        // Look the placeholder up (rather than just removeTyping()) so its
        // position can be handed to addAssistantMessage as an insertion
        // anchor — see insertMessageEl's comment for why: this message may
        // not be the most recently-sent one anymore if Harvey started
        // another before this reply landed.
        var typingEl = thread.querySelector('.pm-typing[data-msg-id="' + row.id + '"]');
        // Execute-mode replies are a real completion summary now (see
        // server.js buildVoicePrompt), not a throwaway line — show it like
        // any other reply instead of a generic "Done" placeholder.
        addAssistantMessage(row.reply_text || '', row.transcript, row.id, typingEl, row.agent);
        if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
        if (pastFirstTick && Voice.isActiveHere()) Voice.playPing();
        if (voiceAutoSpeak[row.id]) {
          delete voiceAutoSpeak[row.id];
          // Whether the final answer also gets spoken, on top of the
          // acknowledgment already spoken by onEarlyAck, depends on
          // whether this turn actually needed real work — Harvey's own
          // instruction: a quick/easy turn should just get its answer
          // spoken directly (no separate ack needed, and this is exactly
          // that case, since a turn with no tool calls has nothing left
          // to add beyond what the acknowledgment already said); a turn
          // that needed real thinking/execution should only get the
          // spoken acknowledgment ("I'll look into it"), with the actual
          // answer landing as text, not a second spoken message stacked
          // on top of the first.
          var replyText = row.reply_text || '';
          if (row.agent === 'codex' && row.mode !== 'execute') {
            Voice.speak(replyText, row.id, row.agent).catch(function () {});
          } else {
            var usedTools = !!(row.activity_log && row.activity_log.length);
            var alreadySaidIt = row.early_ack && replyText.trim() === row.early_ack.trim();
            if (!usedTools && !alreadySaidIt && row.mode !== 'execute') {
              Voice.speak(replyText, row.id, row.agent).catch(function () {});
            }
          }
        }
      },
      onError: function (row) {
        var typingEl = thread.querySelector('.pm-typing[data-msg-id="' + row.id + '"]');
        addMessage('error', row.error_message || 'Something went wrong.', row.id, null, row.transcript, typingEl);
        if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
        if (pastFirstTick && Voice.isActiveHere()) Voice.playPing();
        if (voiceAutoSpeak[row.id]) {
          delete voiceAutoSpeak[row.id];
          if (row.agent !== 'codex') Voice.speak(row.error_message || 'Something went wrong.', row.id, row.agent).catch(function () {});
        }
      },
      onActivity: function (row) { renderActivity(row.activity_log); },
      onTick: function (rows) {
        renderQueue(rows);
        pastFirstTick = true;
        refreshAgentPreference();
      }
    });

    function sendText(text, mode, opts) {
      opts = opts || {};
      var autoSpeak = !!opts.autoSpeak;
      var image = opts.image || null;
      if (!text.trim() && !image) return;
      var replyTo = pendingReplyTo;
      clearPendingReplyTo();
      addMessage('user', text.trim(), null, image, replyTo ? replyTo.snippet : null);
      var agent = selectedAgent;
      var typingEl = addTyping(null, agent);
      renderActivity(null);
      Voice.sendMessage(text.trim(), mode, image, replyTo ? replyTo.id : null, agent).then(function (created) {
        typingEl.dataset.msgId = created.id;
        if (autoSpeak) voiceAutoSpeak[created.id] = true;
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
      // Don't talk over Harvey while he's dictating a new message — both
      // recording paths below (live recognition and record-and-upload)
      // funnel through this one function on every start/stop, so this is
      // the single place to gate it.
      Voice.setRecordingActive(isRecording);
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
  var conflictToastTimer = null;

  function showPieceConflict(message) {
    var toast = document.getElementById('pieceConflictToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'pieceConflictToast';
      toast.className = 'piece-conflict-toast';
      toast.setAttribute('role', 'alert');
      document.body.appendChild(toast);
    }
    toast.textContent = message || 'This card changed on another device. Your stale change was not saved, and the newest version has been loaded.';
    toast.classList.add('show');
    clearTimeout(conflictToastTimer);
    conflictToastTimer = setTimeout(function () { toast.classList.remove('show'); }, 7000);
  }

  window.addEventListener('rm-store-conflict', function (event) {
    var detail = event.detail || {};
    if (detail.storeName !== 'pieces') return;
    clearTimeout(saveTimer);
    showPieceConflict(detail.message);
    Store.getAll('pieces').then(function (rows) {
      var fresh = {};
      rows.forEach(function (piece) { fresh[piece.id] = piece; });
      pieces = fresh;
      if (activeId) {
        var latest = pieces[activeId];
        if (latest) {
          isNewUnsaved = false;
          populateFields(latest);
          metaUpdated.textContent = 'Updated ' + fmtFull(latest.updatedAt);
        } else {
          activeId = null;
          hideModal();
        }
      }
      notifyPiecesChanged();
    });
  });

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

  // One-time migration for the removed "Thumbnail Selected" stage (§ see
  // CLAUDE.md uploader-tool section) — anything still sitting there moves
  // back to Processing and picks up the "thumbnail selected" tag that
  // replaces it, so nothing gets silently stranded on a stage id that no
  // longer exists in Store.STAGES.
  function migrateThumbnailStage(rows) {
    var stragglers = rows.filter(function (r) { return r.stage === 'thumbnail'; });
    stragglers.forEach(function (r) {
      r.stage = 'processed';
      syncTags(r);
      r.updatedAt = nowIso();
      Store.put('pieces', r);
    });
  }

  // A piece could only reach Final Check under the *old* flow by having
  // its stage set directly (no separate audio-spliced video ever built —
  // that pipeline didn't exist yet). Its Final Check card would now try
  // to play a "<id>-final" file that was never created. Sending it back
  // to Processing means it goes through the real build the next time
  // Harvey hits "Send to final check," same as any new upload — rather
  // than leaving a stale entry with a broken/missing video preview.
  function migrateUnbuiltFinalChecks(rows) {
    var stragglers = rows.filter(function (r) { return r.stage === 'final_check' && r.finalBuildStatus !== 'done'; });
    stragglers.forEach(function (r) {
      r.stage = 'processed';
      r.updatedAt = nowIso();
      Store.put('pieces', r);
    });
  }

  function ensurePiecesLoaded() {
    if (!piecesLoadedPromise) {
      piecesLoadedPromise = Store.getAll('pieces').then(function (rows) {
        rows.forEach(function (r) { pieces[r.id] = r; });
        backfillMissingSeqs(rows);
        migrateThumbnailStage(rows);
        migrateUnbuiltFinalChecks(rows);
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
    return Store.CONTENT_TYPES.filter(function (c) { return c.id === id; })[0] ||
      { id: '', label: 'Not selected', hint: '', color: '#77736b' };
  }

  function stageLabelOf(id) {
    var s = Store.STAGES.filter(function (s) { return s.id === id; })[0];
    return s ? s.label : id;
  }

  /* ---------- tags + scheduling ---------- */

  // Replaces the old "Thumbnail Selected" stage-derivation (deriveAndApplyStage) —
  // a video piece's *stage* is now fully explicit (Processing -> Final Check
  // -> Scheduled -> Live, moved only by Harvey hitting "Send to final
  // check" / "Approve," never automatically), but these three tags still
  // want to reflect field state automatically, recomputed from scratch
  // every time rather than tracked incrementally — so unpicking a
  // thumbnail/audio/title also correctly drops its tag again.
  function syncTags(p) {
    var tags = {};
    (p.tags || []).forEach(function (t) { tags[t] = true; });
    if (p.thumbnailDataUrl) tags.thumbnail_selected = true; else delete tags.thumbnail_selected;
    if ((p.ytTitles || []).length) tags.titles_selected = true; else delete tags.titles_selected;
    if (p.audioTrackId) tags.music_added = true; else delete tags.music_added;
    p.tags = Object.keys(tags);
  }

  // Fills as many consecutive shorts slots as there are approved pieces
  // for, rotating ultra_short -> short -> long_short -> repeat and
  // skipping any type with nothing ready right now (falls back to
  // alternating between whichever types DO have something, per Harvey).
  // Runs the full pass (not just "schedule this one piece") every time
  // something's approved, since approving several in a row should fill
  // several slots in the correct rotation order, not just bump the one
  // just approved to the front. "Ready" now means Harvey has explicitly
  // approved it out of Final Check — this used to fire automatically the
  // instant a piece had both audio and a thumbnail, with no review step
  // at all; approveAndSchedule below is the only caller now.
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
          .filter(function (o) { return o.contentType === candidateType && o.hasVideo && o.stage === 'final_check' && !o.scheduledAt; })
          .sort(function (a, b) { return new Date(a.updatedAt) - new Date(b.updatedAt); });
        if (ready.length) { found = { piece: ready[0], idx: candidateIdx, type: candidateType }; break; }
      }
      if (!found) break;
      tail += ms;
      found.piece.scheduledAt = new Date(tail).toISOString();
      found.piece.updatedAt = nowIso();
      found.piece.stage = 'scheduled';
      Store.put('pieces', found.piece);
      pointer = found.idx;
      settings.lastShortType = found.type;
      settingsDirty = true;
    }
    if (settingsDirty) Store.saveSettings(settings);
  }

  // Called only by the "Approve" action in Final Check (see below) — no
  // longer fires automatically just because audio+thumbnail are set. A
  // piece not currently in Final Check is left alone (nothing to approve).
  function approveAndSchedule(p) {
    if (!(p.hasVideo && p.stage === 'final_check' && !p.scheduledAt)) return Promise.resolve();
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
      p.stage = 'scheduled';
    });
  }

  function setPieceStage(p, newStage, cb) {
    p.stage = newStage;
    p.updatedAt = nowIso();
    approveAndSchedule(p).then(function () {
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
      utmField, fieldUtmLink, copyUtmBtn, scheduleStatus, approveBtn,
      stageField, stageReadoutField, stageReadout,
      ytTitlesField, fieldYtTitle1, fieldYtTitle2, fieldYtTitle3,
      kanbanDictateBtn, kanbanDictationStatus;

  var activeId = null;
  var isNewUnsaved = false;
  var saveTimer = null;
  var deleteArmed = false;
  var deleteArmTimer = null;
  var currentVideoObjectUrl = null;
  var modalBound = false;
  var onModalClosed = null; // optional callback set by whichever tab opened the modal
  var kanbanDictationTarget = null;
  var activeKanbanDictationStop = null;

  function setKanbanDictationTarget(target) {
    kanbanDictationTarget = target === fieldTitle ? fieldTitle : fieldNotes;
    if (!kanbanDictateBtn) return;
    var name = kanbanDictationTarget === fieldTitle ? 'title' : 'notes';
    kanbanDictateBtn.querySelector('span').textContent = 'Dictate ' + name;
    kanbanDictateBtn.title = 'Dictate into ' + name;
    kanbanDictateBtn.setAttribute('aria-label', kanbanDictateBtn.title);
  }

  function dictationInsertion(target) {
    if (target === fieldTitle) {
      var start = target.selectionStart == null ? target.value.length : target.selectionStart;
      var end = target.selectionEnd == null ? start : target.selectionEnd;
      var before = target.value.slice(0, start);
      var after = target.value.slice(end);
      return {
        update: function (spoken) {
          var leftSpace = before && !/\s$/.test(before) ? ' ' : '';
          var rightSpace = after && !/^\s/.test(after) ? ' ' : '';
          target.value = before + leftSpace + spoken.trim() + rightSpace + after;
        },
        finish: function () {
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.focus();
        }
      };
    }

    target.focus();
    var selection = window.getSelection();
    var range = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    if (!range || !target.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
    }
    var marker = null;
    function ensureMarker() {
      if (marker) return;
      marker = document.createElement('span');
      marker.className = 'kanban-dictation-insert';
      range.deleteContents();
      range.insertNode(marker);
    }
    return {
      update: function (spoken) {
        ensureMarker();
        var left = document.createRange();
        left.selectNodeContents(target);
        left.setEndBefore(marker);
        var right = document.createRange();
        right.selectNodeContents(target);
        right.setStartAfter(marker);
        var beforeText = left.toString();
        var afterText = right.toString();
        var leftSpace = beforeText && !/\s$/.test(beforeText) ? ' ' : '';
        var rightSpace = afterText && !/^\s/.test(afterText) ? ' ' : '';
        marker.textContent = leftSpace + spoken.trim() + rightSpace;
      },
      finish: function () {
        if (marker && marker.parentNode) {
          var text = document.createTextNode(marker.textContent);
          marker.parentNode.replaceChild(text, marker);
          target.normalize();
          var caret = document.createRange();
          caret.setStartAfter(text);
          caret.collapse(true);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(caret);
          target.dispatchEvent(new Event('input', { bubbles: true }));
        }
        target.focus();
      }
    };
  }

  function startKanbanDictation() {
    if (activeKanbanDictationStop) { activeKanbanDictationStop(); return; }
    var target = kanbanDictationTarget || fieldNotes;
    var insertion = dictationInsertion(target);
    var Voice = window.RMVoice;
    var SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

    function recording(on) {
      kanbanDictateBtn.classList.toggle('recording', on);
      kanbanDictateBtn.querySelector('span').textContent = on ? 'Stop' : ('Dictate ' + (target === fieldTitle ? 'title' : 'notes'));
      kanbanDictateBtn.title = on ? 'Stop dictation' : 'Dictate into ' + (target === fieldTitle ? 'title' : 'notes');
      kanbanDictateBtn.setAttribute('aria-label', kanbanDictateBtn.title);
      kanbanDictationStatus.textContent = on ? 'Listening… click Stop when finished.' : '';
    }

    function completed(text) {
      activeKanbanDictationStop = null;
      recording(false);
      insertion.finish();
      kanbanDictationStatus.textContent = text ? 'Dictation added and saving…' : 'No speech detected.';
      if (text) debounceSync();
    }

    if (SpeechRecognitionCtor) {
      var recognition = new SpeechRecognitionCtor();
      var finalTranscript = '';
      var latestTranscript = '';
      var recognitionFailed = false;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.addEventListener('result', function (event) {
        var interim = '';
        for (var i = event.resultIndex; i < event.results.length; i++) {
          var chunk = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalTranscript += chunk + ' ';
          else interim += chunk;
        }
        latestTranscript = finalTranscript + interim;
        insertion.update(latestTranscript);
      });
      recognition.addEventListener('end', function () {
        if (!recognitionFailed) completed(latestTranscript || finalTranscript);
      });
      recognition.addEventListener('error', function (event) {
        recognitionFailed = true;
        activeKanbanDictationStop = null;
        recording(false);
        insertion.finish();
        if (latestTranscript) debounceSync();
        if (event.error !== 'aborted' && event.error !== 'no-speech') kanbanDictationStatus.textContent = 'Microphone error: ' + event.error;
      });
      activeKanbanDictationStop = function () { recognition.stop(); };
      recording(true);
      try { recognition.start(); } catch (error) {
        activeKanbanDictationStop = null;
        recording(false);
        kanbanDictationStatus.textContent = 'Could not start the microphone.';
      }
      return;
    }

    if (!Voice) { kanbanDictationStatus.textContent = 'Voice dictation is unavailable in this browser.'; return; }
    kanbanDictateBtn.disabled = true;
    Voice.startRecording().then(function (recorder) {
      kanbanDictateBtn.disabled = false;
      recording(true);
      activeKanbanDictationStop = function () {
        activeKanbanDictationStop = null;
        recording(false);
        kanbanDictateBtn.disabled = true;
        kanbanDictationStatus.textContent = 'Transcribing…';
        recorder.stop().then(Voice.transcribe).then(function (text) {
          if (text) insertion.update(text);
          completed(text);
        }).catch(function (error) {
          kanbanDictationStatus.textContent = error.message || 'Could not transcribe audio.';
        }).finally(function () { kanbanDictateBtn.disabled = false; });
      };
    }).catch(function () {
      kanbanDictateBtn.disabled = false;
      kanbanDictationStatus.textContent = 'Could not access the microphone. Check its permission.';
    });
  }

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
    kanbanDictateBtn = document.getElementById('kanbanDictateBtn');
    kanbanDictationStatus = document.getElementById('kanbanDictationStatus');

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
    approveBtn = document.getElementById('approveBtn');
    stageField = document.getElementById('stageField');
    stageReadoutField = document.getElementById('stageReadoutField');
    stageReadout = document.getElementById('stageReadout');

    Store.STAGES.filter(function (s) { return MANUAL_STAGE_IDS.indexOf(s.id) !== -1; }).forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.id; o.textContent = s.label;
      fieldStage.appendChild(o);
    });
    var unselectedType = document.createElement('option');
    unselectedType.value = '';
    unselectedType.textContent = 'Not selected';
    fieldContentType.appendChild(unselectedType);
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
    fieldTitle.addEventListener('focus', function () { setKanbanDictationTarget(fieldTitle); });
    fieldNotes.addEventListener('focus', function () { setKanbanDictationTarget(fieldNotes); });
    kanbanDictateBtn.addEventListener('pointerdown', function (event) { event.preventDefault(); });
    kanbanDictateBtn.addEventListener('click', startKanbanDictation);
    setKanbanDictationTarget(fieldNotes);
    fieldTranscript.addEventListener('input', debounceSync);
    fieldTranscript.addEventListener('blur', function () { clearTimeout(saveTimer); syncFromForm(); });
    [fieldYtTitle1, fieldYtTitle2, fieldYtTitle3].forEach(function (el) {
      el.addEventListener('input', debounceSync);
      el.addEventListener('blur', function () { clearTimeout(saveTimer); syncFromForm(); });
    });
    fieldStage.addEventListener('change', function () { clearTimeout(saveTimer); syncFromForm(); });
    fieldContentType.addEventListener('change', function () {
      if (activeId && pieces[activeId]) {
        pieces[activeId].contentTypeSelectionExplicit = fieldContentType.value !== '';
      }
      var preset = PLATFORM_PRESET_BY_TYPE[fieldContentType.value] || [];
      platformGrid.querySelectorAll('.platform-toggle').forEach(function (t) {
        var checked = preset.indexOf(t.dataset.platform) !== -1;
        t.classList.toggle('checked', checked);
        t.querySelector('input').checked = checked;
      });
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
        syncTags(p);
        Store.put('pieces', p).then(function () {
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
    approveBtn.addEventListener('click', function () {
      if (!activeId) return;
      var p = pieces[activeId];
      if (!p) return;
      approveAndSchedule(p).then(function () {
        return Store.put('pieces', p);
      }).then(function () {
        updateStageAndScheduleUI(p);
        flashSaved();
        notifyPieceMoved(p.id);
      });
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
      Store.del('pieces', id, p).then(function () {
        delete pieces[id];
        if (p && p.hasVideo) Store.del('videos', id);
        activeId = null;
        hideModal();
        notifyPiecesChanged();
      }).catch(function () {});
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

  // Same idea as notifyPiecesChanged, but for the specific case of one
  // piece's *stage* changing — prefers the real move animation
  // (window.__rmOnPieceMoved, only set while Content Ops is booted, see
  // animateBoardMove) so any stage-changing action anywhere in the app
  // gets the same live "it moved" feedback, not just the two poller
  // paths this originally shipped with. Falls back to a plain re-render
  // if Content Ops isn't the currently booted tab (e.g. a save landing
  // from the shared modal while Content Production is active) — animate
  // has nothing useful to animate against then anyway.
  function notifyPieceMoved(id) {
    if (typeof window.__rmOnPieceMoved === 'function') window.__rmOnPieceMoved(id);
    else notifyPiecesChanged();
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

  // Which platforms each caption "group" covers, and their display
  // labels/order — mirrors PLATFORM_PRESET_BY_TYPE exactly (a shortform
  // piece can only ever be tagged ytshort/tiktok/instagram/facebook; a
  // longform piece only ytlong/facebook), so every platform a piece is
  // actually tagged with always has a caption field to land in. This is
  // also the tab order shown both in Settings and on the Final Check
  // card's toggle (§Captions restructure, 2026-09-20, Harvey's ask —
  // shortform: FB/IG/TT/Shorts, longform: YT/FB, each independently
  // editable).
  var CAPTION_GROUPS = {
    shortform: [
      { key: 'ytshort', label: 'YT Shorts' },
      { key: 'tiktok', label: 'TikTok' },
      { key: 'instagram', label: 'Instagram' },
      { key: 'facebook', label: 'Facebook' }
    ],
    longform: [
      { key: 'ytlong', label: 'YouTube' },
      { key: 'facebook', label: 'Facebook' }
    ]
  };

  function captionGroupKeyFor(p) {
    return p.contentType === 'longform' ? 'longform' : 'shortform';
  }

  // One entry per platform this piece is actually tagged with (Content
  // Production's platform checkboxes, §128) that also belongs to its
  // content-shape's caption group — e.g. a longform piece tagged for
  // both YouTube and Facebook gets both a YouTube entry and a Facebook
  // entry, each carrying its own independently-set template, so both
  // descriptions can be shown side by side (Harvey: "it will show BOTH
  // the youtube description AND the FB description... if I unselected
  // FB in production, only the YT description would show"). Unchecking
  // a platform in Content Production removes it from p.platforms, which
  // is exactly what makes it disappear from this list too — no separate
  // filtering needed.
  function captionsForPiece(settings, p) {
    var groupKey = captionGroupKeyFor(p);
    var group = (settings.captions && settings.captions[groupKey]) || {};
    var platforms = p.platforms || [];
    return CAPTION_GROUPS[groupKey]
      .filter(function (o) { return platforms.indexOf(o.key) !== -1; })
      .map(function (o) {
        var template = group[o.key] || '';
        var hasText = !!template.trim();
        return {
          key: o.key,
          label: o.label,
          template: template,
          empty: !hasText,
          text: hasText ? Store.applyCaptionLink(template, buildUtmLink(p, settings)) : ''
        };
      });
  }

  // Single-winner version for the shared editor modal's one-line caption
  // readout, which has no room for a multi-tab toggle — the first
  // tagged-and-non-empty caption in CAPTION_GROUPS' own order.
  function captionTemplateFor(settings, p) {
    var entries = captionsForPiece(settings, p).filter(function (e) { return !e.empty; });
    return entries.length ? entries[0].template : '';
  }

  function renderCaptionText(p, settings) {
    var template = captionTemplateFor(settings, p);
    if (!template || !template.trim()) return 'No caption set for this type yet — add one in Settings.';
    return Store.applyCaptionLink(template, buildUtmLink(p, settings));
  }

  function updateStageAndScheduleUI(p) {
    stageReadout.textContent = stageLabelOf(p.stage);
    if (p.stage === 'scheduled' && p.scheduledAt) {
      scheduleStatus.textContent = 'Scheduled for ' + fmtFull(p.scheduledAt);
    } else if (p.stage === 'live') {
      scheduleStatus.textContent = p.scheduledAt ? ('Posted ' + fmtFull(p.scheduledAt)) : 'Posted — connect an API in Settings to confirm.';
    } else if (p.stage === 'final_check') {
      scheduleStatus.textContent = 'In Final Check — review the video, then approve to schedule it.';
    } else if (!p.audioTrackId) {
      scheduleStatus.textContent = 'Pick a backing audio track and a thumbnail, then send it to Final Check.';
    } else if (!p.thumbnailDataUrl) {
      scheduleStatus.textContent = 'Audio picked — pick a thumbnail frame, then send it to Final Check.';
    } else {
      scheduleStatus.textContent = 'Ready — head to the Upload Files list to send this to Final Check.';
    }
    approveBtn.hidden = p.stage !== 'final_check';
  }

  function populateFields(p) {
    fieldTitle.value = p.title || '';
    fieldContentType.value = p.contentType || '';
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

  // Called after populateFields() from both openPiece() and createDraft()
  // below. For admin, or a reviewer viewing/editing something it created
  // itself, this is a no-op — everything stays exactly as normal. For a
  // reviewer viewing an existing piece it didn't create, it locks down
  // every field (including non-YouTube platform checkboxes even on its
  // own pieces) so nothing in the modal can silently attempt an edit the
  // server would reject anyway. The modal's DOM nodes are reused across
  // opens (bootModal() only builds them once), so this has to actively
  // restore the editable state too, not just disable it — otherwise a
  // previously-viewed read-only piece would leave every field disabled
  // for the next, genuinely-editable one.
  function applyReviewerModalGate(p) {
    if (!IS_REVIEWER) return;
    var editable = isOwnedByReviewer(p);
    fieldTitle.disabled = !editable;
    fieldStage.disabled = !editable;
    fieldContentType.disabled = !editable;
    fieldNotes.contentEditable = editable ? 'true' : 'false';
    kanbanDictateBtn.disabled = !editable;
    platformGrid.querySelectorAll('.platform-toggle').forEach(function (t) {
      var isYoutube = t.dataset.platform === 'ytshort' || t.dataset.platform === 'ytlong';
      t.querySelector('input').disabled = !editable || !isYoutube;
    });
    fieldTranscript.disabled = !editable;
    fieldAudioTrack.disabled = !editable;
    pickFrameBtn.disabled = !editable;
    scrubRange.disabled = !editable;
    captureFrameBtn.disabled = !editable;
    fieldYtTitle1.disabled = !editable;
    fieldYtTitle2.disabled = !editable;
    fieldYtTitle3.disabled = !editable;
    if (!editable) approveBtn.hidden = true;
    btnDelete.hidden = !editable;
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
      applyReviewerModalGate(p);
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
      id: id, seq: Store.nextSeq(allPiecesArray()), title: '', stage: stageId, platforms: [], contentType: '', contentTypeSelectionExplicit: false, notesHtml: '', hasVideo: false,
      order: minOrder(stageId) - 10,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    // A reviewer session creating a brand-new idea/piece owns it outright —
    // server.js forces this too on the first save regardless of what's
    // sent, this just keeps the client's own view consistent immediately.
    if (IS_REVIEWER) pieces[id].createdBy = 'youtube-reviewer';
    activeId = id;
    isNewUnsaved = true;
    onModalClosed = closedCb || null;
    disarmDelete();
    modalEyebrowText.textContent = 'New piece';
    showModalIdBadge(pieces[id]);
    populateFields(pieces[id]);
    applyReviewerModalGate(pieces[id]);
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
    if (activeKanbanDictationStop) activeKanbanDictationStop();
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
      contentTypeSelectionExplicit: !!(p && p.contentTypeSelectionExplicit),
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
    var prevStage = p.stage;
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
      syncTags(p);
      Store.getSettings().then(function (settings) {
        fieldUtmLink.value = buildUtmLink(p, settings);
        captionReadout.textContent = renderCaptionText(p, settings);
      });
    }

    Store.put('pieces', p).then(function () {
      if (p.hasVideo) updateStageAndScheduleUI(p);
      flashSaved();
      if (p.stage !== prevStage) notifyPieceMoved(p.id);
      else notifyPiecesChanged();
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
  var boardSettingsCache = null;
  // Which caption tab is currently selected on each Final Check card,
  // keyed by piece id — ephemeral (not persisted, resets on page load),
  // just enough to survive re-renders within the same page session.
  var fcCaptionTab = {};
  // Fetched once in bootContentOps (mirrors boardSettingsCache just above)
  // so a Final Check card's "Schedule Video" button can tell whether
  // there's actually a connected account to publish to, without every
  // card making its own request.
  var youtubeStatusCache = null;
  var tiktokStatusCache = null;

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

  // opts.hideVideoChip: Final Check cards (finalCheckCardHtml) only ever
  // show a piece that already has a video (§115's whole point of the
  // stage), so the "▶ video" chip there is pure noise — Harvey,
  // 2026-09-20: "theyre lit4erally all videos." Left on for the normal
  // kanban card (cardHtml), where it still usefully distinguishes an
  // uploaded video piece from a plain planning card.
  function chipHtml(piece, opts) {
    opts = opts || {};
    var out = '';
    (piece.platforms || []).forEach(function (pid) {
      var p = Store.PLATFORMS.filter(function (x) { return x.id === pid; })[0];
      if (!p) return;
      out += '<span class="chip"><span class="dot" style="background:' + p.color + '"></span>' + p.label + '</span>';
    });
    var ct = contentTypeOf(piece.contentType);
    out += '<span class="chip format"><span class="dot" style="background:' + ct.color + '"></span>' + ct.label + '</span>';
    if (piece.hasVideo && !opts.hideVideoChip) out += '<span class="chip video-chip">▶ video</span>';
    return out;
  }

  function cardHtml(id, piece) {
    var title = (piece.title || '').trim();
    var titleHtml = title ? escapeHtml(title) : 'Untitled piece';
    var titleClass = title ? 'card-title' : 'card-title untitled';
    var isAuto = !!piece.hasVideo;
    var isAi = piece.createdBy === 'agent';
    // A reviewer session can view any card but only drag/re-stage ones it
    // created itself — draggable=false and a disabled stage-select cover
    // both the drag-and-drop path and the dropdown path (see
    // bindBoardEvents/openKanbanCtxMenu for the modal + right-click-delete
    // gates on the same rule).
    var canEdit = canEditPiece(piece);
    var moveControl = isAuto
      ? '<span class="auto-stage-badge">Auto · ' + stageLabelOf(piece.stage) + '</span>'
      : (function () {
          var stageOpts = Store.STAGES.filter(function (s) { return MANUAL_STAGE_IDS.indexOf(s.id) !== -1; }).map(function (s) {
            return '<option value="' + s.id + '"' + (s.id === piece.stage ? ' selected' : '') + '>' + s.label + '</option>';
          }).join('');
          return '<select class="card-move" data-id="' + id + '"' + (canEdit ? '' : ' disabled') + '>' + stageOpts + '</select>';
        })();
    var idBadge = typeof piece.seq === 'number' ? '<span class="card-id">#' + String(piece.seq).padStart(3, '0') + '</span>' : '';
    // Plain ideas never have one; a video piece almost always does once
    // it's past Processing (§128's auto-capture) — Harvey asked for this
    // after noticing a normal (non-Final-Check) kanban card gave no
    // visual hint at all of which video it actually was.
    var thumbHtml = piece.thumbnailDataUrl ? '<div class="card-thumb"><img src="' + piece.thumbnailDataUrl + '" alt="" /></div>' : '';
    // Replaces the old "Thumbnail Selected" stage column — same auto-set
    // tags rendered as small chips wherever a video piece's card shows up
    // (this board and the upload list), see syncTags.
    var tagsHtml = (piece.tags || []).length
      ? '<div class="card-tags">' + piece.tags.map(function (tagId) {
          var def = Store.TAGS.filter(function (t) { return t.id === tagId; })[0];
          return def ? '<span class="tag-chip">' + def.label + '</span>' : '';
        }).join('') + '</div>'
      : '';
    return '' +
      '<div class="card' + (isAuto ? ' card-auto' : '') + (isAi ? ' card-ai' : '') + '" draggable="' + (isAuto || !canEdit ? 'false' : 'true') + '" data-id="' + id + '"' + (isAi ? ' title="Created by Claude Code"' : '') + '>' +
        (isAuto ? '' : '<span class="card-grip">⋮⋮</span>') +
        thumbHtml +
        idBadge +
        '<div class="' + titleClass + '">' + titleHtml + '</div>' +
        // Redundant on any video card — the thumbnail + "Auto · <stage>"
        // badge already make it obvious this is a video, same reasoning
        // §135 already applied to Final Check cards ("theyre literally
        // all videos"); Harvey asked for this to be dropped everywhere,
        // not just there.
        '<div class="chip-row">' + chipHtml(piece, { hideVideoChip: true }) + '</div>' +
        tagsHtml +
        '<div class="card-foot">' +
          '<span class="card-time">' + fmtTime(piece.updatedAt) + '</span>' +
          moveControl +
        '</div>' +
      '</div>';
  }

  // Final Check gets a fundamentally different, much bigger card — per
  // Harvey, the whole point of this stage is a quick final review (play
  // the actual video, read the caption, check the 3 titles, approve) done
  // right there on the board, not a click-through into the editor. Not a
  // variant of cardHtml(): deliberately its own class (`.final-check-card`,
  // not `.card`) so it's excluded from the generic click-to-open-modal and
  // drag-start bindings in bindBoardEvents() below.
  //
  // A piece can be tagged for more than one platform in its caption group
  // (e.g. a longform video going to both YouTube and Facebook) — when
  // that's the case, show a small tab strip so Harvey can flip between
  // each platform's own description instead of only ever seeing one
  // (2026-09-20). A single-platform piece just shows its one caption with
  // no tabs, same as before this change.
  function fcCaptionInnerHtml(id, piece, settings) {
    if (!settings) return '<div class="fc-caption">Loading caption…</div>';
    var entries = captionsForPiece(settings, piece);
    if (!entries.length) {
      return '<div class="fc-caption">No caption set for this type yet — add one in Settings.</div>';
    }
    var emptyText = function (e) { return 'No caption set for ' + e.label + ' yet — add one in Settings.'; };
    if (entries.length === 1) {
      var only = entries[0];
      return '<div class="fc-caption">' + escapeHtml(only.empty ? emptyText(only) : only.text) + '</div>';
    }
    var savedKey = fcCaptionTab[id];
    var active = entries.filter(function (e) { return e.key === savedKey; })[0] || entries[0];
    return '' +
      '<div class="fc-caption-tabs">' +
        entries.map(function (e) {
          return '<button type="button" class="fc-caption-tab' + (e.key === active.key ? ' active' : '') +
            '" data-id="' + id + '" data-key="' + e.key + '">' + escapeHtml(e.label) + '</button>';
        }).join('') +
      '</div>' +
      '<div class="fc-caption">' + escapeHtml(active.empty ? emptyText(active) : active.text) + '</div>';
  }

  // Wrapped in one container so a tab click can refresh just this piece's
  // caption area in place (see bindBoardEvents' .fc-caption-tab handler)
  // without re-rendering the whole card — re-rendering would reset the
  // <video>'s playback position/state, which Harvey doesn't want on a
  // simple caption toggle.
  function fcCaptionSectionHtml(id, piece, settings) {
    return '<div class="fc-caption-section" data-id="' + id + '">' + fcCaptionInnerHtml(id, piece, settings) + '</div>';
  }

  function finalCheckCardHtml(id, piece) {
    var titles = piece.ytTitles || [];
    // "Title 1: x" / "Title 2: y" plain lines, not a numbered list, sized
    // to match the main-title heading this replaced (Harvey: "remove
    // bottom one [the #094 — <title> heading, redundant with Title 1],
    // make these a bit larger, same size as [that removed heading]").
    // A shortform piece only ever has one title slot now (§131 — no
    // rotation/testing for a short, so Content Production only collects
    // one), so numbering it "Title 1:" implied a second option that
    // doesn't exist — just "Title:" when there's exactly one (Harvey,
    // 2026-09-20). Longform still numbers, since it genuinely can have
    // up to 3.
    var titlesHtml = titles.length
      ? '<div class="fc-titles">' + titles.map(function (t, i) {
          var label = titles.length === 1 ? 'Title' : ('Title ' + (i + 1));
          return '<div class="fc-title-line"><strong>' + label + ':</strong> ' + escapeHtml(t) + '</div>';
        }).join('') + '</div>'
      : '<div class="fc-titles-empty">No title options set.</div>';
    // A piece never reaches this stage without its final (audio-spliced)
    // video already having been built — server.js's runBuildFinalVideo
    // only flips the stage to final_check once that's genuinely done —
    // so this always points at the real "<id>-final" file, never the raw
    // upload, matching Harvey's whole point of this stage: what's playing
    // here is what actually gets published.
    //
    // Deliberately no way to open the shared editor modal from here —
    // Harvey's explicit ask: Final Check should be a closed, complete
    // review surface (title(s), video, caption, post locations/type,
    // approve), no click-through to anything else. chipHtml() reuses the
    // exact same platform/content-type chips the normal kanban cards
    // already show, so "post locations, type" needs no new rendering
    // logic of its own.
    //
    // No native `controls` at all (2026-09-19, second attempt at this —
    // see bindBoardEvents()'s comment on the .fc-video-wrap loop for why
    // the first attempt, a partial overlay that left the native control
    // bar strip uncovered, still wasn't reliably clickable on Harvey's
    // real device). Fully custom now: the whole frame is one click
    // target, and a big green play-button glyph (`.fc-play-icon`, hidden
    // once playing) doubles as both "click anywhere to play" affordance
    // and the placeholder Harvey asked for. Losing native scrub/volume/
    // fullscreen is the real trade-off — acceptable for a quick review
    // clip; worth adding a minimal custom scrub bar later if that's
    // missed in practice.
    //
    // Third attempt at click-to-play (2026-09-19, same day): Harvey
    // reported this version played *nothing at all* on click, worse than
    // §119's partial fix. Root cause, on reflection: a separate overlay
    // `<div>` sitting on top of the video as the actual click target
    // (needed in §119 to avoid the native control bar, which no longer
    // exists now that `controls` is gone) was unnecessary indirection —
    // and indirection through a sibling element is exactly where a
    // cross-browser/mobile hit-testing quirk could hide. Simplified to
    // the most direct possible binding: the click listener now lives on
    // the bare `<video>` itself (see bindBoardEvents()), which — with no
    // `controls` and therefore no shadow-DOM native chrome at all — is
    // just an ordinary interactive element with nothing standing between
    // a tap and the listener. `.fc-video-overlay` is now purely
    // decorative (`pointer-events: none` in CSS): it only paints the
    // green play icon, it can no longer be a place for clicks to go
    // missing.
    return '' +
      '<div class="final-check-card" data-id="' + id + '">' +
        '<div class="fc-video-wrap' + (piece.videoIsVertical ? ' is-vertical' : '') + '">' +
          '<video class="fc-video" data-id="' + id + '" playsinline preload="metadata"' +
            (piece.thumbnailDataUrl ? ' poster="' + piece.thumbnailDataUrl + '"' : '') +
            ' src="/api/files/videos/' + encodeURIComponent(id) + '-final"></video>' +
          '<div class="fc-video-overlay">' +
            '<span class="fc-play-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 6l10 6-10 6V6Z"/></svg></span>' +
          '</div>' +
        '</div>' +
        titlesHtml +
        fcCaptionSectionHtml(id, piece, boardSettingsCache) +
        '<div class="chip-row">' + chipHtml(piece, { hideVideoChip: true }) + '</div>' +
        // "Schedule Video" (below) is the one and only action on this
        // card now — the old separate "Approve → Scheduled" button
        // (§111's original cadence-only approval, pre-dating any real
        // publish integration) used to sit right next to it, which
        // caused a real, confirmed bug: Harvey clicked what he read as
        // "the" schedule button and got the old one, which just flips
        // the piece to the 'scheduled' stage via the cadence scheduler
        // without publishing anything anywhere — no error, so nothing
        // looked wrong until he checked TikTok and found nothing there.
        // Removed outright rather than relabeled, since two buttons that
        // both plausibly mean "make this go out" is the actual problem,
        // not just their wording.
        '<div class="fc-actions">' +
          fcScheduleVideoHtml(id, piece) +
        '</div>' +
      '</div>';
  }

  // Platforms that actually have a real backend publish integration wired
  // up right now — YouTube and TikTok. Harvey's framing (2026-09-20): the
  // button here should read as one generic scheduling/publish action that
  // goes out to every platform a piece is tagged for, not "Publish to
  // <platform>" — it just happens that only these two platforms can
  // genuinely act on that so far. Extend this list (and the per-platform
  // helpers right below) as other platforms get real integrations.
  var WIRED_PUBLISH_PLATFORMS = ['ytlong', 'tiktok'];
  var PUBLISH_PLATFORM_LABELS = { ytlong: 'YouTube', tiktok: 'TikTok' };
  // A youtube-reviewer session only ever gets YouTube — TikTok has nothing
  // to do with why this account exists, and server.js's /api/tiktok
  // blanket rejects it outright anyway (401), so there's no point ever
  // offering it here.
  function effectiveWiredPlatforms() { return IS_REVIEWER ? ['ytlong'] : WIRED_PUBLISH_PLATFORMS; }

  function publishStatusFieldFor(platform) { return platform === 'ytlong' ? 'youtubePublishStatus' : 'tiktokPublishStatus'; }
  function publishErrorFieldFor(platform) { return platform === 'ytlong' ? 'youtubePublishError' : 'tiktokPublishError'; }
  function publishEndpointFor(platform) { return platform === 'ytlong' ? '/api/youtube/publish/' : '/api/tiktok/publish/'; }
  function publishPlatformConnected(platform) {
    var cache = platform === 'ytlong' ? youtubeStatusCache : tiktokStatusCache;
    return !!(cache && cache.connected);
  }

  // "Schedule Video" — a single action covering every platform a piece is
  // tagged for. Always shown on a Final Check card (every card here has a
  // real video), rather than gated to one specific platform, since the
  // whole point is it's not platform-specific. Whichever tagged platforms
  // are actually wired get a real, immediate publish on click — no
  // scheduled-time delay, per Harvey's own "for this test we can publish
  // immediately" — and any tagged platform that isn't wired yet is called
  // out honestly rather than silently ignored. Known limitation, not
  // built: a piece tagged for *both* wired platforms at once fires both
  // publishes concurrently with no coordination between the two
  // background jobs writing to the same piece record (see the matching
  // comment on runTiktokPublish in server.js) — fine for Harvey's actual
  // test plan (one platform per piece), not fine if that ever changes.
  function fcScheduleVideoHtml(id, piece) {
    // A reviewer session can only ever schedule a piece it made itself —
    // server.js enforces this too (real 403 on the publish routes), this
    // just avoids offering a button that would fail.
    if (!canEditPiece(piece)) {
      return '<div class="fc-yt-publish"><button type="button" class="btn-secondary" disabled title="You can only publish a video you uploaded yourself">Schedule Video</button></div>';
    }
    var wiredPlatforms = effectiveWiredPlatforms();
    var platforms = piece.platforms || [];
    var wired = platforms.filter(function (p) { return wiredPlatforms.indexOf(p) !== -1; });
    var unwired = platforms.filter(function (p) { return wiredPlatforms.indexOf(p) === -1; });

    var anyPending = wired.some(function (p) {
      var s = piece[publishStatusFieldFor(p)];
      return s === 'pending' || s === 'running';
    });
    if (anyPending) {
      return '<div class="fc-yt-publish"><button type="button" class="btn-secondary" disabled>Publishing…</button></div>';
    }

    var erroredPlatforms = wired.filter(function (p) { return piece[publishStatusFieldFor(p)] === 'error' && piece[publishErrorFieldFor(p)]; });
    var errorHtml = erroredPlatforms.map(function (p) {
      return '<div class="fc-yt-error">' + escapeHtml(PUBLISH_PLATFORM_LABELS[p] || p) + ' publish failed: ' + escapeHtml(piece[publishErrorFieldFor(p)]) + '</div>';
    }).join('');
    var notWiredNote = unwired.length
      ? '<div class="fc-yt-note">' + escapeHtml(unwired.join(', ')) + ' not wired up yet — won\'t be published there.</div>'
      : '';
    if (!wired.length) {
      return '' +
        '<div class="fc-yt-publish">' +
          '<button type="button" class="btn-secondary" disabled title="None of this piece\'s selected platforms can be published yet">Schedule Video</button>' +
          notWiredNote +
        '</div>';
    }
    var disconnected = wired.filter(function (p) { return !publishPlatformConnected(p); });
    var disabledAttr = disconnected.length
      ? ' disabled title="Connect ' + disconnected.map(function (p) { return PUBLISH_PLATFORM_LABELS[p] || p; }).join(' / ') + ' in Content Settings first"'
      : '';
    // The privacy select only ever affects YouTube — TikTok is forced to
    // SELF_ONLY (private) regardless while unaudited/sandboxed, so there's
    // no real choice to offer for it yet.
    var privacySelectHtml = wired.indexOf('ytlong') !== -1
      ? '' +
        '<select class="fc-yt-privacy" data-id="' + id + '" title="YouTube visibility">' +
          '<option value="private" selected>Private</option>' +
          '<option value="unlisted">Unlisted</option>' +
          '<option value="public">Public</option>' +
        '</select>'
      : '';
    // TikTok's Content Sharing Guidelines require showing a Music Usage
    // Confirmation and a Branded Content disclosure before every post —
    // added 2026-09-20 after these were flagged as a real gap between the
    // TikTok app-review demo page's mockup (§122) and the actual shipped
    // product. Music Usage has no real API field to send (it's a
    // developer-side compliance gate, per TikTok's docs, not a post
    // parameter) — enforced client-side, blocking the click if unchecked,
    // right below. Branded Content is real: `brand_content_toggle` is
    // threaded through to TikTok's own API (tiktokAuth.js). Only shown
    // when TikTok is actually a wired-and-tagged platform for this piece —
    // YouTube has no equivalent requirement.
    var tiktokConsentHtml = wired.indexOf('tiktok') !== -1
      ? '' +
        '<div class="fc-tiktok-consent">' +
          '<label><input type="checkbox" class="fc-music-usage" data-id="' + id + '" /> I confirm this content complies with TikTok’s Music Usage Confirmation</label>' +
          '<label><input type="checkbox" class="fc-branded-content" data-id="' + id + '" /> This is branded content</label>' +
        '</div>'
      : '';
    return '' +
      '<div class="fc-yt-publish">' +
        privacySelectHtml +
        '<button type="button" class="btn-secondary fc-yt-publish-btn" data-id="' + id + '"' + disabledAttr + '>' +
          (erroredPlatforms.length ? 'Retry' : 'Schedule Video') +
        '</button>' +
        tiktokConsentHtml +
        notWiredNote +
        errorHtml +
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
      var isFinalCheck = s.id === 'final_check';
      var cards = ids.map(function (id) { return isFinalCheck ? finalCheckCardHtml(id, pieces[id]) : cardHtml(id, pieces[id]); }).join('');
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

  // A real move animation, originally built (2026-09-20) for just one
  // case — a card's *stage* changing because a background job finished
  // (Processing -> Final Check once a video build completes, Final Check
  // -> Posted/Live once a publish succeeds) — then generalized the same
  // day to every other stage-changing action too: manual drag-and-drop,
  // the .card-move dropdown, and the shared modal's Approve button /
  // Stage field (via notifyPieceMoved). Plain FLIP technique: read the
  // card's current on-screen position, let the normal full render()
  // happen, then read its new position and animate the visual gap
  // between them rather than letting it just teleport into the new
  // column/position. Deliberately not hooked into every render() call —
  // search/filter/type-filter changes don't move any single card in a
  // way worth animating and aren't routed through this; only genuine
  // stage/position-changing actions call it.
  function animateBoardMove(id) {
    var oldEl = board.querySelector('[data-id="' + id + '"]');
    var oldRect = oldEl ? oldEl.getBoundingClientRect() : null;
    render();
    if (!oldRect) return;
    var newEl = board.querySelector('[data-id="' + id + '"]');
    if (!newEl) return;
    var newRect = newEl.getBoundingClientRect();
    var dx = oldRect.left - newRect.left;
    var dy = oldRect.top - newRect.top;
    if (!dx && !dy) return;
    newEl.style.transition = 'none';
    newEl.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    newEl.style.zIndex = '5';
    void newEl.offsetWidth; // force a reflow so the transform above is actually applied before animating away from it
    newEl.style.transition = 'transform 480ms cubic-bezier(.22,.68,.32,1)';
    newEl.style.transform = '';
    newEl.classList.add('card-just-moved');
    setTimeout(function () {
      newEl.style.transition = '';
      newEl.style.zIndex = '';
      newEl.classList.remove('card-just-moved');
    }, 900);
  }

  // Scoped separately from bindBoardEvents() so a caption-tab click can
  // rebind just the small chunk of DOM it just replaced, instead of
  // re-running bindBoardEvents() (which would add a second set of
  // listeners on every other card/button already on the board).
  function bindCaptionTabs(scopeEl) {
    scopeEl.querySelectorAll('.fc-caption-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.id;
        var p = pieces[id];
        if (!p) return;
        fcCaptionTab[id] = btn.dataset.key;
        var target = board.querySelector('.fc-caption-section[data-id="' + id + '"]');
        if (!target) return;
        target.innerHTML = fcCaptionInnerHtml(id, p, boardSettingsCache);
        bindCaptionTabs(target);
      });
    });
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

    // Final Check cards — deliberately not `.card`, so none of the
    // click-to-open-modal/drag bindings above apply to them at all.
    //
    // Third attempt at click-to-play (2026-09-19, see finalCheckCardHtml()
    // for the fuller history). This time the click listener binds
    // directly to the bare `<video>` element — no overlay `<div>` in the
    // way at all, since there's no native `controls` chrome left to route
    // around and an overlay was only ever needed to dodge that. Removing
    // the indirection removes the one remaining place a hit-testing quirk
    // could hide. `.fc-video-overlay` (still in the markup) is now
    // `pointer-events: none` in CSS — purely decorative, paints the green
    // play icon and nothing else.
    board.querySelectorAll('.fc-video-wrap').forEach(function (wrap) {
      var v = wrap.querySelector('video');
      if (!v) return;
      function syncPlayState() { wrap.classList.toggle('is-playing', !v.paused); }
      v.addEventListener('click', function () {
        if (v.paused) v.play().catch(function () {}); else v.pause();
      });
      v.addEventListener('play', syncPlayState);
      v.addEventListener('pause', syncPlayState);
      syncPlayState();
    });
    // Real YouTube publish — kicks off the background upload
    // (server.js's runYoutubePublish) and switches this one card into a
    // disabled "Publishing…" state without a full render(), matching the
    // same "don't reset the video's playback" reasoning as the caption-tab
    // toggle. The poller below (maybeStartYoutubePublishPoll) is what
    // notices the eventual done/error and does the full render() once the
    // piece's stage/status actually changes.
    // Fires a real, independent publish request per wired-and-tagged
    // platform (currently ytlong and/or tiktok) — see fcScheduleVideoHtml's
    // comment above about the known concurrency limitation if a piece is
    // ever tagged for both at once.
    board.querySelectorAll('.fc-yt-publish-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.id;
        var p = pieces[id];
        if (!p || btn.disabled || !canEditPiece(p)) return;
        var platforms = (p.platforms || []).filter(function (pl) { return effectiveWiredPlatforms().indexOf(pl) !== -1; });
        if (!platforms.length) return;
        var wrap = btn.closest('.fc-yt-publish');
        var select = wrap ? wrap.querySelector('.fc-yt-privacy') : null;
        var privacyStatus = select ? select.value : 'private';

        var existingWarn = wrap ? wrap.querySelector('.fc-tiktok-consent-warn') : null;
        if (existingWarn) existingWarn.remove();

        // TikTok's Content Sharing Guidelines require confirming Music
        // Usage before every post — gate the whole click on it (rather
        // than silently skipping just the TikTok half) so it's obvious
        // why nothing went out, instead of Harvey wondering later.
        var musicCheckbox = wrap ? wrap.querySelector('.fc-music-usage') : null;
        var brandedCheckbox = wrap ? wrap.querySelector('.fc-branded-content') : null;
        if (platforms.indexOf('tiktok') !== -1 && musicCheckbox && !musicCheckbox.checked) {
          var warn = document.createElement('div');
          warn.className = 'fc-yt-error fc-tiktok-consent-warn';
          warn.textContent = 'Confirm the Music Usage checkbox above before scheduling to TikTok.';
          wrap.appendChild(warn);
          return;
        }
        var brandedContent = !!(brandedCheckbox && brandedCheckbox.checked);

        var captions = boardSettingsCache ? captionsForPiece(boardSettingsCache, p) : [];
        var title = (p.ytTitles && p.ytTitles[0]) || p.title || 'Untitled';

        btn.disabled = true;
        btn.textContent = 'Publishing…';
        if (select) select.disabled = true;
        if (musicCheckbox) musicCheckbox.disabled = true;
        if (brandedCheckbox) brandedCheckbox.disabled = true;
        platforms.forEach(function (platform) { p[publishStatusFieldFor(platform)] = 'pending'; });
        pieces[id] = p;

        platforms.forEach(function (platform) {
          var captionEntry = captions.filter(function (c) { return c.key === platform; })[0];
          var description = (captionEntry && !captionEntry.empty) ? captionEntry.text : '';
          // TikTok's Content Posting API has one text field ("title",
          // really the on-post caption) rather than separate title/
          // description fields — send the real caption there if one's
          // set, falling back to the plain title otherwise.
          var body = platform === 'ytlong'
            ? { title: title, description: description, privacyStatus: privacyStatus }
            : { title: description || title, brandedContent: brandedContent };
          fetch(publishEndpointFor(platform) + encodeURIComponent(id), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (data) { return { ok: r.ok, data: data }; }); })
            .then(function (result) {
              if (!result.ok) {
                p[publishStatusFieldFor(platform)] = 'error';
                p[publishErrorFieldFor(platform)] = (result.data && result.data.error) || 'Could not start publish.';
                render();
                return;
              }
              maybeStartYoutubePublishPoll();
            });
        });
      });
    });

    // Toggling between platform captions on a Final Check card — swaps
    // just this one card's caption section in place (see
    // fcCaptionSectionHtml's comment) rather than calling render(), so
    // the video already playing/paused isn't reset by the click. Scoped
    // rebinding (not a fresh bindBoardEvents() call) so a tab click
    // doesn't pile up duplicate listeners on every other element already
    // on the board.
    bindCaptionTabs(board);

    board.querySelectorAll('.card-move').forEach(function (sel) {
      sel.addEventListener('click', function (e) { e.stopPropagation(); });
      sel.addEventListener('change', function () {
        var p = pieces[sel.dataset.id];
        if (!p) return;
        p.order = maxOrder(sel.value) + 10;
        setPieceStage(p, sel.value, function () { animateBoardMove(p.id); });
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
            setPieceStage(p, stageId);
          } else if (p.order !== newOrder) {
            p.order = newOrder;
            p.updatedAt = nowIso();
            Store.put('pieces', p);
          }
        });
        animateBoardMove(draggingId);
      });
    });

    board.querySelectorAll('.column-add').forEach(function (btn) {
      btn.addEventListener('click', function () { createDraft(btn.dataset.stage, render); });
    });
  }

  // Right-click delete on any kanban card, including Final Check ones
  // (`.final-check-card` is deliberately not `.card`, per §113, so it
  // needs listing explicitly here too — same gotcha §123's pan-capture
  // fix hit). One small floating menu, reused across invocations rather
  // than one per card, with an explicit arm/confirm step so a stray
  // right-click can't delete anything by accident — same two-step
  // pattern the shared modal's own delete button already uses.
  var kanbanCtxMenu = null;
  function closeKanbanCtxMenu() {
    if (!kanbanCtxMenu) return;
    kanbanCtxMenu.remove();
    kanbanCtxMenu = null;
    document.removeEventListener('click', closeKanbanCtxMenuOnOutside, true);
    document.removeEventListener('contextmenu', closeKanbanCtxMenuOnOutside, true);
    document.removeEventListener('keydown', closeKanbanCtxMenuOnEscape, true);
  }
  // Bug found via a real headless-browser test against the live service
  // (same technique as §123): this used to be registered as a bare
  // `document.addEventListener('click', closeKanbanCtxMenu, true)` —
  // capture phase, with no "was the click actually outside the menu"
  // check. Capture fires top-down *before* the click ever reaches the
  // Delete button's own bubble-phase handler, so clicking Delete closed
  // the whole menu (removed it from the DOM) before that handler's
  // `renderConfirm()` call could do anything visible — the button's own
  // `e.stopPropagation()` couldn't help, since capture-phase listeners
  // on an ancestor run before the target's bubble-phase ones regardless.
  // Reusing this same containment check for both click and contextmenu
  // fixes it: a click *inside* the menu no longer closes it at all.
  function closeKanbanCtxMenuOnOutside(e) {
    if (kanbanCtxMenu && !kanbanCtxMenu.contains(e.target)) closeKanbanCtxMenu();
  }
  function closeKanbanCtxMenuOnEscape(e) {
    if (e.key === 'Escape') closeKanbanCtxMenu();
  }
  function openKanbanCtxMenu(id, x, y) {
    closeKanbanCtxMenu();
    var menu = document.createElement('div');
    menu.className = 'kanban-ctx-menu';

    function renderInitial() {
      menu.innerHTML = '';
      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'kanban-ctx-item kanban-ctx-delete';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', function (e) { e.stopPropagation(); renderConfirm(); });
      menu.appendChild(delBtn);
    }
    function renderConfirm() {
      menu.innerHTML = '';
      var label = document.createElement('div');
      label.className = 'kanban-ctx-label';
      label.textContent = 'Delete this piece?';
      var confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'kanban-ctx-item kanban-ctx-confirm';
      confirmBtn.textContent = 'Confirm delete';
      confirmBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var p = pieces[id];
        Store.del('pieces', id, p).then(function () {
          delete pieces[id];
          if (p && p.hasVideo) { Store.del('videos', id); Store.del('videos', id + '-final'); }
          closeKanbanCtxMenu();
          render();
        }).catch(function () { closeKanbanCtxMenu(); });
      });
      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'kanban-ctx-item kanban-ctx-cancel';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', function (e) { e.stopPropagation(); closeKanbanCtxMenu(); });
      menu.appendChild(label);
      menu.appendChild(confirmBtn);
      menu.appendChild(cancelBtn);
    }
    renderInitial();

    document.body.appendChild(menu);
    var rect = menu.getBoundingClientRect();
    var left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 8));
    var top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 8));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    kanbanCtxMenu = menu;
    // Deferred so the contextmenu event that opened this menu doesn't
    // immediately bubble into the same-tick outside-click listener and
    // close it before it's even visible.
    setTimeout(function () {
      document.addEventListener('click', closeKanbanCtxMenuOnOutside, true);
      document.addEventListener('contextmenu', closeKanbanCtxMenuOnOutside, true);
      document.addEventListener('keydown', closeKanbanCtxMenuOnEscape, true);
    }, 0);
  }
  function bindKanbanContextMenu() {
    board.addEventListener('contextmenu', function (e) {
      var cardEl = e.target.closest('.card, .final-check-card');
      if (!cardEl || !cardEl.dataset.id) return;
      e.preventDefault();
      // No delete menu at all for a piece a reviewer session didn't
      // create — right-clicking an existing idea just does nothing,
      // rather than showing a menu whose Delete option would 403 anyway.
      if (!canEditPiece(pieces[cardEl.dataset.id])) return;
      openKanbanCtxMenu(cardEl.dataset.id, e.clientX, e.clientY);
    });
  }

  function bindPanning() {
    var isPanning = false, startX = 0, startScroll = 0;
    boardWrap.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (e.target.closest('.card, .card-move, .final-check-card, button, select, input, textarea, [contenteditable]')) return;
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

  // Real YouTube/TikTok publish both run in the background server-side
  // (server.js's runYoutubePublish/runTiktokPublish) — this polls the
  // handful of pieces currently mid-publish on either platform and does a
  // full render() once one lands on done/error, since "done" moves the
  // piece out of the Final Check column entirely (a targeted DOM patch
  // wouldn't make sense there the way the caption-tab toggle's does).
  // Same shape as maybeStartAnalysisPolling in the Upload Files tab, kept
  // separate since it watches different fields on a different view.
  var youtubePublishPollTimer = null;
  function maybeStartYoutubePublishPoll() {
    function isWaiting(piece) {
      return WIRED_PUBLISH_PLATFORMS.some(function (platform) {
        var s = piece[publishStatusFieldFor(platform)];
        return s === 'pending' || s === 'running';
      });
    }
    var waiting = Object.keys(pieces).filter(function (id) { return isWaiting(pieces[id]); });
    if (!waiting.length) { clearTimeout(youtubePublishPollTimer); youtubePublishPollTimer = null; return; }
    if (youtubePublishPollTimer) return;
    youtubePublishPollTimer = setTimeout(function () {
      youtubePublishPollTimer = null;
      Promise.all(waiting.map(function (id) { return Store.get('pieces', id); })).then(function (rows) {
        var changed = false;
        var movedIds = [];
        rows.forEach(function (r) {
          if (!r) return;
          var prev = pieces[r.id];
          if (!prev) { pieces[r.id] = r; return; }
          var prevStage = prev.stage;
          if (WIRED_PUBLISH_PLATFORMS.some(function (platform) { return prev[publishStatusFieldFor(platform)] !== r[publishStatusFieldFor(platform)]; })) changed = true;
          // Mutate in place rather than reassigning pieces[r.id] to a new
          // object — same object-identity bug §149 already found and
          // fixed in the analysis poller (a brand-new object here would
          // silently diverge from whatever any other closure/card still
          // holds a reference to the old one).
          Object.assign(prev, r);
          if (prevStage !== prev.stage) movedIds.push(r.id);
        });
        // Real move animation (2026-09-20) for Final Check -> Posted/Live
        // once a publish actually succeeds — same animateBoardMove used by
        // the analysis/build poller, called directly since this poller
        // only ever runs while Content Ops is already the booted tab (the
        // Publish button that starts it only exists on a Final Check
        // card, which only renders there).
        if (movedIds.length === 1) animateBoardMove(movedIds[0]);
        else if (changed) render();
        else maybeStartYoutubePublishPoll();
      });
    }, 3000);
  }

  // A backgrounded/inactive browser tab throttles setTimeout heavily
  // (Chrome can stretch it to once a minute or longer) — a real TikTok/
  // YouTube publish that actually finished while Harvey had switched away
  // (e.g. mid screen-recording, tabbing over to check something else)
  // could sit done server-side for a long time before the throttled timer
  // got around to checking again, which is exactly what reads as "never
  // updates automatically, I had to refresh the page." Coming back into
  // view forces an immediate check instead of waiting out whatever's left
  // of the throttled interval. Bound once (bootContentOps() re-runs every
  // time this tab is revisited, but document-level listeners aren't
  // cleaned up when its DOM is torn down, so re-adding one each time would
  // leak a duplicate).
  var visibilityRepollBound = false;
  function bindVisibilityRepoll() {
    if (visibilityRepollBound) return;
    visibilityRepollBound = true;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible' || !youtubePublishPollTimer) return;
      clearTimeout(youtubePublishPollTimer);
      youtubePublishPollTimer = null;
      maybeStartYoutubePublishPoll();
    });
  }

  function bootContentOps() {
    board = document.getElementById('board');
    statStrip = document.getElementById('statStrip');
    overviewRow = document.getElementById('overviewRow');
    boardWrap = document.getElementById('boardWrap');

    bindPanning();
    bindKanbanContextMenu();
    bindVisibilityRepoll();
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
    // Optional second hook, set only while Content Ops is actually the
    // booted tab — a caller that knows a specific piece's *stage* just
    // changed (not just "something changed") can use this instead of the
    // plain notify above to get a real move animation for that one card.
    window.__rmOnPieceMoved = animateBoardMove;
    ensurePiecesLoaded().then(render);
    // Final Check cards (see finalCheckCardHtml below) show the real
    // rendered caption inline, which needs Settings' caption templates —
    // fetched once here rather than only when Harvey happens to visit
    // the Settings tab. Re-renders once loaded so a caption isn't stuck
    // on its "Loading…" fallback for the rest of the session.
    Store.getSettings().then(function (s) { boardSettingsCache = s; render(); });
    fetch('/api/youtube/status', { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) { youtubeStatusCache = s; render(); }).catch(function () {});
    fetch('/api/tiktok/status', { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) { tiktokStatusCache = s; render(); }).catch(function () {});
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
      '<div class="upload-rows" id="uploadRows"></div>' +
      '<h3 class="upload-heading">Posted</h3>' +
      '<div class="upload-grid" id="postedGrid"></div>' +
    '</div>';

  var dropzone, fileInput, uploadRows, postedGrid;
  var uploadRowObjectUrls = {}; // pieceId -> object URL, revoked/rebuilt on each render pass
  // pieceId -> pending debounce timer for the platform-checkbox save
  // below — see that handler's own comment for why this exists.
  var platformSaveTimers = {};

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

  // One row per in-production video, everything Harvey needs inline —
  // thumbnail/title/id, a real scrubbable frame picker, the backing-audio
  // dropdown, the (up to 3) title fields, and "Send to final check" — no
  // modal click-through needed for the normal upload workflow anymore
  // (the shared modal still exists and still works, for anything this row
  // doesn't cover directly, e.g. notes/platforms/content type).
  // Rebuilding this row's own "head" (thumbnail/title/#id/tags/analysis
  // status) in place — rather than routing every small change through a
  // full renderUploadLists() — is what stops the whole list from
  // flashing/reloading (every other row's video blob getting re-fetched,
  // a real blank gap while the list was torn down and rebuilt) just
  // because Harvey clicked one audio dropdown or picked one thumbnail
  // frame. See buildUploadRow's callers below (captureBtn, audioSelect).
  function buildUploadRowHead(p) {
    var head = document.createElement('div');
    head.className = 'upload-row-head';
    var thumbEl = document.createElement('div');
    thumbEl.className = 'upload-row-thumb' + (p.videoIsVertical ? ' is-vertical' : '');
    thumbEl.innerHTML = p.thumbnailDataUrl ? ('<img src="' + p.thumbnailDataUrl + '" alt="" />') : '<span class="thumb-empty">No thumbnail</span>';
    var titleId = document.createElement('div');
    titleId.className = 'upload-row-title-id';
    var titleLine = document.createElement('div');
    titleLine.className = 'upload-row-title';
    titleLine.textContent = p.title || 'Untitled';
    var idLine = document.createElement('div');
    idLine.className = 'upload-row-idline';
    idLine.textContent = '#' + String(p.seq || 0).padStart(3, '0');
    titleId.appendChild(titleLine);
    titleId.appendChild(idLine);
    if ((p.tags || []).length) {
      var tagsLine = document.createElement('div');
      tagsLine.className = 'upload-row-tags';
      p.tags.forEach(function (tagId) {
        var def = Store.TAGS.filter(function (t) { return t.id === tagId; })[0];
        if (!def) return;
        var chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.textContent = def.label;
        tagsLine.appendChild(chip);
      });
      titleId.appendChild(tagsLine);
    }
    if (p.analysisStatus === 'running' || p.analysisStatus === 'pending') {
      var busy = document.createElement('div');
      busy.className = 'upload-row-status';
      busy.textContent = 'Transcribing & matching to an outline…';
      titleId.appendChild(busy);
    } else if (p.analysisStatus === 'error') {
      var errEl = document.createElement('div');
      errEl.className = 'upload-row-status upload-row-status-error';
      errEl.textContent = 'Auto-analysis failed (' + (p.analysisError || 'unknown error') + ') — fill in titles manually below.';
      titleId.appendChild(errEl);
    } else if (p.analysisMatchedPieceId) {
      var matched = pieces[p.analysisMatchedPieceId];
      var matchEl = document.createElement('div');
      matchEl.className = 'upload-row-status';
      matchEl.textContent = matched ? ('Matched to #' + String(matched.seq || 0).padStart(3, '0') + ' — ' + matched.title) : 'Matched to an outline.';
      titleId.appendChild(matchEl);
    }
    // The real, audio-spliced video Final Check reviews — has to exist
    // before the piece is allowed to leave Processing (see CLAUDE.md's
    // uploader-tool section on why), so this status line is what Harvey
    // actually watches after clicking "Send to final check."
    if (p.finalBuildStatus === 'running' || p.finalBuildStatus === 'pending') {
      var building = document.createElement('div');
      building.className = 'upload-row-status';
      building.textContent = 'Building final video (splicing in audio)…';
      titleId.appendChild(building);
    } else if (p.finalBuildStatus === 'error') {
      var buildErr = document.createElement('div');
      buildErr.className = 'upload-row-status upload-row-status-error';
      buildErr.textContent = 'Final video build failed (' + (p.finalBuildError || 'unknown error') + ') — try Send to final check again.';
      titleId.appendChild(buildErr);
    } else if (p.finalBuildStatus === 'done' && (p.analysisStatus === 'pending' || p.analysisStatus === 'running')) {
      // Real bug Harvey hit (2026-09-20): a piece used to move into Final
      // Check — fully interactive video, playable right away — the moment
      // the build finished, even if analysis was still running underneath
      // it. The client's poller re-renders the whole board every 3s for as
      // long as *either* job is pending, so the video kept getting torn
      // down and rebuilt mid-interaction, which read as the thumbnail
      // repeatedly vanishing/reappearing. server.js now holds a piece here
      // in Processing until analysis also settles (maybeAdvanceToFinalCheck)
      // — this line is what actually explains the wait to Harvey, rather
      // than a done-looking row with no visible reason to still be here.
      var waitingOnAnalysis = document.createElement('div');
      waitingOnAnalysis.className = 'upload-row-status';
      waitingOnAnalysis.textContent = 'Final video ready — waiting on transcription/matching to finish before this moves to Final Check…';
      titleId.appendChild(waitingOnAnalysis);
    }
    // Type + platforms — Harvey's ask: show which type this got auto-
    // categorized as (locked; it's derived purely from orientation/
    // duration, see detectContentType, not something to hand-edit here —
    // the full editor still allows changing it if that's ever genuinely
    // needed) and which platforms it'll post to, pre-checked from
    // PLATFORM_PRESET_BY_TYPE, individually uncheckable.
    var typeRow = document.createElement('div');
    typeRow.className = 'upload-row-type-row';
    var ct = contentTypeOf(p.contentType);
    typeRow.innerHTML = '<span class="chip format"><span class="dot" style="background:' + ct.color + '"></span>' + ct.label + '</span>';
    titleId.appendChild(typeRow);

    var canEditRow = canEditPiece(p);
    var platformsRow = document.createElement('div');
    platformsRow.className = 'upload-row-platforms';
    (Store.PLATFORMS || []).forEach(function (pl) {
      var checked = (p.platforms || []).indexOf(pl.id) !== -1;
      var toggle = document.createElement('label');
      toggle.className = 'platform-toggle-sm' + (checked ? ' checked' : '');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = checked;
      // A reviewer session (even on its own piece) only ever gets to
      // toggle the YouTube platforms — TikTok/Instagram/Facebook are
      // disabled outright, per Harvey's "fields not relevant to youtube
      // disabled" — and a piece it didn't create is locked entirely.
      cb.disabled = !canEditRow || (IS_REVIEWER && pl.id !== 'ytshort' && pl.id !== 'ytlong');
      // Real bug Harvey hit (2026-09-20): a rapid burst of toggles each
      // fired its own immediate Store.put — since the server does a full-
      // record overwrite with no merge, and JSON.stringify(body) snapshots
      // p at the moment each request is *sent* (lib/store.js's put()),
      // whichever PUT's response happens to arrive at the server last
      // wins outright, even if it started earlier and carries an older,
      // already-superseded snapshot. Two boxes unchecked within the same
      // few hundred ms could easily complete out of order over the
      // network, silently resurrecting one of them server-side even
      // though the UI (and p.platforms in memory) already showed both
      // off. Fixed by debouncing the actual save — the in-memory toggle
      // and its visual state are still instant, but only one PUT, built
      // from whatever p.platforms looks like 400ms after the last click,
      // ever goes out per burst, so there's nothing left to race.
      cb.addEventListener('change', function () {
        var list = (p.platforms || []).slice();
        var idx = list.indexOf(pl.id);
        if (cb.checked && idx === -1) list.push(pl.id);
        else if (!cb.checked && idx !== -1) list.splice(idx, 1);
        p.platforms = list;
        p.updatedAt = nowIso();
        toggle.classList.toggle('checked', cb.checked);
        clearTimeout(platformSaveTimers[p.id]);
        platformSaveTimers[p.id] = setTimeout(function () {
          delete platformSaveTimers[p.id];
          Store.put('pieces', p);
        }, 400);
      });
      toggle.appendChild(cb);
      toggle.appendChild(document.createTextNode(pl.label));
      platformsRow.appendChild(toggle);
    });
    titleId.appendChild(platformsRow);

    head.appendChild(thumbEl);
    head.appendChild(titleId);
    return head;
  }

  function buildUploadRow(p, audioTracks) {
    var row = document.createElement('div');
    row.className = 'upload-row';
    row.dataset.id = p.id;
    // Whole row is locked (frame picker, audio, titles, send button) for
    // a piece a reviewer session didn't upload itself — platform
    // checkboxes are gated separately, inside buildUploadRowHead, since
    // they're further restricted even on the reviewer's own rows.
    var canEditRow = canEditPiece(p);

    var head = buildUploadRowHead(p);
    // Swaps the head for a freshly-built one reflecting p's current
    // state — used instead of a full list rebuild whenever only this
    // row's own thumbnail/tags/status actually changed.
    function refreshHead() {
      var fresh = buildUploadRowHead(p);
      head.replaceWith(fresh);
      head = fresh;
    }

    // --- Frame picker: a real, playable, scrubbable copy of the video —
    // same canvas-capture technique as the shared modal's pick-frame flow,
    // just inline instead of behind a click-to-open.
    var frameSection = document.createElement('div');
    frameSection.className = 'upload-row-section upload-row-frame';
    var videoEl = document.createElement('video');
    videoEl.className = 'upload-row-video' + (p.videoIsVertical ? ' is-vertical' : '');
    videoEl.playsInline = true;
    videoEl.muted = true;
    var scrub = document.createElement('input');
    scrub.type = 'range';
    scrub.min = '0';
    scrub.max = '100';
    scrub.step = '0.1';
    scrub.value = '0';
    videoEl.addEventListener('loadedmetadata', function () {
      if (videoEl.duration) scrub.max = videoEl.duration;
      // Real orientation, read straight off the decoded video — covers
      // both a fresh upload (already stored at creation time, see
      // handleFiles) and a legacy piece uploaded before this field
      // existed, which gets backfilled here the first time its row is
      // shown so the box only needs computing once, not every render.
      if (videoEl.videoWidth && videoEl.videoHeight) {
        var vertical = videoEl.videoHeight > videoEl.videoWidth;
        if (p.videoIsVertical !== vertical) {
          p.videoIsVertical = vertical;
          Store.put('pieces', p);
          refreshHead();
        }
        videoEl.classList.toggle('is-vertical', vertical);
      }
    });
    scrub.addEventListener('input', function () { try { videoEl.currentTime = parseFloat(scrub.value); } catch (e) {} });
    // Shared by the button and the auto-pick-on-load below, so there's
    // one capture implementation, not two. Returns false (does nothing
    // saved) if the video has no real frame data to draw yet — this used
    // to silently produce a blank image for any video the browser
    // couldn't decode (HEVC uploads in particular, see
    // ensureBrowserCompatibleVideo in videoAnalysis.js, the actual fix);
    // now that server-side normalization guarantees a decodable video,
    // videoWidth/videoHeight being 0 here should only mean "hasn't
    // loaded far enough yet," not "never will."
    function captureCurrentFrame() {
      if (!videoEl.videoWidth || !videoEl.videoHeight) return false;
      var canvas = document.createElement('canvas');
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      var ctx = canvas.getContext('2d');
      try { ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height); } catch (e) { return false; }
      p.thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.85);
      p.updatedAt = nowIso();
      syncTags(p);
      // Only this row's own thumbnail/tags need to update — routing this
      // through a full renderUploadLists() used to tear down and rebuild
      // every row in the list (re-fetching every other row's video blob
      // in the process), which is what looked like the whole panel
      // flashing/disappearing for a moment on every single click.
      Store.put('pieces', p).then(refreshHead);
      return true;
    }
    var captureBtn = document.createElement('button');
    captureBtn.type = 'button';
    captureBtn.className = 'btn-secondary btn-tiny';
    captureBtn.addEventListener('click', function () { captureCurrentFrame(); });
    frameSection.appendChild(videoEl);
    frameSection.appendChild(scrub);
    frameSection.appendChild(captureBtn);
    // Disabled with a "Loading video…" label until the video actually has
    // a frame to give — found live (2026-09-20, headless-browser test
    // against a throttled connection) that with several rows in the list
    // at once, a later row's (often multi-MB) video blob can take a real
    // while to fetch, and clicking "Use this frame" during that window
    // silently no-op'd via captureCurrentFrame()'s own early-return guard
    // with zero feedback — looked exactly like a dead button, especially
    // on a slower real connection than this container's own fast link to
    // the VPS. `loadeddata` (readyState >= HAVE_CURRENT_DATA) is the same
    // event the auto-pick-thumbnail listener below already waits for, so
    // "the button becomes usable" and "a frame is actually capturable"
    // are now driven by the identical signal.
    function setFrameControlsReady(ready) {
      captureBtn.disabled = !ready || !canEditRow;
      captureBtn.textContent = ready ? 'Use this frame' : 'Loading video…';
      scrub.disabled = !ready || !canEditRow;
    }
    setFrameControlsReady(videoEl.readyState >= 2);
    videoEl.addEventListener('loadeddata', function () { setFrameControlsReady(true); });
    // Auto-pick a starting thumbnail (the very first frame) the moment
    // the video has one to give, so a row never sits at "No thumbnail"
    // by default — Harvey still freely overrides it via the scrub bar +
    // "Use this frame" above. Only for a piece that doesn't already have
    // a thumbnail (e.g. a page reload of an already-edited row shouldn't
    // silently reset a deliberate pick back to frame 0).
    if (!p.thumbnailDataUrl) {
      videoEl.addEventListener('loadeddata', function onFirstFrame() {
        videoEl.removeEventListener('loadeddata', onFirstFrame);
        captureCurrentFrame();
      });
    }
    Store.get('videos', p.id).then(function (v) {
      if (!v || !v.blob) return;
      if (uploadRowObjectUrls[p.id]) URL.revokeObjectURL(uploadRowObjectUrls[p.id]);
      var url = URL.createObjectURL(v.blob);
      uploadRowObjectUrls[p.id] = url;
      videoEl.src = url;
    });

    // --- Audio dropdown
    var audioSection = document.createElement('div');
    audioSection.className = 'upload-row-section upload-row-audio';
    var audioLabel = document.createElement('label');
    audioLabel.textContent = 'Backing audio';
    var audioSelect = document.createElement('select');
    audioSelect.className = 'stage-select';
    audioSelect.innerHTML = '<option value="">Not yet chosen</option><option value="__none__">No ambient music</option>' +
      audioTracks.map(function (t) { return '<option value="' + t.id + '">' + escapeHtml(t.name) + '</option>'; }).join('');
    audioSelect.value = p.audioTrackId || '';
    audioSelect.disabled = !canEditRow;
    audioSelect.addEventListener('change', function () {
      p.audioTrackId = audioSelect.value;
      p.updatedAt = nowIso();
      syncTags(p);
      Store.put('pieces', p).then(refreshHead);
    });
    audioSection.appendChild(audioLabel);
    audioSection.appendChild(audioSelect);

    // --- Title picker. Longform gets up to 3 (auto-populated from the
    // matched outline once analysis finishes, freely editable either
    // way) since a longform upload can genuinely be posted under
    // different titles at different times to see what performs best.
    // Shortform (ultra-short/short/long-short — practically, vertical)
    // gets just 1: Harvey, 2026-09-20, "remove the '3 title options' and
    // put just 1 as theres no way to test/rotate titles" for a short,
    // which is posted once and done, not re-titled later.
    var isLongform = p.contentType === 'longform';
    var titleSlotCount = isLongform ? 3 : 1;
    var titlesSection = document.createElement('div');
    titlesSection.className = 'upload-row-section upload-row-titles';
    var titlesLabel = document.createElement('label');
    titlesLabel.textContent = isLongform ? 'Title options' : 'Title';
    titlesSection.appendChild(titlesLabel);
    var titleSlotIndexes = [];
    for (var ti = 0; ti < titleSlotCount; ti++) titleSlotIndexes.push(ti);
    var titleInputs = titleSlotIndexes.map(function (i) {
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'title-input';
      input.maxLength = 100;
      input.placeholder = isLongform ? ('Title option ' + (i + 1) + (i > 0 ? ' (optional)' : '')) : 'Title';
      input.value = (p.ytTitles || [])[i] || '';
      input.disabled = !canEditRow;
      input.addEventListener('input', function () {
        var vals = titleInputs.map(function (el) { return el.value; }).filter(function (v) { return v.trim(); });
        p.ytTitles = vals;
        // The kanban card (and everywhere else that shows piece.title)
        // was still showing the raw uploaded filename forever, since this
        // field only ever wrote to ytTitles — Harvey's ask: once a real
        // title's been typed here, that's the title, not the filename.
        // Falls back to the filename-derived title only while this is
        // genuinely still empty.
        if (vals[0]) p.title = vals[0];
        p.updatedAt = nowIso();
        syncTags(p);
        refreshHead(); // "titles selected" tag + the row's own title line
        saveSettingsDebouncedForPiece(p);
      });
      titlesSection.appendChild(input);
      return input;
    });

    // --- Send to final check
    var actionSection = document.createElement('div');
    actionSection.className = 'upload-row-section upload-row-action';
    var sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'btn-primary btn-tiny';
    sendBtn.textContent = 'Send to final check';
    sendBtn.disabled = !canEditRow;
    sendBtn.addEventListener('click', function () {
      // Doesn't move the piece to Final Check itself — Harvey's rule:
      // Final Check's preview has to already be the *real* video (audio
      // spliced in), not the raw upload, so this only kicks off that
      // build server-side, which flips the stage itself once it actually
      // finishes (server.js's runBuildFinalVideo). But the row itself
      // shoots off the instant this click fires rather than sitting
      // around showing a "Building…" state — the fetch to kick off the
      // build is fire-and-forget (not awaited), so the row's own
      // instant-tick-and-remove animation plays immediately, not once the
      // real ffmpeg job (which can take a while) eventually finishes. If
      // the build later fails, the poller below (which keeps tracking
      // this piece's finalBuildStatus regardless of whether its row is
      // still on screen) brings the row back via a full list rebuild so
      // the failure isn't silently lost.
      if (sendBtn.disabled) return;
      sendBtn.disabled = true;
      sendBtn.textContent = '✓ Sent';
      p.finalBuildStatus = 'pending';
      p.updatedAt = nowIso();
      Store.put('pieces', p).then(function () {
        fetch('/api/videos/' + encodeURIComponent(p.id) + '/build-final', { method: 'POST', credentials: 'include' }).catch(function () {});
        maybeStartAnalysisPolling();
        removeUploadRowAnimated(p.id);
      }).catch(function () {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send to final check';
      });
    });
    // "Full editor…" button removed 2026-09-20 per Harvey ("ill nevver
    // use this") — everything he actually needs to touch for an
    // in-production video already lives inline in this row (thumbnail,
    // audio, title(s), platforms), matching the same "closed review
    // surface, no editor escape hatch" call already made for Final
    // Check cards in §116. `openPiece`/the shared modal itself are left
    // intact — Content Ops (the planning kanban) still opens it the
    // normal way; only this one entry point into it is gone.
    actionSection.appendChild(sendBtn);

    row.appendChild(head);
    row.appendChild(frameSection);
    row.appendChild(audioSection);
    row.appendChild(titlesSection);
    row.appendChild(actionSection);
    return row;
  }

  // Per-piece debounce so typing in a title field doesn't fire a save on
  // every keystroke — separate timer per row (keyed by id) rather than one
  // shared timer, since editing two rows' titles close together shouldn't
  // cancel each other's pending save.
  var uploadRowSaveTimers = {};
  function saveSettingsDebouncedForPiece(p) {
    clearTimeout(uploadRowSaveTimers[p.id]);
    uploadRowSaveTimers[p.id] = setTimeout(function () { Store.put('pieces', p); }, 500);
  }

  // Both used by the polling loop below (maybeStartAnalysisPolling) so a
  // background completion — final video build finishing, analysis
  // landing — can update a single row without the flash a full
  // renderUploadLists() causes (§112). Standalone (not closures inside
  // buildUploadRow) specifically so the poller, which has no access to
  // any one row's own internal refreshHead(), can still target a
  // specific row from the outside by id.
  function refreshUploadRowHeadById(id) {
    var row = uploadRows.querySelector('.upload-row[data-id="' + id + '"]');
    if (!row) return;
    var oldHead = row.querySelector('.upload-row-head');
    if (!oldHead) return;
    oldHead.replaceWith(buildUploadRowHead(pieces[id]));
  }
  function removeUploadRowAnimated(id) {
    var row = uploadRows.querySelector('.upload-row[data-id="' + id + '"]');
    if (!row) return;
    row.classList.add('upload-row-removing');
    setTimeout(function () {
      if (uploadRowObjectUrls[id]) { URL.revokeObjectURL(uploadRowObjectUrls[id]); delete uploadRowObjectUrls[id]; }
      if (row.parentNode) row.parentNode.removeChild(row);
      if (!uploadRows.querySelector('.upload-row')) {
        uploadRows.innerHTML = '<div class="empty-slot wide">Nothing uploaded yet — drop a video above.</div>';
      }
    }, 400);
  }

  // Only for cases that genuinely need every row rebuilt from scratch
  // (initial load, a new file just landed, analysis just finished, the
  // full editor modal closed) — anything that only changes one row's own
  // state (thumbnail/audio/titles/send-to-final-check) goes through
  // refreshHead()/direct row removal above instead, specifically to avoid
  // this. Builds the new rows in memory *before* touching the live DOM
  // at all, then swaps in one shot — the old version cleared
  // uploadRows.innerHTML synchronously and only refilled it once
  // Store.getAll('audioTracks') resolved, which left a real blank gap in
  // between (what Harvey saw as the whole panel flashing/disappearing).
  function renderUploadLists() {
    var items = Object.keys(pieces).map(function (k) { return pieces[k]; }).filter(function (p) { return p.hasVideo; });
    // Only still-in-Processing pieces get the editable row treatment here
    // — once a piece reaches Final Check it has its own dedicated review
    // card on the kanban board instead (§113), so showing it here too
    // would just be a redundant, stale-looking duplicate of the same
    // piece in two places.
    var inProgress = items.filter(function (p) { return p.stage === 'processed'; }).sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    var posted = items.filter(function (p) { return p.stage === 'live'; }).sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); });

    function swapIn(audioTracks) {
      var oldObjectUrls = uploadRowObjectUrls;
      uploadRowObjectUrls = {};
      var frag = document.createDocumentFragment();
      if (!inProgress.length) {
        var empty = document.createElement('div');
        empty.className = 'empty-slot wide';
        empty.textContent = 'Nothing uploaded yet — drop a video above.';
        frag.appendChild(empty);
      } else {
        inProgress.forEach(function (p) { frag.appendChild(buildUploadRow(p, audioTracks)); });
      }
      uploadRows.innerHTML = '';
      uploadRows.appendChild(frag);
      Object.keys(oldObjectUrls).forEach(function (id) { URL.revokeObjectURL(oldObjectUrls[id]); });
    }

    if (!inProgress.length) {
      swapIn([]);
    } else {
      Store.getAll('audioTracks').then(swapIn);
    }

    postedGrid.innerHTML = posted.length ? posted.map(function (p) { return videoCardHtml(p.id, p); }).join('') : '<div class="empty-slot wide">Nothing posted yet.</div>';
    postedGrid.querySelectorAll('.video-card').forEach(function (el) {
      el.addEventListener('click', function () { openPiece(el.dataset.id, renderUploadLists); });
    });

    maybeStartAnalysisPolling();
  }

  // Two server-side background jobs land here: transcribe+match analysis
  // (§111) and the final audio-splice video build (§115) — this polls
  // the handful of pieces still waiting on either and updates just their
  // own row once something changes, rather than a full
  // renderUploadLists() (which would re-fetch every other row's video
  // blob and flash the whole panel, §112). A piece whose build finished
  // (stage moved off 'processed') gets the same instant-tick removal
  // animation the button itself used to fake instantly; one still in
  // Processing with a changed status (analysis landed, or a build
  // failed) just gets its own head refreshed in place. Stops itself once
  // nothing's waiting, rather than polling forever in the background.
  var analysisPollTimer = null;
  // Defense in depth alongside server.js's own recoverInflightVideoJobs()
  // (2026-09-20): a piece whose analysisStatus/finalBuildStatus never
  // resolves (a mid-flight service restart is the known cause, but this
  // guards against any other way it could happen too) would otherwise sit
  // in `waiting` forever, polling every 3s indefinitely and re-rendering
  // the whole board every tick for no reason — which is what Harvey
  // actually saw as a repeating video/thumbnail flicker on a Final Check
  // card he hadn't touched. No real analysis/build job takes anywhere
  // close to this long, so anything still "pending"/"running" this much
  // later is stuck, not slow.
  var STUCK_JOB_TIMEOUT_MS = 5 * 60 * 1000;
  function maybeStartAnalysisPolling() {
    var waiting = Object.keys(pieces).filter(function (id) {
      var p = pieces[id];
      if (!p.hasVideo) return false;
      var isPending = p.analysisStatus === 'pending' || p.analysisStatus === 'running' ||
        p.finalBuildStatus === 'pending' || p.finalBuildStatus === 'running';
      if (!isPending) return false;
      var age = Date.now() - new Date(p.updatedAt || p.createdAt || 0).getTime();
      return age < STUCK_JOB_TIMEOUT_MS;
    });
    if (!waiting.length) { clearTimeout(analysisPollTimer); analysisPollTimer = null; return; }
    if (analysisPollTimer) return;
    analysisPollTimer = setTimeout(function () {
      analysisPollTimer = null;
      Promise.all(waiting.map(function (id) { return Store.get('pieces', id); })).then(function (rows) {
        var needsFullRebuild = false;
        var movedIds = [];
        rows.forEach(function (r) {
          if (!r) return;
          var existing = pieces[r.id];
          var wasProcessed = existing && existing.stage === 'processed';
          var prevStage = existing && existing.stage;
          // Real bug Harvey hit (2026-09-20, §142): this poll tick's own
          // GET can easily be a snapshot taken from *before* an in-progress
          // local edit's own (debounced) save has landed — analysis/build
          // jobs routinely take several real seconds, plenty of time for
          // Harvey to uncheck platform boxes or pick a different audio
          // track while a row is still processing. Blindly replacing
          // `pieces[r.id]` wholesale with `r` clobbered whatever he'd just
          // changed the moment this tick's rebuild ran, silently
          // reverting it. Only merge in the fields this background job
          // actually owns (mirrors the same discipline server.js's own
          // runVideoAnalysis/runBuildFinalVideo already apply when they
          // re-fetch the piece before writing back, §111/§115) — anything
          // else (platforms, thumbnail, audio track, content type, ...)
          // stays whatever's currently in the browser's own memory.
          //
          // Second, independent bug from the SAME fix (found 2026-09-20,
          // still reverting platforms after §142 shipped): the merge above
          // used to build a brand-new object (`Object.assign({}, existing)`)
          // and reassign `pieces[r.id]` to it. That broke object identity —
          // buildUploadRow()'s "Send to final check" button closes over the
          // exact `p` reference it was built with, which stays the *original*
          // object forever; only refreshUploadRowHeadById() re-reads the
          // live `pieces[id]`. Every poll tick (every 3s, for as long as
          // analysis/build is pending — routinely several ticks) silently
          // swapped `pieces[id]` to a new object and rebuilt the head against
          // it, while "Send to final check" kept holding the stale original.
          // Any platform Harvey unchecked *after* even one tick had already
          // fired (a near-certainty over a several-second job) landed only on
          // the new object the checkboxes were rebuilt against — invisible
          // to the send button, which shipped whatever the stale original
          // still had (the full preset) the moment he clicked it. Fixed by
          // mutating `existing` in place instead of replacing it, so
          // `pieces[id]` never changes identity for a piece's whole
          // lifetime — every closure that captured it, however long ago,
          // keeps seeing live updates with no rebuild required for
          // correctness (refreshUploadRowHeadById is now purely a visual
          // refresh, not a consistency fix).
          if (existing) {
            ['analysisStatus', 'analysisError', 'analysisMatchedPieceId', 'transcript',
             'ytTitles', 'title', 'finalBuildStatus', 'finalBuildError', 'stage', 'updatedAt', '_recordVersion'
            ].forEach(function (k) { if (k in r) existing[k] = r[k]; });
            r = existing;
          } else {
            pieces[r.id] = r;
          }
          if (prevStage && prevStage !== r.stage) movedIds.push(r.id);
          // Real bug Harvey hit (2026-09-20): these targeted DOM updates
          // only ever mean anything while Content Production is the
          // actual visible tab — `uploadRows` is that tab's own DOM
          // element, which is torn down the moment Harvey navigates
          // elsewhere (e.g. straight to the Kanban board right after
          // clicking "Send to final check"). They don't error in that
          // case, they just silently no-op against a detached node — so
          // a piece's stage genuinely changes in memory once the build
          // finishes, but nothing tells whichever *other* tab is actually
          // on screen to redraw itself, leaving Harvey looking at a stale
          // Kanban board until a full page reload. Guard on the tab
          // actually being active, and fall through to the generic
          // `notifyPiecesChanged()` (already used everywhere else in this
          // file for exactly this "some other view needs to know" case)
          // otherwise, so whatever tab Harvey's actually looking at —
          // most likely the Kanban board — redraws itself for real.
          if (currentTabId() !== 'upload-files') return;
          if (wasProcessed && r.stage !== 'processed') {
            removeUploadRowAnimated(r.id);
          } else if (r.finalBuildStatus === 'error' && !uploadRows.querySelector('.upload-row[data-id="' + r.id + '"]')) {
            // The row was already removed by "Send to final check"'s own
            // instant-tick animation (it doesn't wait for the build to
            // finish) — if the build then actually failed, bring the row
            // back so the failure isn't silently lost off-screen.
            needsFullRebuild = true;
          } else {
            refreshUploadRowHeadById(r.id);
          }
        });
        if (currentTabId() !== 'upload-files') {
          // A real move animation (2026-09-20, Harvey: "i need that
          // movement thing actually done") when exactly one piece's stage
          // changed this tick and the Kanban board is what's set the
          // animated hook (it's the only tab that ever does) — the normal
          // "something changed" notify otherwise, e.g. when several
          // pieces finished in the same tick, or a different tab (with no
          // concept of a card sliding between columns) is what's active.
          if (movedIds.length === 1 && typeof window.__rmOnPieceMoved === 'function') window.__rmOnPieceMoved(movedIds[0]);
          else notifyPiecesChanged();
        } else if (needsFullRebuild) renderUploadLists();
        maybeStartAnalysisPolling();
      });
    }, 3000);
  }

  // Reads duration + dimensions straight from the local file via a
  // throwaway <video> element and an object URL — no upload/ffmpeg round
  // trip needed, this is just the browser parsing the file's own
  // metadata, and it's local so it's fast. Resolves null (never rejects)
  // if metadata can't be read for any reason, so a weird/corrupt file
  // still uploads — it just falls back to a sane default content type
  // below instead of blocking the upload entirely.
  function probeVideoMeta(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      var settled = false;
      function finish(meta) {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        resolve(meta);
      }
      v.addEventListener('loadedmetadata', function () {
        finish({ duration: v.duration || 0, width: v.videoWidth || 0, height: v.videoHeight || 0 });
      });
      v.addEventListener('error', function () { finish(null); });
      setTimeout(function () { finish(null); }, 8000); // safety net, shouldn't normally fire for a local blob
      v.src = url;
    });
  }

  // Harvey's restated rule (2026-09-20, tightened from the original
  // §114 version): orientation alone decides Longform vs. not — every
  // landscape upload is Longform, full stop, no duration check at all
  // (that's what the type is actually for: YT/FB longform). Every
  // vertical upload is bucketed purely by length, capping out at
  // long_short (vertical never becomes Longform, since that format
  // doesn't really exist there in practice).
  function detectContentType(meta) {
    if (!meta || !meta.duration) return 'short'; // couldn't read metadata — same default as before this feature existed
    var isLandscape = meta.width >= meta.height;
    if (isLandscape) return 'longform';
    if (meta.duration <= 25) return 'ultra_short';
    if (meta.duration <= 60) return 'short';
    return 'long_short';
  }

  function handleFiles(fileList) {
    Array.prototype.slice.call(fileList).forEach(function (file) {
      if (file.type.indexOf('video') !== 0) return;
      var id = Store.genId();
      probeVideoMeta(file).then(function (meta) {
        var detectedType = detectContentType(meta);
        var piece = {
          id: id,
          seq: Store.nextSeq(allPiecesArray()),
          title: file.name.replace(/\.[^.]+$/, ''),
          stage: 'processed', // "Processing" — a brand-new opportunity, not the same thing as any plan in "Uploaded"
          // Pre-selected per the same type->platform default the shared
          // modal's content-type dropdown already applies (see
          // PLATFORM_PRESET_BY_TYPE up top) — Harvey's ask: platforms
          // default-checked, he just unchecks any that don't apply.
          // .slice() so editing this piece's array later can never
          // mutate the shared preset array itself.
          // A reviewer session only ever gets YouTube platforms pre-
          // checked — the others are disabled in the UI anyway (see
          // buildUploadRowHead), so pre-checking them here would just be
          // a confusing default nobody can act on.
          platforms: (PLATFORM_PRESET_BY_TYPE[detectedType] || []).slice()
            .filter(function (pl) { return !IS_REVIEWER || pl === 'ytshort' || pl === 'ytlong'; }),
          contentType: detectedType,
          contentTypeSelectionExplicit: true,
          createdBy: IS_REVIEWER ? 'youtube-reviewer' : undefined,
          // Drives the frame-picker/thumbnail box orientation in the
          // upload row (see buildUploadRowHead/buildUploadRow) — read
          // straight from the real probed dimensions, independent of
          // contentType, so it still reflects reality even if Harvey
          // later overrides the content type by hand.
          videoIsVertical: !!(meta && meta.width && meta.height && meta.height > meta.width),
          notesHtml: '',
          hasVideo: true,
          transcript: '',
          audioTrackId: '',
          thumbnailDataUrl: '',
          ytTitles: [],
          tags: [],
          analysisStatus: 'pending',
          scheduledAt: '',
          order: maxOrder('processed') + 10,
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
        pieces[id] = piece;
        renderUploadLists();
        // Piece record first, then the video blob, then kick off analysis —
        // in that order and awaited, not fired in parallel — so the server's
        // analysis route (which looks up the piece by the same id) never
        // races ahead of the piece actually existing yet.
        return Store.put('pieces', piece)
          .then(function () { return Store.put('videos', { id: id, fileName: file.name, blob: file, sizeBytes: file.size, createdAt: nowIso() }); })
          .then(function () {
            return fetch('/api/videos/' + encodeURIComponent(id) + '/analyze', { method: 'POST', credentials: 'include' });
          })
          .then(renderUploadLists)
          .catch(function () { renderUploadLists(); });
      });
    });
  }

  function bootUploadFiles() {
    dropzone = document.getElementById('dropzone');
    fileInput = document.getElementById('fileInput');
    uploadRows = document.getElementById('uploadRows');
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
        '<div class="audio-upload-progress" id="audioUploadProgress"></div>' +
        '<div class="audio-list" id="audioList"></div>' +
      '</section>' +
      '<section class="settings-section">' +
        '<h3>Captions</h3>' +
        '<p class="settings-hint">One description per platform, organized by content shape — a piece can be tagged ' +
          'for several platforms at once, each getting its own independently-set caption (Final Check shows all of ' +
          'them with a toggle when there\'s more than one). Use the shortcode <code>[LINK]</code> anywhere in the ' +
          'text and it\'s replaced with that piece\'s own UTM-tracked link when the caption is shown or copied.</p>' +
        '<div class="caption-group-tabs" id="captionGroupTabs">' +
          '<button type="button" class="caption-group-tab active" data-group="shortform">Short-form</button>' +
          '<button type="button" class="caption-group-tab" data-group="longform">Longform</button>' +
        '</div>' +
        '<div class="caption-group-panel" data-group="shortform" id="captionPanelShortform">' +
          '<label class="field-label">YT Shorts caption</label>' +
          '<textarea class="notes-input settings-textarea" id="caption-shortform-ytshort" placeholder="e.g. Grab your copy of the book here [LINK]!"></textarea>' +
          '<label class="field-label" style="margin-top:14px;display:block;">TikTok caption</label>' +
          '<textarea class="notes-input settings-textarea" id="caption-shortform-tiktok" placeholder="e.g. Grab your copy of the book here [LINK]! #booktok"></textarea>' +
          '<label class="field-label" style="margin-top:14px;display:block;">Instagram caption</label>' +
          '<textarea class="notes-input settings-textarea" id="caption-shortform-instagram" placeholder="e.g. Grab your copy of the book here [LINK]!"></textarea>' +
          '<label class="field-label" style="margin-top:14px;display:block;">Facebook caption</label>' +
          '<textarea class="notes-input settings-textarea" id="caption-shortform-facebook" placeholder="e.g. Grab your copy of the book here [LINK]!"></textarea>' +
        '</div>' +
        '<div class="caption-group-panel" data-group="longform" id="captionPanelLongform" hidden>' +
          '<label class="field-label">YouTube caption</label>' +
          '<textarea class="notes-input settings-textarea" id="caption-longform-ytlong" placeholder="e.g. Grab your copy of the book here [LINK]!"></textarea>' +
          '<label class="field-label" style="margin-top:14px;display:block;">Facebook caption</label>' +
          '<textarea class="notes-input settings-textarea" id="caption-longform-facebook" placeholder="e.g. Grab your copy of the book here [LINK]!"></textarea>' +
        '</div>' +
      '</section>' +
      '<section class="settings-section">' +
        '<h3>Tracked link</h3>' +
        '<p class="settings-hint">Base URL used to build the UTM-tracked [LINK] for every piece, any type.</p>' +
        '<input class="title-input settings-input" id="baseLinkInput" />' +
      '</section>' +
      '<section class="settings-section">' +
        '<h3>Platform connections</h3>' +
        '<p class="settings-hint">Real OAuth logins used to actually publish on a connected account\'s behalf ' +
          '(needed for the YouTube/TikTok API review process) — separate from the plain API-key placeholder fields ' +
          'below, which aren\'t wired to anything yet.</p>' +
        '<div class="platform-connect-card" id="youtubeConnectCard">' +
          '<div class="platform-connect-info">' +
            '<span class="platform-connect-name">YouTube</span>' +
            '<span class="platform-connect-status" id="youtubeConnectStatus">Checking…</span>' +
          '</div>' +
          '<button type="button" class="btn-secondary btn-tiny" id="youtubeConnectBtn" disabled>…</button>' +
        '</div>' +
        '<div class="platform-connect-card" id="tiktokConnectCard">' +
          '<div class="platform-connect-info">' +
            '<span class="platform-connect-name">TikTok</span>' +
            '<span class="platform-connect-status" id="tiktokConnectStatus">Checking…</span>' +
          '</div>' +
          '<button type="button" class="btn-secondary btn-tiny" id="tiktokConnectBtn" disabled>…</button>' +
        '</div>' +
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
    { id: 'instagram', label: 'Instagram' },
    { id: 'facebook', label: 'Facebook' },
    { id: 'transcriptionProvider', label: 'Transcription provider', placeholder: 'e.g. AssemblyAI, Deepgram, Whisper' },
    { id: 'transcriptionKey', label: 'Transcription API key', type: 'password' }
  ];

  // YouTube's and TikTok's own real OAuth connect cards, above — both
  // have a working login flow now (src/youtubeAuth.js, src/tiktokAuth.js),
  // so the old plain-text "TikTok (pending access)" API key field (never
  // wired to anything) was dropped from KEY_FIELDS rather than kept
  // alongside a second, real mechanism for the same platform — same
  // reasoning already applied to YouTube's own field.
  function renderYoutubeConnectCard() {
    var statusEl = document.getElementById('youtubeConnectStatus');
    var btn = document.getElementById('youtubeConnectBtn');
    if (!statusEl || !btn) return;
    fetch('/api/youtube/status', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!s) { statusEl.textContent = 'Status unavailable.'; btn.disabled = true; btn.textContent = '—'; return; }
        if (!s.configured) {
          statusEl.textContent = 'Not configured yet (waiting on Google OAuth credentials).';
          btn.disabled = true;
          btn.textContent = 'Connect';
          return;
        }
        btn.disabled = false;
        if (s.connected) {
          statusEl.textContent = 'Connected as ' + (s.channelTitle || 'a YouTube channel') + '.';
          btn.textContent = 'Disconnect';
          btn.onclick = function () {
            btn.disabled = true;
            fetch('/api/youtube/disconnect', { method: 'POST', credentials: 'include' })
              .then(renderYoutubeConnectCard);
          };
        } else {
          statusEl.textContent = 'Not connected.';
          btn.textContent = 'Connect';
          // A real full-page navigation, not fetch() — this has to be an
          // actual browser redirect through Google's own consent screen,
          // which is exactly what Google's OAuth verification review
          // requires (see CLAUDE.md), not something an XHR can drive.
          btn.onclick = function () { window.location.href = '/api/youtube/oauth/start'; };
        }
      })
      .catch(function () { statusEl.textContent = 'Status unavailable.'; });
  }

  // Mirrors renderYoutubeConnectCard() exactly, one platform over.
  function renderTiktokConnectCard() {
    var statusEl = document.getElementById('tiktokConnectStatus');
    var btn = document.getElementById('tiktokConnectBtn');
    if (!statusEl || !btn) return;
    // /api/tiktok/* is requireAuth-only, always (server.js) — a reviewer
    // session would just get a 401 from the fetch below, so skip it and
    // say so plainly instead of a generic "Status unavailable."
    if (IS_REVIEWER) { statusEl.textContent = 'Not available for this account.'; btn.disabled = true; btn.textContent = 'N/A'; return; }
    fetch('/api/tiktok/status', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!s) { statusEl.textContent = 'Status unavailable.'; btn.disabled = true; btn.textContent = '—'; return; }
        if (!s.configured) {
          statusEl.textContent = 'Not configured yet (waiting on TikTok OAuth credentials).';
          btn.disabled = true;
          btn.textContent = 'Connect';
          return;
        }
        btn.disabled = false;
        if (s.connected) {
          statusEl.textContent = 'Connected as ' + (s.displayName || 'a TikTok account') + '.';
          btn.textContent = 'Disconnect';
          btn.onclick = function () {
            btn.disabled = true;
            fetch('/api/tiktok/disconnect', { method: 'POST', credentials: 'include' })
              .then(renderTiktokConnectCard);
          };
        } else {
          statusEl.textContent = 'Not connected.';
          btn.textContent = 'Connect';
          // Real full-page navigation through TikTok's own consent
          // screen, same reasoning as YouTube's — not something an XHR
          // can drive.
          btn.onclick = function () { window.location.href = '/api/tiktok/oauth/start'; };
        }
      })
      .catch(function () { statusEl.textContent = 'Status unavailable.'; });
  }

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
      var dis = IS_REVIEWER ? ' disabled' : '';
      return '<div class="cadence-row" data-key="' + row.key + '">' +
        '<span class="cadence-label">' + row.label + ' <span class="ink-faint">(' + row.hint + ')</span></span>' +
        '<span class="cadence-inputs">1 every <input type="number" min="1" step="1" class="cadence-every" value="' + cfg.every + '"' + dis + ' /> ' +
        '<select class="cadence-unit"' + dis + '><option value="hours"' + (cfg.unit === 'hours' ? ' selected' : '') + '>hours</option><option value="days"' + (cfg.unit === 'days' ? ' selected' : '') + '>days</option></select></span>' +
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

  // Store.put() goes through fetch(), which has no upload-progress event at
  // all — the only way to get real byte-level progress in a browser is
  // XMLHttpRequest's upload.onprogress, so this talks to the same
  // /api/files/audioTracks/:id endpoint store.js's put() would use, built
  // the same way (a "file" field plus a "meta" JSON field), but over XHR
  // instead. Scoped to just this one upload path rather than rebuilding
  // store.js's shared put() — the video-upload flow (Upload Files tab)
  // doesn't have this problem in the same way, since it renders each new
  // piece's card immediately from local state rather than waiting on a
  // server round-trip, so it wasn't touched here.
  function uploadAudioTrackWithProgress(file, onProgress) {
    return new Promise(function (resolve, reject) {
      var id = Store.genId();
      var fd = new FormData();
      fd.append('file', file, file.name);
      fd.append('meta', JSON.stringify({ id: id, name: file.name, createdAt: nowIso() }));
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/files/audioTracks/' + encodeURIComponent(id));
      xhr.withCredentials = true;
      xhr.upload.addEventListener('progress', function (e) {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      });
      xhr.addEventListener('load', function () {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error('upload failed (' + xhr.status + ')'));
      });
      xhr.addEventListener('error', function () { reject(new Error('upload failed')); });
      xhr.send(fd);
    });
  }

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
          // Ambient-library management (add/remove tracks) is admin-only —
          // a reviewer can still freely pick from existing tracks in
          // Content Production's audio dropdown, just can't change the
          // library itself.
          (IS_REVIEWER ? '' : '<button type="button" class="link-btn audio-delete" data-id="' + t.id + '">Delete</button>') +
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
      // Redacted to '' server-side for a reviewer session regardless (see
      // redactSettingsForReviewer in server.js) — disabling here too is
      // just the matching UI treatment, not the actual protection.
      input.value = settingsCache.apiKeys[f.id] || '';
      input.disabled = IS_REVIEWER;
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
      renderYoutubeConnectCard();
      renderTiktokConnectCard();

      // One textarea per platform, ids following "caption-<group>-<key>"
      // (see SETTINGS_MARKUP) — driven off CAPTION_GROUPS so this list
      // never drifts out of sync with the Final Check toggle's own set of
      // platforms/labels.
      Object.keys(CAPTION_GROUPS).forEach(function (groupKey) {
        CAPTION_GROUPS[groupKey].forEach(function (o) {
          var input = document.getElementById('caption-' + groupKey + '-' + o.key);
          if (!input) return;
          input.value = (settings.captions[groupKey] && settings.captions[groupKey][o.key]) || '';
          // A reviewer session can only ever edit the two YouTube caption
          // fields — server.js's mergeReviewerSettingsWrite ignores a
          // write to any other field anyway (even via a raw API call),
          // this is just the matching UI treatment.
          input.disabled = IS_REVIEWER && o.key !== 'ytshort' && o.key !== 'ytlong';
          input.addEventListener('input', function () {
            settingsCache.captions[groupKey][o.key] = input.value;
            saveSettingsDebounced();
          });
        });
      });

      var captionGroupTabs = document.getElementById('captionGroupTabs');
      if (captionGroupTabs) {
        captionGroupTabs.querySelectorAll('.caption-group-tab').forEach(function (btn) {
          btn.addEventListener('click', function () {
            captionGroupTabs.querySelectorAll('.caption-group-tab').forEach(function (b) {
              b.classList.toggle('active', b === btn);
            });
            document.querySelectorAll('.caption-group-panel').forEach(function (panel) {
              panel.hidden = panel.dataset.group !== btn.dataset.group;
            });
          });
        });
      }

      var baseLinkInput = document.getElementById('baseLinkInput');
      baseLinkInput.value = settings.baseLinkUrl || '';
      baseLinkInput.disabled = IS_REVIEWER;
      baseLinkInput.addEventListener('input', function () {
        settingsCache.baseLinkUrl = baseLinkInput.value;
        saveSettingsDebounced();
      });

      // Used to silently fire every Store.put() and guess renderAudioList()
      // could run 200ms later — no feedback while a real upload was still
      // in flight, and the list often hadn't actually landed by the time
      // that timeout fired, so Harvey had to refresh the page to see it.
      // Now each file gets its own real progress bar (XHR upload.progress,
      // see uploadAudioTrackWithProgress above) and the list only
      // refreshes once every upload has genuinely finished.
      var audioUpload = document.getElementById('audioUpload');
      var audioUploadProgressEl = document.getElementById('audioUploadProgress');
      // Ambient-library management is admin-only (server.js rejects a
      // reviewer session's upload outright, matching the Delete-button
      // hide above) — disabling the file input here also stops its
      // wrapping <label> from opening the file picker on click.
      audioUpload.disabled = IS_REVIEWER;
      audioUpload.addEventListener('change', function () {
        var files = Array.prototype.slice.call(audioUpload.files);
        audioUpload.value = '';
        if (!files.length) return;
        var rows = files.map(function (file) {
          var row = document.createElement('div');
          row.className = 'audio-upload-row';
          var label = document.createElement('span');
          label.className = 'audio-upload-name';
          label.textContent = file.name;
          var bar = document.createElement('progress');
          bar.max = 1;
          bar.value = 0;
          row.appendChild(label);
          row.appendChild(bar);
          audioUploadProgressEl.appendChild(row);
          return { row: row, bar: bar, file: file };
        });
        Promise.all(rows.map(function (r) {
          return uploadAudioTrackWithProgress(r.file, function (frac) { r.bar.value = frac; })
            .then(function () {
              if (r.row.parentNode) r.row.parentNode.removeChild(r.row);
            })
            .catch(function (err) {
              r.bar.remove();
              var errEl = document.createElement('span');
              errEl.className = 'audio-upload-error';
              errEl.textContent = 'Failed: ' + ((err && err.message) || 'unknown error');
              r.row.appendChild(errEl);
            });
        })).then(renderAudioList);
      });
    });
  }

  // Runs last, after OPS_MARKUP/UPLOAD_MARKUP/SETTINGS_MARKUP and all boot*
  // functions above are defined — calling this any earlier (it used to sit
  // right after the login form wiring) crashes on any visit where the
  // session check below resolves true, since showApp() renders a tab
  // immediately using markup that doesn't exist yet.
  Auth.checkSession().then(function (result) {
    if (result) {
      CURRENT_ROLE = result.role || 'admin';
      IS_REVIEWER = CURRENT_ROLE === 'youtube-reviewer';
      showApp();
    } else {
      showLogin();
    }
  });
})();
