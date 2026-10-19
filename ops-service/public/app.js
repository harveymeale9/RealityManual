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
  var pmAutoSpeechUnsub = null;

  // Nav hierarchy (Harvey's restructure, 2026-09-19): top level is just
  // Project Manager / Content Ops / Research / Analytics / Mailbox — the
  // multi-leaf entries are groups, not routable panels themselves.
  // Leaf tab ids are unchanged from before this restructure (only labels/grouping
  // changed) so nothing downstream that already keys off e.g.
  // active === 'content-ops' needed to change.
  var GROUPS = [
    { label: 'Project Manager', tabs: [
        { id: 'project-manager', label: 'Project Manager' }
      ] },
    { label: 'Content Ops', tabs: [
        { id: 'content-ops', label: 'Content Pipeline' },
        { id: 'content-ideation', label: 'Content Ideation' },
        { id: 'editor', label: 'Editor' },
        { id: 'upload-files', label: 'Content Production' },
        { id: 'settings', label: 'Content Settings' }
      ] },
    { label: 'Research', tabs: [
        { id: 'outlier-analysis', label: 'Outlier Analysis' },
        { id: 'idea-research', label: 'Idea Research' }
      ] },
    { label: 'Analytics', tabs: [
        { id: 'content-analytics', label: 'Content Analytics' },
        { id: 'sales-analytics', label: 'Sales Analytics' },
        { id: 'website-analytics', label: 'Website Analytics' }
      ] },
    { label: 'Mailbox', tabs: [
        { id: 'mailbox', label: 'Mailbox' }
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
  // more than one leaf (Content Ops, Research, Analytics) — this is the only way to
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
    'sales-analytics': {
      title: 'Sales Analytics',
      blurb: 'The private sales feed is temporarily unavailable. Content Studio will retry when this tab is reopened.',
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

  var salesAnalyticsTimer = null;
  var contentAnalyticsTimer = null;
  var contentOverallRangeDays = 30;

  function salesMoney(cents, currency) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: String(currency || 'USD').toUpperCase(), maximumFractionDigits: 2 }).format((Number(cents) || 0) / 100);
    } catch (e) {
      return '$' + ((Number(cents) || 0) / 100).toFixed(2);
    }
  }

  function salesStatusLabel(status) {
    return String(status || 'Pending').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
  }

  function salesStatusTone(status) {
    if (['BOOKVAULT_ACCEPTED', 'SHIPPED', 'COMPLETE'].indexOf(status) !== -1) return 'good';
    if (status === 'REFUNDED' || status === 'PAYMENT_FAILED') return 'bad';
    if (status === 'FULFILLMENT_RETRY') return 'warn';
    return 'pending';
  }

  function salesConversion(orders, analytics, step) {
    if (!analytics || !analytics.funnel) return '—';
    var row = analytics.funnel.filter(function (entry) { return entry.step === step; })[0];
    var visits = row ? Number(row.unique_sessions) || 0 : 0;
    return visits ? ((Number(orders) || 0) / visits * 100).toFixed(1) + '%' : '—';
  }

  function renderSalesAnalytics() {
    clearTimeout(salesAnalyticsTimer);
    panelMain.innerHTML = '<div class="sales-dashboard sales-loading"><div class="eyebrow">Live storefront database</div><h2>Sales Analytics</h2><p>Loading orders and revenue…</p></div>';
    Promise.all([
      fetch('/api/reports/sales-dashboard', { credentials: 'include' }).then(function (res) {
        if (!res.ok) throw new Error('sales_status_' + res.status);
        return res.json();
      }),
      fetch(STOREFRONT_API_BASE + '/api/analytics/summary').then(function (res) { return res.ok ? res.json() : null; }).catch(function () { return null; })
    ]).then(function (results) {
      if (currentTabId() !== 'sales-analytics') return;
      var data = results[0];
      var analytics = results[1];
      var periodConfig = [
        ['Today', data.periods.today],
        ['Last 7 days', data.periods.last_7_days],
        ['Last 30 days', data.periods.last_30_days],
        ['All time', data.periods.all_time]
      ];
      var periodCards = periodConfig.map(function (entry) {
        var totals = entry[1];
        return '<article class="sales-metric-card"><span>' + entry[0] + '</span>' +
          '<strong>' + salesMoney(totals.revenue_cents) + '</strong>' +
          '<small>' + totals.paid_orders + ' paid order' + (totals.paid_orders === 1 ? '' : 's') + ' · ' + totals.units + ' book' + (totals.units === 1 ? '' : 's') + '</small></article>';
      }).join('');

      var maximumRevenue = Math.max.apply(Math, data.daily.map(function (day) { return Number(day.revenue_cents) || 0; }).concat([0]));
      var chart = maximumRevenue ? data.daily.map(function (day, index) {
        var amount = Number(day.revenue_cents) || 0;
        var height = amount ? Math.max(5, Math.round(amount / maximumRevenue * 100)) : 2;
        var label = (index % 5 === 0 || index === data.daily.length - 1) ? day.day.slice(5) : '';
        return '<div class="sales-chart-column" title="' + escapeHtml(day.day + ': ' + salesMoney(amount) + ' · ' + day.orders + ' orders') + '">' +
          '<div class="sales-chart-track"><i style="height:' + height + '%"></i></div><span>' + label + '</span></div>';
      }).join('') : '<div class="sales-empty-chart">Your first paid order will appear here automatically.</div>';

      var countries = data.countries.length ? data.countries.map(function (country) {
        return '<div class="sales-country-row"><strong>' + escapeHtml(country.country) + '</strong><span>' + country.orders + ' order' + (country.orders === 1 ? '' : 's') + ' · ' + country.units + ' books</span><b>' + salesMoney(country.revenue_cents) + '</b></div>';
      }).join('') : '<div class="sales-empty">No paid orders yet.</div>';

      var recentOrders = data.recent_orders.length ? data.recent_orders.map(function (order) {
        var date = new Date(order.created_at);
        var paymentSettled = ['succeeded', 'paid'].indexOf(order.stripe_payment_status) !== -1;
        var operations = paymentSettled
          ? '<span class="' + (order.bookvault_order_id ? 'done' : '') + '">BookVault ' + (order.bookvault_order_id ? 'accepted' : 'pending') + '</span>' +
            '<span class="' + (order.confirmation_email_sent ? 'done' : '') + '">Email ' + (order.confirmation_email_sent ? 'sent' : 'pending') + '</span>' +
            '<span class="' + (order.resend_contact_synced ? 'done' : '') + '">Resend ' + (order.resend_contact_synced ? 'tagged' : 'pending') + '</span>'
          : '<span>Awaiting payment</span>';
        return '<div class="sales-order-row">' +
          '<time datetime="' + escapeHtml(order.created_at || '') + '">' + (isNaN(date.getTime()) ? '—' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })) + '</time>' +
          '<strong>#' + escapeHtml(String(order.id || '').slice(0, 8).toUpperCase()) + '<small>' + escapeHtml(order.country) + ' · ' + order.quantity + ' book' + (order.quantity === 1 ? '' : 's') + '</small></strong>' +
          '<span class="sales-order-status ' + salesStatusTone(order.order_status) + '">' + escapeHtml(salesStatusLabel(order.order_status)) + '</span>' +
          '<b>' + salesMoney(order.total_price_cents, order.currency) + '</b>' +
          '<div class="sales-order-ops">' + operations + '</div></div>';
      }).join('') : '<div class="sales-empty sales-empty-orders"><strong>No orders yet</strong><span>Tomorrow’s purchase will appear here as soon as checkout creates it, with payment, BookVault, email, and Resend status.</span></div>';

      var refunds = (data.recent_refunds || []).map(function (refund) {
        var date = new Date(refund.refunded_at);
        return '<article class="sales-refund-row" data-refund-id="' + escapeHtml(refund.id) + '">' +
          '<div class="sales-refund-top"><strong>#' + escapeHtml(String(refund.id || '').slice(0, 8).toUpperCase()) + '</strong>' +
            '<time datetime="' + escapeHtml(refund.refunded_at || '') + '">' + (isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })) + '</time>' +
            '<b>' + salesMoney(refund.total_price_cents, refund.currency) + '</b></div>' +
          '<p><span>Reason</span> <strong class="sales-refund-reason-text">' + escapeHtml(refund.reason || 'Reason not recorded') + '</strong></p>' +
          (refund.fulfillment_context ? '<small>Fulfillment context: ' + escapeHtml(refund.fulfillment_context) + '</small>' : '') +
          '<details class="sales-refund-note-editor"><summary>' + (refund.note ? 'Edit reason note' : 'Add reason note') + '</summary>' +
            '<textarea maxlength="500" rows="2" aria-label="Refund reason note" placeholder="Why was this order refunded?">' + escapeHtml(refund.note || '') + '</textarea>' +
            '<div><button type="button" class="btn-secondary btn-tiny sales-refund-save">Save note</button><span class="sales-refund-save-status" role="status"></span></div></details>' +
          '</article>';
      }).join('') || '<div class="sales-empty">No refunds recorded.</div>';

      var thirty = data.periods.last_30_days;
      panelMain.innerHTML = '<div class="sales-dashboard">' +
        '<header class="sales-dashboard-head"><div><div class="eyebrow">Live storefront database</div><h2>Sales Analytics</h2><p>Revenue, orders, fulfillment and customer-email delivery.</p></div>' +
          '<div><span>Updated ' + new Date(data.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</span><button type="button" class="btn-secondary btn-tiny" id="salesRefresh">Refresh</button></div></header>' +
        '<section class="sales-metric-grid">' + periodCards + '</section>' +
        '<section class="sales-secondary-grid">' +
          '<article><span>30-day average order</span><strong>' + salesMoney(thirty.average_order_cents) + '</strong></article>' +
          '<article><span>30-day refunds</span><strong>' + thirty.refunded_orders + '</strong><small>' + salesMoney(thirty.refunded_value_cents) + ' · <button type="button" class="sales-refund-jump" id="salesRefundJump">View reasons</button></small></article>' +
          '<article><span>Landing → order</span><strong>' + salesConversion(thirty.paid_orders, analytics, 'landing_page_view') + '</strong><small>verified visits</small></article>' +
          '<article><span>Checkout → order</span><strong>' + salesConversion(thirty.paid_orders, analytics, 'checkout_view') + '</strong><small>verified visits</small></article>' +
        '</section>' +
        '<div class="sales-dashboard-columns"><section class="sales-block sales-chart-block"><div class="sales-block-head"><div><span>Revenue</span><h3>Last 30 days</h3></div><b>' + salesMoney(thirty.revenue_cents) + '</b></div><div class="sales-chart">' + chart + '</div></section>' +
          '<section class="sales-block"><div class="sales-block-head"><div><span>Markets</span><h3>Revenue by country</h3></div></div><div class="sales-country-list">' + countries + '</div></section></div>' +
        '<section class="sales-block sales-refunds" id="salesRefunds"><div class="sales-block-head"><div><span>Money returned</span><h3>Refunds &amp; reasons</h3></div><small>' + data.periods.all_time.refunded_orders + ' all time · newest 100 shown</small></div><div class="sales-refund-list">' + refunds + '</div></section>' +
        '<section class="sales-block sales-orders"><div class="sales-block-head"><div><span>Operations</span><h3>Recent orders</h3></div><small>Newest 25 · refreshes every 30 seconds</small></div><div class="sales-order-list">' + recentOrders + '</div></section>' +
      '</div>';
      var refresh = document.getElementById('salesRefresh');
      if (refresh) refresh.addEventListener('click', renderSalesAnalytics);
      var refundJump = document.getElementById('salesRefundJump');
      if (refundJump) refundJump.addEventListener('click', function () { document.getElementById('salesRefunds').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      panelMain.querySelectorAll('.sales-refund-row').forEach(function (row) {
        var button = row.querySelector('.sales-refund-save');
        button.addEventListener('click', function () {
          var note = row.querySelector('textarea').value.trim();
          var status = row.querySelector('.sales-refund-save-status');
          button.disabled = true;
          status.textContent = 'Saving…';
          fetch('/api/reports/refunds/' + encodeURIComponent(row.dataset.refundId) + '/note', {
            method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: note })
          }).then(function (response) { if (!response.ok) throw new Error('save_failed'); return response.json(); }).then(function () {
            var refund = (data.recent_refunds || []).find(function (item) { return item.id === row.dataset.refundId; });
            row.querySelector('.sales-refund-reason-text').textContent = note || (refund && refund.system_reason) || 'Reason not recorded';
            row.querySelector('summary').textContent = note ? 'Edit reason note' : 'Add reason note';
            status.textContent = 'Saved';
          }).catch(function () { status.textContent = 'Could not save. Try again.'; }).finally(function () { button.disabled = false; });
        });
      });
      salesAnalyticsTimer = setTimeout(function refreshSalesAnalytics() {
        if (currentTabId() !== 'sales-analytics') return;
        if (document.activeElement && document.activeElement.closest('.sales-refund-note-editor')) {
          salesAnalyticsTimer = setTimeout(refreshSalesAnalytics, 30000);
          return;
        }
        renderSalesAnalytics();
      }, 30000);
    }).catch(function () {
      if (currentTabId() !== 'sales-analytics') return;
      renderAnalyticsPlaceholder('sales-analytics');
    });
  }

  function websiteTrafficHtml(traffic) {
    if (!traffic || !Array.isArray(traffic.daily) || traffic.daily.length !== 14) return '';
    var current = Number(traffic.last_7_days) || 0;
    var previous = Number(traffic.previous_7_days) || 0;
    var difference = current - previous;
    var comparison = previous
      ? (difference > 0 ? '+' : '') + Math.round(difference / previous * 100) + '% vs previous 7 days'
      : (current ? 'New traffic vs previous 7 days' : 'No pageviews in either week');
    var trendClass = difference > 0 ? 'is-up' : difference < 0 ? 'is-down' : 'is-flat';
    var maximum = Math.max(1, ...traffic.daily.map(function (row) { return Number(row.page_views) || 0; }));
    var bars = traffic.daily.map(function (row, index) {
      var count = Math.max(0, Number(row.page_views) || 0);
      var date = new Date(row.day + 'T00:00:00Z');
      var shortDate = Number.isNaN(date.getTime()) ? row.day : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
      return '<div class="website-traffic-day' + (index >= 7 ? ' is-current' : '') + '" role="img" aria-label="' + escapeHtml(row.day) + ': ' + count + ' page views" title="' + escapeHtml(row.day) + ': ' + count + ' page views">' +
        '<span class="website-traffic-value">' + count + '</span>' +
        '<span class="website-traffic-track"><i style="height:' + (count ? Math.max(4, count / maximum * 100) : 0) + '%"></i></span>' +
        '<span class="website-traffic-date">' + escapeHtml(shortDate) + '</span>' +
      '</div>';
    }).join('');
    var lineDays = Array.isArray(traffic.line_daily) && traffic.line_daily.length === 30 ? traffic.line_daily : [];
    var lineChart = '';
    if (lineDays.length) {
      var counts = lineDays.map(function (row) { return Math.max(0, Number(row.page_views) || 0); });
      var ceiling = Math.max(1, Math.ceil(Math.max(...counts) / 5) * 5);
      var xAt = function (index) { return 48 + index * 832 / (lineDays.length - 1); };
      var yAt = function (count) { return 205 - count * 175 / ceiling; };
      var points = counts.map(function (count, index) { return xAt(index).toFixed(1) + ' ' + yAt(count).toFixed(1); });
      var linePath = 'M ' + points.join(' L ');
      var areaPath = linePath + ' L 880 205 L 48 205 Z';
      var ticks = [ceiling, Math.round(ceiling / 2), 0].map(function (value) {
        var y = yAt(value).toFixed(1);
        return '<line x1="48" y1="' + y + '" x2="880" y2="' + y + '" class="website-line-grid" />' +
          '<text x="40" y="' + (Number(y) + 4) + '" text-anchor="end" class="website-line-axis">' + value + '</text>';
      }).join('');
      var dates = [0, 7, 14, 21, 29].map(function (index) {
        var row = lineDays[index];
        var date = new Date(row.day + 'T00:00:00Z');
        var label = Number.isNaN(date.getTime()) ? row.day : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
        return '<text x="' + xAt(index).toFixed(1) + '" y="239" text-anchor="' + (index === 0 ? 'start' : index === 29 ? 'end' : 'middle') + '" class="website-line-axis">' + escapeHtml(label) + '</text>';
      }).join('');
      var markers = lineDays.map(function (row, index) {
        var count = counts[index];
        var x = xAt(index).toFixed(1);
        var y = yAt(count).toFixed(1);
        return '<circle cx="' + x + '" cy="' + y + '" r="3" class="website-line-dot" />' +
          '<circle cx="' + x + '" cy="' + y + '" r="11" class="website-line-hit"><title>' + escapeHtml(row.day) + ': ' + count + ' page views</title></circle>';
      }).join('');
      lineChart = '<div class="website-line"><div class="website-line-heading"><span class="eyebrow">Last 30 full days</span><span>Daily verified page views · hover for counts</span></div>' +
        '<svg viewBox="0 0 900 250" role="img" aria-label="Daily verified page views for the last 30 completed UTC days" preserveAspectRatio="xMidYMid meet">' +
        '<path d="' + areaPath + '" class="website-line-area" />' + ticks +
        '<path d="' + linePath + '" class="website-line-path" />' + markers + dates + '</svg></div>';
    }
    return '<section class="website-traffic" aria-label="Website pageview trend">' +
      '<div class="website-traffic-head"><div><span class="eyebrow">Traffic trend · completed UTC days</span>' +
        '<h3>Page views, day by day</h3></div>' +
        '<p>Last 7 full days <strong>' + current + '</strong> <span class="website-traffic-change ' + trendClass + '">' + escapeHtml(comparison) + '</span></p></div>' +
      lineChart +
      '<div class="website-bars-heading eyebrow">Last 14 full days · exact daily counts</div>' +
      '<div class="website-traffic-chart" aria-label="Fourteen daily pageview counts">' + bars + '</div>' +
      '<div class="website-traffic-foot"><span>Previous 7 days: ' + previous + '</span><span>Latest 7 days: ' + current + '</span></div>' +
    '</section>';
  }

  function renderWebsiteAnalytics() {
    panelMain.innerHTML = '<div class="tab-placeholder wide"><div class="eyebrow">Loading…</div><h2>Website Analytics</h2></div>';
    Promise.all([
      fetch(STOREFRONT_API_BASE + '/api/analytics/summary')
        .then(function (res) { if (!res.ok) throw new Error('bad_status'); return res.json(); }),
      fetch('/api/reports/sales-dashboard', { credentials: 'include' })
        .then(function (res) { return res.ok ? res.json() : null; })
        .catch(function () { return null; }),
      fetch('/api/reports/website-traffic', { credentials: 'include' })
        .then(function (res) { return res.ok ? res.json() : null; })
        .catch(function () { return null; })
    ])
      .then(function (results) {
        if (currentTabId() !== 'website-analytics') return; // navigated away before this resolved
        var data = results[0];
        var sales = results[1];
        var traffic = results[2];

        var funnelLabels = {
          page_view: 'Page viewed',
          landing_page_view: 'Landing page viewed',
          purchase_cta_clicked: 'Purchase button clicked',
          checkout_cta_header_clicked: 'Header checkout clicked',
          checkout_cta_primary_clicked: 'Primary offer checkout clicked',
          checkout_cta_final_clicked: 'Final checkout clicked',
          checkout_arrival_header: 'Checkout reached from header',
          checkout_arrival_primary: 'Checkout reached from primary offer',
          checkout_arrival_final: 'Checkout reached from final CTA',
          checkout_view: 'Checkout page viewed',
          checkout_started: 'Checkout form engaged',
          payment_submitted: 'Payment submitted',
          order_complete: 'Order completed',
          order_refunded: 'Order refunded',
          order_failed: 'Order failed'
        };
        var funnel = data.funnel.slice();
        var refundedOrders = sales && sales.periods && sales.periods.last_30_days
          ? Number(sales.periods.last_30_days.refunded_orders) || 0
          : 0;
        var failedIndex = funnel.findIndex(function (row) { return row.step === 'order_failed'; });
        var refundedRow = { step: 'order_refunded', count: refundedOrders };
        if (failedIndex === -1) funnel.push(refundedRow);
        else funnel.splice(failedIndex, 0, refundedRow);

        var funnelRows = funnel.map(function (f) {
          return '<div class="funnel-row"><span class="funnel-step">' + escapeHtml(funnelLabels[f.step] || f.step.replace(/_/g, ' ')) + '</span>' +
            '<span class="funnel-count">' + f.count + '</span></div>';
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
                '<div class="overview-tile-sub">' + data.today.unique_visitors + ' verified browsers</div></div>' +
              '<div class="overview-tile"><div class="overview-tile-head">Last 30 days</div>' +
                '<div class="overview-tile-stat"><span class="n">' + data.last_30_days.page_views + '</span> page views</div>' +
                '<div class="overview-tile-sub">' + data.last_30_days.unique_visitors + ' verified daily visits</div></div>' +
            '</div>' +
            websiteTrafficHtml(traffic) +
            '<div class="funnel-section"><div class="eyebrow">What is counted</div>' +
              '<p class="analytics-definition">' + escapeHtml(data.visitor_definition || '') + '</p>' +
              '<p class="analytics-definition">Known bots, automated checks, and ' + Number(data.excluded_unverified_events || 0) + ' older/unverified events are excluded.</p>' +
              '<a class="analytics-internal-link" href="https://realitymanual.com/?rm_internal=1" target="_blank" rel="noopener">Exclude this browser from storefront analytics</a>' +
            '</div>' +
            '<div class="funnel-section">' +
              '<div class="eyebrow">Funnel — last 30 days</div>' +
              '<div class="funnel-list">' + funnelRows + '</div>' +
              (refundedOrders ? '<a class="analytics-internal-link" href="#sales-analytics">View refunded orders and reasons in Sales Analytics</a>' : '') +
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

  var CONTENT_PLATFORM_META = {
    youtube: { label: 'YouTube', color: '#ff5f67' },
    tiktok: { label: 'TikTok', color: '#68e3db' },
    instagram: { label: 'Instagram', color: '#d98cff' },
    facebook: { label: 'Facebook', color: '#63a8ff' }
  };

  function contentNumber(value) {
    return value == null ? '—' : Number(value).toLocaleString('en-US');
  }
  function contentPercent(value) {
    return value == null ? '—' : Number(value).toFixed(value < 1 ? 2 : 1).replace(/\.0$/, '') + '%';
  }
  function contentDate(value) {
    var date = new Date(value || 0);
    return isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function contentViews(piece, platform) {
    var row = piece.platforms && piece.platforms[platform];
    return row && row.views != null ? contentNumber(row.views) : '—';
  }

  function contentLineChart(piece) {
    var series = Object.keys(CONTENT_PLATFORM_META).map(function (platform) {
      var metric = piece.platforms && piece.platforms[platform];
      var points = metric && metric.history ? metric.history.filter(function (point) { return point.views != null; }) : [];
      return { platform: platform, points: points };
    }).filter(function (series) { return series.points.length; });
    if (!series.length) return '<div class="content-chart-empty">View history will appear after the first platform snapshot.</div>';
    var timestamps = [];
    var values = [0];
    series.forEach(function (item) { item.points.forEach(function (point) { timestamps.push(new Date(point.at).getTime()); values.push(Number(point.views) || 0); }); });
    var minTime = Math.min.apply(Math, timestamps);
    var maxTime = Math.max.apply(Math, timestamps);
    var maxValue = Math.max.apply(Math, values.concat([1]));
    var plot = { left: 48, top: 18, width: 642, height: 170 };
    function x(time) { return minTime === maxTime ? plot.left + plot.width / 2 : plot.left + (time - minTime) / (maxTime - minTime) * plot.width; }
    function y(value) { return plot.top + plot.height - (Number(value) || 0) / maxValue * plot.height; }
    var grid = [0, .25, .5, .75, 1].map(function (ratio) {
      var py = plot.top + plot.height * (1 - ratio);
      return '<line x1="' + plot.left + '" y1="' + py + '" x2="' + (plot.left + plot.width) + '" y2="' + py + '" />' +
        '<text x="40" y="' + (py + 4) + '">' + contentNumber(Math.round(maxValue * ratio)) + '</text>';
    }).join('');
    var paths = series.map(function (item) {
      var color = CONTENT_PLATFORM_META[item.platform].color;
      var coords = item.points.map(function (point) { return x(new Date(point.at).getTime()).toFixed(1) + ',' + y(point.views).toFixed(1); });
      var line = coords.length > 1 ? '<polyline points="' + coords.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />' : '';
      var dots = item.points.map(function (point) {
        return '<circle cx="' + x(new Date(point.at).getTime()).toFixed(1) + '" cy="' + y(point.views).toFixed(1) + '" r="4" fill="' + color + '"><title>' + escapeHtml(CONTENT_PLATFORM_META[item.platform].label + ': ' + contentNumber(point.views) + ' views · ' + contentDate(point.at)) + '</title></circle>';
      }).join('');
      return line + dots;
    }).join('');
    var legend = series.map(function (item) { return '<span style="--series:' + CONTENT_PLATFORM_META[item.platform].color + '">' + CONTENT_PLATFORM_META[item.platform].label + '</span>'; }).join('');
    return '<div class="content-chart-legend">' + legend + '</div><svg class="content-line-chart" viewBox="0 0 720 215" role="img" aria-label="Views over time by platform"><g class="content-chart-grid">' + grid + '</g>' + paths +
      '<text class="content-chart-time" x="48" y="208">' + escapeHtml(contentDate(new Date(minTime).toISOString())) + '</text>' +
      '<text class="content-chart-time end" x="690" y="208">' + escapeHtml(minTime === maxTime ? 'History starts here' : contentDate(new Date(maxTime).toISOString())) + '</text></svg>';
  }

  function contentOverallChart(data, rangeDays) {
    rangeDays = [7, 30, 90].indexOf(Number(rangeDays)) !== -1 ? Number(rangeDays) : 30;
    var history = Array.isArray(data.viewHistory) ? data.viewHistory : [];
    var windowDays = history.slice(-rangeDays);
    var firstIndex = windowDays.findIndex(function (day) { return day.total != null; });
    var days = firstIndex < 0 ? [] : windowDays.slice(firstIndex);
    var controls = '<div class="content-overall-ranges" role="group" aria-label="View history range">' + [7, 30, 90].map(function (option) {
      return '<button type="button" data-content-range="' + option + '" aria-pressed="' + (option === rangeDays) + '">' + option + 'd</button>';
    }).join('') + '</div>';
    var series = [{ key: 'total', label: 'Total', color: '#ecfff1' }].concat(Object.keys(CONTENT_PLATFORM_META).map(function (platform) {
      return { key: platform, label: CONTENT_PLATFORM_META[platform].label, color: CONTENT_PLATFORM_META[platform].color };
    }));
    if (!days.length) return '<section class="content-block content-overall"><div class="content-block-head"><div><span>Last ' + rangeDays + ' days</span><h3>Views across platforms</h3></div>' + controls + '</div><div class="content-chart-empty">The first view snapshot will start this graph. Earlier views cannot be reconstructed.</div></section>';
    var observed = days.map(function (day, index) { return { index: index, value: day.total }; }).filter(function (point) { return point.value != null; });
    var trend = [];
    if (observed.length > 1) {
      var meanX = observed.reduce(function (sum, point) { return sum + point.index; }, 0) / observed.length;
      var meanY = observed.reduce(function (sum, point) { return sum + point.value; }, 0) / observed.length;
      var denominator = observed.reduce(function (sum, point) { return sum + Math.pow(point.index - meanX, 2); }, 0);
      var slope = denominator ? observed.reduce(function (sum, point) { return sum + (point.index - meanX) * (point.value - meanY); }, 0) / denominator : 0;
      [observed[0].index, observed[observed.length - 1].index].forEach(function (index) {
        trend.push({ index: index, value: Math.max(0, meanY + slope * (index - meanX)) });
      });
    }
    var values = days.flatMap(function (day) { return series.map(function (item) { return Number(day[item.key]) || 0; }); }).concat(trend.map(function (point) { return point.value; }));
    var maximum = Math.max(4, ...values);
    var magnitude = Math.pow(10, Math.floor(Math.log10(maximum / 4)));
    var ceiling = Math.ceil(maximum / (4 * magnitude)) * 4 * magnitude;
    var x = function (index) { return days.length === 1 ? 465 : 60 + index * 810 / (days.length - 1); };
    var y = function (value) { return 222 - value / ceiling * 194; };
    var grid = [0, .25, .5, .75, 1].map(function (ratio) {
      var py = y(ceiling * ratio).toFixed(1);
      return '<line x1="60" y1="' + py + '" x2="870" y2="' + py + '" />' +
        '<text x="52" y="' + (Number(py) + 4) + '">' + contentNumber(Math.round(ceiling * ratio)) + '</text>';
    }).join('');
    var paths = series.map(function (item) {
      var points = days.map(function (day, index) { return day[item.key] == null ? null : { index: index, value: Number(day[item.key]) || 0, day: day.day }; }).filter(Boolean);
      if (!points.length) return '';
      var coords = points.map(function (point) { return x(point.index).toFixed(1) + ',' + y(point.value).toFixed(1); });
      var line = points.length > 1 ? '<polyline points="' + coords.join(' ') + '" fill="none" stroke="' + item.color + '" stroke-width="' + (item.key === 'total' ? 3.5 : 2) + '" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />' : '<circle cx="' + x(points[0].index).toFixed(1) + '" cy="' + y(points[0].value).toFixed(1) + '" r="4" fill="' + item.color + '" />';
      var markers = points.map(function (point) {
        return '<circle cx="' + x(point.index).toFixed(1) + '" cy="' + y(point.value).toFixed(1) + '" r="8" fill="transparent" class="content-overall-hit"><title>' + escapeHtml(item.label + ' · ' + point.day + ': ' + contentNumber(point.value) + ' views') + '</title></circle>';
      }).join('');
      return line + markers;
    }).join('');
    var trendPath = trend.length ? '<line x1="' + x(trend[0].index).toFixed(1) + '" y1="' + y(trend[0].value).toFixed(1) + '" x2="' + x(trend[1].index).toFixed(1) + '" y2="' + y(trend[1].value).toFixed(1) + '" class="content-overall-trend" />' : '';
    var axisCount = Math.min(5, days.length);
    var axisDates = Array.from({ length: axisCount }, function (_, position) {
      var index = axisCount === 1 ? 0 : Math.round(position * (days.length - 1) / (axisCount - 1));
      var date = new Date(days[index].day + 'T00:00:00Z');
      var label = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
      return '<text x="' + x(index).toFixed(1) + '" y="259" class="content-overall-date" text-anchor="' + (axisCount === 1 ? 'middle' : position === 0 ? 'start' : position === axisCount - 1 ? 'end' : 'middle') + '">' + escapeHtml(label) + '</text>';
    }).join('');
    var latest = days[days.length - 1];
    var legend = series.map(function (item) {
      return '<span style="--series:' + item.color + '"><i></i>' + item.label + ' <strong>' + contentNumber(latest[item.key]) + '</strong></span>';
    }).join('') + (trend.length ? '<span class="content-overall-trend-key"><i></i>Linear trend</span>' : '');
    var firstDate = new Date(days[0].day + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return '<section class="content-block content-overall"><div class="content-block-head"><div><span>Last ' + rangeDays + ' days · UTC</span><h3>Views across platforms</h3></div>' + controls + '</div>' +
      '<div class="content-overall-body"><div class="content-overall-legend">' + legend + '</div>' +
      '<svg viewBox="0 0 900 270" role="img" aria-label="Cumulative view history by platform, total, and linear trend for the selected period" preserveAspectRatio="xMidYMid meet"><g class="content-chart-grid">' + grid + '</g>' + paths + trendPath + axisDates + '</svg>' +
      '<p>Showing ' + days.length + ' days with known totals in this ' + rangeDays + '-day window, from ' + escapeHtml(firstDate) + '. No blank pre-tracking dates are plotted. Counts carry forward between snapshots; platform view definitions differ.</p></div></section>';
  }

  function contentDetailMarkup(piece) {
    var platformCards = Object.keys(piece.platforms || {}).map(function (platform) {
      var metric = piece.platforms[platform];
      var meta = CONTENT_PLATFORM_META[platform];
      var actions = Number(metric.likes || 0) + Number(metric.comments || 0) + Number(metric.shares || 0) + Number(metric.saves || 0);
      return '<article class="content-platform-card" style="--series:' + meta.color + '"><header><span>' + meta.label + '</span>' +
        (metric.url ? '<a href="' + escapeHtml(metric.url) + '" target="_blank" rel="noopener">Open ↗</a>' : '') + '</header>' +
        '<strong>' + contentNumber(metric.views) + '<small>views</small></strong>' +
        '<div><span>' + contentNumber(metric.likes) + ' likes</span><span>' + contentNumber(metric.comments) + ' comments</span><span>' + contentNumber(metric.shares) + ' shares</span></div>' +
        (metric.views == null ? '<p>Views are not available from the current connection yet.</p>' : '<p>' + contentNumber(actions) + ' measurable interactions' + (metric.averageWatchSeconds != null ? ' · ' + Number(metric.averageWatchSeconds).toFixed(1) + 's avg watch' : '') + '</p>') +
      '</article>';
    }).join('');
    return '<div class="content-detail-head"><div><div class="eyebrow">Piece performance</div><h3>' + escapeHtml(piece.title) + '</h3><p>Published ' + escapeHtml(contentDate(piece.postedAt)) + ' · ' + contentNumber(piece.views) + ' measured views across platforms.</p></div><strong>' + contentPercent(piece.engagementRate) + '<small>interaction rate</small></strong></div>' +
      '<div class="content-chart-shell"><div class="content-chart-title"><span>Views over time</span><small>Hourly snapshots · platform definitions differ</small></div>' + contentLineChart(piece) + '</div>' +
      '<div class="content-platform-grid">' + platformCards + '</div>';
  }

  function renderContentAnalytics(forceRefresh) {
    clearTimeout(contentAnalyticsTimer);
    panelMain.innerHTML = '<div class="content-dashboard content-loading"><div class="eyebrow">Cross-platform performance</div><h2>Content Analytics</h2><p>Collecting the latest video and audience metrics…</p></div>';
    fetch(forceRefresh ? '/api/reports/content-analytics/refresh' : '/api/reports/content-analytics', {
      method: forceRefresh ? 'POST' : 'GET', credentials: 'include'
    }).then(function (response) {
      if (!response.ok) throw new Error('content_analytics_' + response.status);
      return response.json();
    }).then(function (data) {
      if (currentTabId() !== 'content-analytics') return;
      var notices = Object.keys(data.providerStatus || {}).map(function (platform) {
        var status = data.providerStatus[platform];
        if (!status || (!status.error && !status.note)) return '';
        return '<div class="content-provider-note ' + (status.available ? 'partial' : 'error') + '"><strong>' + CONTENT_PLATFORM_META[platform].label + '</strong><span>' + escapeHtml(status.note || status.error) + '</span></div>';
      }).join('');
      var audience = data.audience.map(function (row) {
        var meta = CONTENT_PLATFORM_META[row.platform];
        return '<article class="content-audience-card" style="--series:' + meta.color + '"><span>' + meta.label + '</span><strong>' + contentNumber(row.followers) + '</strong><small>followers / subscribers</small>' +
          '<p>' + (row.followerChange7d == null ? 'Growth tracking starts with today’s snapshot.' : '+' + contentNumber(row.followerChange7d) + ' in 7 days') + '</p></article>';
      }).join('');
      var rows = data.pieces.length ? data.pieces.map(function (piece, index) {
        return '<button type="button" class="content-piece-row' + (index === 0 ? ' active' : '') + '" data-piece-index="' + index + '">' +
          '<span class="content-piece-title"><b>' + escapeHtml(piece.title) + '</b><small>' + escapeHtml(contentDate(piece.postedAt)) + '</small></span>' +
          '<span><small>Total</small><b>' + contentNumber(piece.views) + '</b></span>' +
          '<span><small>YT</small><b>' + contentViews(piece, 'youtube') + '</b></span>' +
          '<span><small>TT</small><b>' + contentViews(piece, 'tiktok') + '</b></span>' +
          '<span><small>IG</small><b>' + contentViews(piece, 'instagram') + '</b></span>' +
          '<span><small>FB</small><b>' + contentViews(piece, 'facebook') + '</b></span>' +
          '<span><small>Rate</small><b>' + contentPercent(piece.engagementRate) + '</b></span></button>';
      }).join('') : '<div class="content-empty"><strong>No published pieces yet</strong><span>Performance appears here after the first platform post is linked to Content Studio.</span></div>';

      panelMain.innerHTML = '<div class="content-dashboard"><header class="content-dashboard-head"><div><div class="eyebrow">Cross-platform performance</div><h2>Content Analytics</h2><p>Compare every piece, then inspect how each platform compounds over time.</p></div><div><span>' + (data.lastCollectedAt ? 'Updated ' + contentDate(data.lastCollectedAt) : 'First snapshot pending') + '</span><button type="button" class="btn-secondary btn-tiny" id="contentRefresh">Refresh metrics</button></div></header>' +
        '<section class="content-summary-grid"><article><span>Published pieces</span><strong>' + contentNumber(data.summary.pieces) + '</strong></article><article><span>Measured views</span><strong>' + contentNumber(data.summary.totalViews) + '</strong></article><article><span>Interactions</span><strong>' + contentNumber(data.summary.totalEngagements) + '</strong></article><article><span>Interaction rate</span><strong>' + contentPercent(data.summary.engagementRate) + '</strong></article><article><span>Known audience</span><strong>' + contentNumber(data.summary.followers) + '</strong></article></section>' +
        (notices ? '<section class="content-provider-notes">' + notices + '</section>' : '') +
        contentOverallChart(data, contentOverallRangeDays) +
        '<section class="content-block"><div class="content-block-head"><div><span>Audience</span><h3>Platform growth</h3></div><small>Followers are not additive identities; the total is directional.</small></div><div class="content-audience-grid">' + audience + '</div></section>' +
        '<div class="content-performance-layout"><section class="content-block content-piece-list"><div class="content-block-head"><div><span>Library</span><h3>Pieces by publish date</h3></div><small>Hover, focus, or tap a title</small></div><div class="content-piece-columns"><span>Piece</span><span>Total</span><span>YT</span><span>TT</span><span>IG</span><span>FB</span><span>Rate</span></div>' + rows + '</section>' +
        '<section class="content-block content-piece-detail" id="contentPieceDetail">' + (data.pieces[0] ? contentDetailMarkup(data.pieces[0]) : '') + '</section></div>' +
        '<p class="content-definition">Views are useful for reach, but watch time/retention and interactions are stronger quality signals. Platform view definitions are not identical, so compare each platform’s trend and use the combined total as a directional measure—not a laboratory-perfect one.</p></div>';
      var refresh = document.getElementById('contentRefresh');
      if (refresh) refresh.addEventListener('click', function () { renderContentAnalytics(true); });
      panelMain.querySelector('.content-dashboard').addEventListener('click', function (event) {
        var button = event.target.closest('[data-content-range]');
        if (!button) return;
        var range = Number(button.dataset.contentRange);
        if ([7, 30, 90].indexOf(range) === -1) return;
        contentOverallRangeDays = range;
        panelMain.querySelector('.content-overall').outerHTML = contentOverallChart(data, range);
      });
      var detail = document.getElementById('contentPieceDetail');
      panelMain.querySelectorAll('.content-piece-row').forEach(function (button) {
        function select() {
          panelMain.querySelectorAll('.content-piece-row').forEach(function (row) { row.classList.toggle('active', row === button); });
          detail.innerHTML = contentDetailMarkup(data.pieces[Number(button.dataset.pieceIndex)]);
        }
        button.addEventListener('mouseenter', select);
        button.addEventListener('focus', select);
        button.addEventListener('click', select);
      });
      contentAnalyticsTimer = setTimeout(function () { if (currentTabId() === 'content-analytics') renderContentAnalytics(false); }, 5 * 60 * 1000);
    }).catch(function () {
      if (currentTabId() !== 'content-analytics') return;
      panelMain.innerHTML = '<div class="tab-placeholder wide"><div class="eyebrow">Temporarily unavailable</div><h2>Content Analytics</h2><p>The existing publishing data is safe. Reopen this tab to retry the metric connection.</p></div>';
    });
  }

  function renderActiveTab() {
    var active = currentTabId();
    if (active !== 'editor' && window.RMEditor && typeof window.RMEditor.unmount === 'function') window.RMEditor.unmount();
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
        var ids = (btn.dataset.tabs || btn.dataset.tab || '').split(',');
        btn.classList.toggle('active', ids.indexOf(active) !== -1);
      });
    }
    var backFab = document.getElementById('pmBackFab');
    // Editor provides its own in-flow mobile return link so the global fixed
    // bubble cannot cover crop/format/review controls while Harvey scrolls.
    if (backFab) backFab.classList.toggle('show', active !== 'project-manager' && active !== 'editor');
    panelMain.classList.toggle('panel-main--ideation', active === 'content-ideation');
    panelMain.classList.toggle('panel-main--manuscript', active === 'manuscript');
    panelMain.classList.toggle('panel-main--mailbox', active === 'mailbox');
    panelMain.classList.toggle('panel-main--website-analytics', active === 'website-analytics');
    panelMain.classList.toggle('panel-main--sales-analytics', active === 'sales-analytics');
    panelMain.classList.toggle('panel-main--content-analytics', active === 'content-analytics');
    panelMain.classList.toggle('panel-main--pipeline', active === 'content-ops');
    if (active !== 'sales-analytics') { clearTimeout(salesAnalyticsTimer); salesAnalyticsTimer = null; }
    if (active !== 'content-analytics') { clearTimeout(contentAnalyticsTimer); contentAnalyticsTimer = null; }
    if (active !== 'project-manager' && pmSync) { pmSync.stop(); pmSync = null; }
    if (active === 'project-manager') {
      panelMain.innerHTML = PM_MARKUP;
      bootProjectManager();
    } else if (active === 'mailbox') {
      window.RMMailbox.mount(panelMain);
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
    } else if (active === 'editor') {
      window.RMEditor.mount(panelMain);
    } else if (active === 'settings') {
      panelMain.innerHTML = SETTINGS_MARKUP;
      bootSettings();
    } else if (active === 'website-analytics') {
      renderWebsiteAnalytics();
    } else if (active === 'sales-analytics') {
      renderSalesAnalytics();
    } else if (active === 'content-analytics') {
      renderContentAnalytics(false);
    } else if (active === 'outlier-analysis') {
      window.RMCompetitors.mount(panelMain);
    } else if (active === 'idea-research') {
      window.RMResearch.mount(panelMain);
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
    window.RMMailbox.startBadgePolling();
    startEditorUnreadBadgePolling();
    bootModal();
    window.addEventListener('hashchange', renderActiveTab);
    if (!location.hash) location.hash = IS_REVIEWER ? 'content-ops' : TABS[0].id;
    renderActiveTab();
  }

  var editorUnreadTimer = null;
  function refreshEditorUnreadBadge() {
    if (IS_REVIEWER) return Promise.resolve();
    return fetch('/api/desktop-uploader/unread-count', { credentials: 'include' }).then(function (response) {
      if (!response.ok) throw new Error('unavailable');
      return response.json();
    }).then(function (result) {
      var badge = document.getElementById('editorUnreadBadge');
      if (!badge) return;
      var count = Math.max(0, Number(result.count) || 0);
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.hidden = count === 0;
    }).catch(function () {});
  }
  function startEditorUnreadBadgePolling() {
    if (editorUnreadTimer || IS_REVIEWER) return;
    refreshEditorUnreadBadge();
    editorUnreadTimer = setInterval(refreshEditorUnreadBadge, 15000);
  }
  window.__rmRefreshEditorUnreadBadge = refreshEditorUnreadBadge;

  /* ============================================================
     PROJECT MANAGER (chat with Codex) — the default tab. Talks to the same
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
            '<div class="pm-agent-switch" aria-label="Project Manager">' +
              '<span class="pm-agent-option active">Codex</span>' +
              '<button type="button" class="pm-agent-option pm-usage-option" aria-haspopup="dialog">Usage</button>' +
            '</div>' +
            '<button type="button" class="pm-auto-speech-btn" id="pmAutoSpeechBtn" aria-pressed="true" title="Turn automatic voice responses off"><span>Auto voice</span></button>' +
            '<button type="button" class="pm-alert-btn" id="pmAlertBtn" title="Unread mailbox alerts">✉ Alerts <span class="pm-alert-badge" id="pmAlertBadge" hidden></span></button>' +
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
              '<button type="button" class="pm-attach-btn" id="pmAttachBtn" title="Attach images or MP4 videos" aria-label="Attach images or MP4 videos">' +
                '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M21.44 11.05 12.25 20.24a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95L9.83 18.5a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>' +
              '</button>' +
              '<input type="file" accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,.mp4" id="pmImageInput" multiple hidden />' +
              '<button type="button" class="pm-mic-btn" id="pmMicBtn" title="Record voice message" aria-label="Record voice message">' +
                '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/></svg>' +
              '</button>' +
              '<textarea id="pmTextInput" class="pm-textarea" rows="1" maxlength="100000" placeholder="Message Codex… paste long prompts here too"></textarea>' +
              '<button type="button" class="pm-send-btn" id="pmSendBtn" title="Send" aria-label="Send">' +
                '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4Z"/></svg>' +
              '</button>' +
            '</div>' +
            '<div class="pm-hint" id="pmVoiceHint">Voice replies are spoken automatically. Typed replies show as text — tap ▶ to hear one.</div>' +
          '</div>' +
        '</div>' +
        '<div class="pm-col pm-col-activity">' +
          '<div class="pm-queue-section">' +
            '<div class="pm-activity-head">Task List <span class="pm-activity-hint" id="pmQueueHint"></span></div>' +
            '<div class="pm-queue-list" id="pmQueueList"><div class="pm-queue-empty">No tasks right now.</div></div>' +
          '</div>' +
          '<div class="pm-activity-section">' +
            '<div class="pm-activity-head">Activity <span class="pm-activity-hint">— what Codex is doing, live</span></div>' +
            '<div class="pm-activity" id="pmActivity"><div class="pm-runner-status pm-runner-idle">○ Runner idle · waiting for a task</div></div>' +
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
    var imageInput = document.getElementById('pmImageInput');
    var attachBtn = document.getElementById('pmAttachBtn');
    var inputRow = textInput.closest('.pm-input-row');
    var replyPreviewEl = document.getElementById('pmReplyPreview');
    var replyPreviewTextEl = document.getElementById('pmReplyPreviewText');
    var replyPreviewCancelBtn = document.getElementById('pmReplyPreviewCancel');
    var usageButton = document.querySelector('.pm-usage-option');
    var autoSpeechButton = document.getElementById('pmAutoSpeechBtn');
    var voiceHint = document.getElementById('pmVoiceHint');
    var alertButton = document.getElementById('pmAlertBtn');
    var alertBadge = document.getElementById('pmAlertBadge');
    var selectedAgent = 'codex';

    function agentName() { return 'Codex'; }
    if (window.RMUsage) window.RMUsage.attach(usageButton);
    function autoSpeechIcon(enabled) {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6.5 9H3v6h3.5l4.5 4V5Z"/><path d="M15 9.5a4 4 0 0 1 0 5"/>' +
        (enabled ? '<path d="M18 6.5a8 8 0 0 1 0 11"/>' : '<path d="m16 8 5 8M21 8l-5 8"/>') + '</svg>';
    }
    function renderAutoSpeech(enabled) {
      autoSpeechButton.classList.toggle('is-muted', !enabled);
      autoSpeechButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      autoSpeechButton.title = enabled ? 'Turn automatic voice responses off' : 'Turn automatic voice responses on';
      autoSpeechButton.innerHTML = autoSpeechIcon(enabled) + (enabled ? '<span>Auto voice</span>' : '<span>Voice muted</span>');
      voiceHint.textContent = enabled
        ? 'Voice replies are spoken automatically. Typed replies show as text — tap ▶ to hear one.'
        : 'Automatic voice is muted. Tap ▶ on any response whenever you do want to hear it.';
    }
    renderAutoSpeech(Voice.isAutoSpeechEnabled());
    autoSpeechButton.addEventListener('click', function () {
      Voice.setAutoSpeechEnabled(!Voice.isAutoSpeechEnabled());
    });
    if (pmAutoSpeechUnsub) pmAutoSpeechUnsub();
    pmAutoSpeechUnsub = Voice.onAutoSpeechChange(renderAutoSpeech);

    // Tap-to-reply: selecting one of Codex's earlier messages (via the Reply
    // button added in addAssistantMessage below) sets this, shows the
    // preview strip above the compose box, and gets threaded into the next
    // send — both as an optimistic "Re:" quote on Harvey's own bubble and
    // as reply_to_id sent to the backend, which weaves it into the actual
    // prompt Codex sees (server.js) so a short follow-up like "yes do that"
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
      var active = thread.querySelector('.pm-msg-assistant[data-msg-id="' + activeId + '"]');
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
    function addMessage(kind, text, msgId, images, replyToText, insertBeforeEl) {
      clearEmptyNote();
      images = Array.isArray(images) ? images.filter(Boolean) : (images ? [images] : []);
      var el = document.createElement('div');
      el.className = 'pm-msg pm-msg-' + kind;
      if (msgId) el.dataset.msgId = msgId;
      if (!images.length && !replyToText) {
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
      if (images.length) {
        var imageGrid = document.createElement('div');
        imageGrid.className = 'pm-msg-images';
        images.forEach(function (image, index) {
          var isVideo = String(image.mime || image.type || '').toLowerCase() === 'video/mp4' || /\.mp4$/i.test(image.name || '');
          var media = document.createElement(isVideo ? 'video' : 'img');
          media.className = 'pm-msg-image';
          if (isVideo) { media.controls = true; media.preload = 'metadata'; media.playsInline = true; }
          else media.alt = image.name || ('Attached image ' + (index + 1));
          if (image.url) media.src = image.url;
          else if (isVideo) media.src = URL.createObjectURL(image);
          else {
            var reader = new FileReader();
            reader.onload = function () { media.src = reader.result; };
            reader.readAsDataURL(image);
          }
          imageGrid.appendChild(media);
        });
        el.appendChild(imageGrid);
      }
      if (text) {
        var textEl = document.createElement('div');
        if (images.length) textEl.className = 'pm-msg-caption';
        textEl.textContent = text;
        el.appendChild(textEl);
      }
      insertMessageEl(el, insertBeforeEl);
      return el;
    }

    function updateAlertCount(count) {
      count = Number(count) || 0;
      alertBadge.textContent = count > 99 ? '99+' : String(count);
      alertBadge.hidden = count < 1;
      alertButton.setAttribute('aria-label', count ? count + ' unread mailbox alert' + (count === 1 ? '' : 's') : 'No unread mailbox alerts');
      Voice.setAppBadge(count);
    }
    function refreshAlertCount() {
      return Voice.getNotificationStatus().then(function (data) { updateAlertCount(data.unread); return data; }).catch(function () {});
    }
    function syncVisibleMailAlerts(rows) {
      var active = {};
      rows.forEach(function (row) {
        if (row.notification_kind === 'mail_alert') active[row.id] = true;
      });
      thread.querySelectorAll('.pm-msg-assistant--mail-alert[data-msg-id]').forEach(function (el) {
        if (!active[el.dataset.msgId]) el.remove();
      });
    }
    alertButton.addEventListener('click', function () {
      var unread = thread.querySelector('.pm-msg-assistant--mail-alert.pm-msg-notification-unread');
      if (unread) unread.scrollIntoView({ behavior: 'smooth', block: 'center' });
      Voice.markNotificationsRead([]).then(function () {
        thread.querySelectorAll('.pm-msg-notification-unread').forEach(function (el) { el.classList.remove('pm-msg-notification-unread'); });
        updateAlertCount(0);
      }).catch(function () {});
    });

    function addAssistantMessage(text, replyToText, msgId, insertBeforeEl, agent, notificationKind, notificationUnread, replyAttachments) {
      clearEmptyNote();
      agent = 'codex';
      replyAttachments = Array.isArray(replyAttachments) ? replyAttachments.filter(Boolean) : [];
      var isMailAlert = notificationKind === 'mail_alert';
      var isAction = /^\[NEEDS_ACTION\]/i.test(text || '');
      var wrap = document.createElement('div');
      wrap.className = 'pm-msg pm-msg-assistant ' + (isMailAlert ? 'pm-msg-assistant--mail-alert' : 'pm-msg-assistant--' + agent) +
        (isAction && !isMailAlert ? ' pm-msg-assistant--action' : '') + (isMailAlert && notificationUnread ? ' pm-msg-notification-unread' : '');
      if (msgId) wrap.dataset.msgId = msgId;
      var agentLabel = document.createElement('div');
      agentLabel.className = 'pm-msg-agent-label';
      agentLabel.textContent = isMailAlert ? 'Mailbox alert' : agentName(agent) + ':';
      wrap.appendChild(agentLabel);
      if (replyToText && !isMailAlert) {
        var replyTo = document.createElement('div');
        replyTo.className = 'pm-msg-replyto';
        replyTo.textContent = replyToSnippet(replyToText);
        wrap.appendChild(replyTo);
      }
      if (replyAttachments.length) {
        var imageGrid = document.createElement('div');
        imageGrid.className = 'pm-msg-images pm-msg-images--assistant';
        replyAttachments.forEach(function (image, index) {
          var link = document.createElement('a');
          link.className = 'pm-msg-image-link';
          link.href = image.url;
          link.target = '_blank';
          link.rel = 'noopener';
          link.title = 'Open full-size image';
          var media = document.createElement('img');
          media.className = 'pm-msg-image';
          media.alt = image.name || ('Generated image ' + (index + 1));
          media.loading = 'lazy';
          media.src = image.url;
          link.appendChild(media);
          imageGrid.appendChild(link);
        });
        wrap.appendChild(imageGrid);
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
        Voice.speak(text, msgId, agent, 'reply', { manual: true }).then(function (audio) {
          if (!audio && Voice.currentlySpeaking() !== msgId) playBtn.textContent = '▶ Play';
        }).catch(function (error) {
          playBtn.textContent = error && error.code === 'openai_tts_not_configured'
            ? 'OpenAI key needed'
            : (error && error.code === 'tts_timeout' ? '↻ Try again' : 'Audio unavailable');
          playBtn.title = error && error.message ? error.message : 'Could not play this response.';
          playBtn.classList.add('pm-play-btn-error');
        });
      });
      meta.appendChild(playBtn);
      if (isMailAlert) {
        var mailboxBtn = document.createElement('button');
        mailboxBtn.type = 'button';
        mailboxBtn.className = 'pm-reply-btn';
        mailboxBtn.textContent = 'Open Mailbox';
        mailboxBtn.addEventListener('click', function () { window.location.hash = 'mailbox'; });
        meta.appendChild(mailboxBtn);
        wrap.addEventListener('click', function () {
          if (!wrap.classList.contains('pm-msg-notification-unread')) return;
          Voice.markNotificationsRead([msgId]).then(function (data) {
            wrap.classList.remove('pm-msg-notification-unread');
            updateAlertCount(data.unread);
          }).catch(function () {});
        });
      }
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

    // --- Image/MP4 attach: picker, paste, and drop all append to the same
    // eight-file tray. Each preview can be removed independently.
    var pendingImages = [];
    var pendingPreviewUrls = [];
    function clearPendingPreviewUrls() {
      pendingPreviewUrls.forEach(function (url) { URL.revokeObjectURL(url); });
      pendingPreviewUrls = [];
    }
    function clearPendingImages() {
      clearPendingPreviewUrls();
      pendingImages = [];
      imagePreviewEl.hidden = true;
      imagePreviewEl.innerHTML = '';
      imageInput.value = '';
    }
    function renderPendingImages() {
      clearPendingPreviewUrls();
      imagePreviewEl.innerHTML = '';
      pendingImages.forEach(function (file, index) {
        var item = document.createElement('div');
        item.className = 'pm-image-preview-item';
        var isVideo = file.type === 'video/mp4' || /\.mp4$/i.test(file.name || '');
        var media = document.createElement(isVideo ? 'video' : 'img');
        media.title = file.name || (isVideo ? 'MP4 video' : 'Image ' + (index + 1));
        if (isVideo) {
          media.muted = true; media.playsInline = true; media.preload = 'metadata';
          media.src = URL.createObjectURL(file); pendingPreviewUrls.push(media.src);
        }
        else {
          media.alt = media.title;
          var reader = new FileReader();
          reader.onload = function () { media.src = reader.result; };
          reader.readAsDataURL(file);
        }
        item.appendChild(media);
        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'pm-image-preview-remove';
        removeBtn.textContent = '×';
        removeBtn.setAttribute('aria-label', 'Remove ' + media.title);
        removeBtn.addEventListener('click', function () {
          pendingImages.splice(index, 1);
          renderPendingImages();
        });
        item.appendChild(removeBtn);
        imagePreviewEl.appendChild(item);
      });
      imagePreviewEl.hidden = !pendingImages.length;
    }
    function addPendingImages(files) {
      Array.prototype.slice.call(files || []).forEach(function (file) {
        var allowed = (file.type && file.type.indexOf('image/') === 0) || file.type === 'video/mp4' || /\.mp4$/i.test(file.name || '');
        if (pendingImages.length < 8 && allowed) pendingImages.push(file);
      });
      renderPendingImages();
    }
    attachBtn.addEventListener('click', function () { imageInput.click(); });
    imageInput.addEventListener('change', function () { addPendingImages(imageInput.files); imageInput.value = ''; });
    textInput.addEventListener('paste', function (e) {
      var items = (e.clipboardData && e.clipboardData.items) || [];
      var pasted = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image/') === 0) {
          var file = items[i].getAsFile();
          if (file) pasted.push(file);
        }
      }
      if (pasted.length) { addPendingImages(pasted); e.preventDefault(); }
    });
    if (inputRow) {
      inputRow.addEventListener('dragover', function (e) { e.preventDefault(); inputRow.classList.add('pm-drag-over'); });
      inputRow.addEventListener('dragleave', function () { inputRow.classList.remove('pm-drag-over'); });
      inputRow.addEventListener('drop', function (e) {
        e.preventDefault();
        inputRow.classList.remove('pm-drag-over');
        var files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length) addPendingImages(files);
      });
    }

    // --- Queue panel: every poll gets the full current window of rows
    // (see lib/voiceClient.js syncThread's onTick), so this just re-derives
    // the in-flight + recently-completed lists from scratch each tick
    // rather than diffing. Completed items are shown too (not just
    // pending/running) so Harvey has a short trail of what Codex just
    // finished, capped at RECENT_DONE_LIMIT and visually distinct from
    // what's actively running — older completions just fall off the
    // bottom rather than piling up.
    var RECENT_DONE_LIMIT = 5;
    function requestMessageCancel(messageId, button) {
      if (button && button.dataset.cancelling === '1') return;
      if (button) { button.dataset.cancelling = '1'; button.disabled = true; button.textContent = 'Stopping…'; }
      function stopWhenPersisted(attemptsLeft) {
        var owner = button && button.closest('[data-msg-id]');
        var id = messageId || (owner && owner.dataset.msgId);
        if (!id && attemptsLeft > 0) return setTimeout(function () { stopWhenPersisted(attemptsLeft - 1); }, 100);
        var request = id ? Voice.cancelMessage(id) : Promise.reject(new Error('That message has not finished sending yet.'));
        request.catch(function (error) {
          if (button) { delete button.dataset.cancelling; button.disabled = false; button.textContent = 'Never mind'; }
          addMessage('error', (error && error.message) || 'Could not stop that task.');
        });
      }
      stopWhenPersisted(50);
    }

    function makeCancelButton(messageId) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'pm-cancel-btn';
      button.textContent = 'Never mind';
      button.addEventListener('click', function () { requestMessageCancel(messageId, button); });
      return button;
    }

    function renderQueue(rows) {
      rows = rows.filter(function (r) { return r.notification_kind !== 'mail_alert'; });
      var inflight = rows.filter(function (r) { return r.status === 'pending' || r.status === 'running'; }).slice().reverse();
      var recentDone = rows.filter(function (r) { return r.status === 'done' || r.status === 'error' || r.status === 'cancelled'; })
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
        item.dataset.msgId = row.id;
        item.appendChild(makeCancelButton(row.id));
        queueListEl.appendChild(item);
      });
      if (recentDone.length) {
        var divider = document.createElement('div');
        divider.className = 'pm-queue-divider';
        divider.textContent = 'Recently completed';
        queueListEl.appendChild(divider);
        recentDone.forEach(function (row) {
          var item = document.createElement('div');
          item.className = 'pm-queue-item ' + (row.status === 'error' ? 'pm-queue-failed' : row.status === 'cancelled' ? 'pm-queue-cancelled' : 'pm-queue-done');
          var mark = document.createElement('span');
          mark.className = 'pm-queue-num';
          mark.textContent = row.status === 'done' ? '✓' : '✕';
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
      agent = 'codex';
      el.className = 'pm-typing pm-typing--' + agent;
      if (msgId) el.dataset.msgId = msgId;
      var copy = document.createElement('span');
      copy.className = 'pm-typing-copy';
      copy.textContent = agentName(agent) + ' is working on it…';
      el.appendChild(copy);
      el.appendChild(makeCancelButton(msgId));
      thread.appendChild(el);
      thread.scrollTop = thread.scrollHeight;
      return el;
    }

    // Right-hand "code-like" pane — the raw tool-call/thinking trail, kept
    // deliberately separate from the clean thread on the left per Harvey:
    // this is the stuff he'll mostly ignore, not the stuff he reads.
    function activityAge(timestamp) {
      var milliseconds = timestamp ? Date.now() - new Date(timestamp).getTime() : NaN;
      if (!Number.isFinite(milliseconds) || milliseconds < 0) return 'just now';
      var seconds = Math.floor(milliseconds / 1000);
      if (seconds < 10) return 'just now';
      if (seconds < 60) return seconds + 's ago';
      var minutes = Math.floor(seconds / 60);
      if (minutes < 60) return minutes + 'm ago';
      return Math.floor(minutes / 60) + 'h ago';
    }

    function elapsedSince(timestamp) {
      var milliseconds = timestamp ? Date.now() - new Date(timestamp).getTime() : NaN;
      if (!Number.isFinite(milliseconds) || milliseconds < 0) return 'starting';
      var seconds = Math.floor(milliseconds / 1000);
      if (seconds < 60) return seconds + 's elapsed';
      var minutes = Math.floor(seconds / 60);
      return minutes + 'm ' + (seconds % 60) + 's elapsed';
    }

    function renderActivity(rows, submitting) {
      rows = Array.isArray(rows) ? rows : [];
      var running = rows.find(function (row) { return row.status === 'running'; });
      var pending = rows.filter(function (row) { return row.status === 'pending'; });
      activityEl.innerHTML = '';

      var status = document.createElement('div');
      status.className = 'pm-runner-status';
      if (running) {
        var heartbeatTime = new Date(running.runner_heartbeat_at || 0).getTime();
        var heartbeatLate = !heartbeatTime || Date.now() - heartbeatTime > 35000;
        status.classList.add(heartbeatLate ? 'pm-runner-stale' : 'pm-runner-active');
        status.textContent = heartbeatLate
          ? '⚠ Runner heartbeat late · last signal ' + activityAge(running.runner_heartbeat_at || running.activity_updated_at || running.runner_started_at)
          : '● Runner active · ' + elapsedSince(running.runner_started_at || running.created_at) +
            ' · heartbeat ' + activityAge(running.runner_heartbeat_at) +
            ' · Codex event ' + activityAge(running.activity_updated_at || running.runner_started_at);
      } else if (pending.length || submitting) {
        status.classList.add('pm-runner-starting');
        status.textContent = '◌ Runner starting' + (pending.length ? ' · ' + pending.length + ' task' + (pending.length === 1 ? '' : 's') + ' queued' : ' · submitting task');
      } else {
        status.classList.add('pm-runner-idle');
        status.textContent = '○ Runner idle · waiting for a task';
      }
      activityEl.appendChild(status);

      if (running && pending.length) {
        var queueStatus = document.createElement('div');
        queueStatus.className = 'pm-runner-queue';
        queueStatus.textContent = 'Queue · ' + pending.length + ' more task' + (pending.length === 1 ? '' : 's') + ' waiting';
        activityEl.appendChild(queueStatus);
      }

      var lines = running && Array.isArray(running.activity_log) ? running.activity_log : [];
      lines.forEach(function (line) {
        var el = document.createElement('div');
        el.className = 'pm-activity-line';
        el.textContent = line;
        activityEl.appendChild(el);
      });
      if (running && !lines.length) {
        var waiting = document.createElement('div');
        waiting.className = 'pm-activity-empty';
        waiting.textContent = 'Waiting for the first runner event…';
        activityEl.appendChild(waiting);
      }
      activityEl.scrollTop = activityEl.scrollHeight;
    }

    // Ids this device sent via voice on itself and therefore wants its
    // contextual early acknowledgment spoken while work is still underway.
    // Final replies use the global Auto voice preference regardless of which
    // input mode/device created them; see onDone below.
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
    var lastAlertRefresh = 0;

    pmSync = Voice.syncThread({
      onNewMessage: function (row) { if (row.notification_kind !== 'mail_alert') addMessage('user', row.transcript, row.id, row.attachments, row.reply_to_snippet); },
      onPending: function (row) { if (row.notification_kind !== 'mail_alert') addTyping(row.id, row.agent); },
      onEarlyAck: function (row) {
        // Swap the generic "Codex is working on it…" placeholder for Codex's own
        // real, contextual first line the moment it's available — visible
        // even for a typed/no-speech send, not just spoken.
        var typingEl = thread.querySelector('.pm-typing[data-msg-id="' + row.id + '"]');
        if (typingEl) typingEl.querySelector('.pm-typing-copy').textContent = row.early_ack;
        if (!voiceAutoSpeak[row.id] || !Voice.isAutoSpeechEnabled()) return;
        Voice.speak(row.early_ack, row.id, row.agent, 'early_ack').catch(function () {});
      },
      onDone: function (row) {
        // Look the placeholder up (rather than just removeTyping()) so its
        // position can be handed to addAssistantMessage as an insertion
        // anchor — see insertMessageEl's comment for why: this message may
        // not be the most recently-sent one anymore if Harvey started
        // another before this reply landed.
        var typingEl = thread.querySelector('.pm-typing[data-msg-id="' + row.id + '"]');
        var replyText = row.reply_text || '';
        var newlyArrived = pastFirstTick;
        var shouldAutoplay = newlyArrived && Voice.isAutoSpeechEnabled() && Voice.isActiveHere() &&
          row.notification_kind !== 'mail_alert';
        delete voiceAutoSpeak[row.id];

        function revealReply() {
          // Execute-mode replies are real completion summaries now (see
          // server.js buildVoicePrompt), not throwaway placeholders.
          addAssistantMessage(replyText, row.transcript, row.id, typingEl, row.agent,
            row.notification_kind, !!row.notification_unread, row.replyAttachments);
          if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
          if (shouldAutoplay) {
            // prepareSpeech has already placed the first MP3 part in memory,
            // so this starts from the same event turn as the bubble reveal.
            Voice.speak(replyText, row.id, row.agent).catch(function () {});
          } else if (newlyArrived && Voice.isActiveHere()) {
            Voice.playPing();
          }
        }

        if (newlyArrived && row.notification_kind !== 'mail_alert' && replyText) {
          if (typingEl) typingEl.querySelector('.pm-typing-copy').textContent = agentName(row.agent) + ' is preparing voice playback…';
          // Do not expose a Play button that still has to synthesize audio.
          // If the provider is unavailable, fail open after the bounded TTS
          // request and reveal the readable answer rather than hiding it.
          Voice.prepareSpeech(replyText, row.id, row.agent, 'reply')
            .catch(function () { return null; })
            .then(revealReply);
        } else {
          revealReply();
        }
      },
      onError: function (row) {
        var typingEl = thread.querySelector('.pm-typing[data-msg-id="' + row.id + '"]');
        addMessage('error', row.error_message || 'Something went wrong.', row.id, null, row.transcript, typingEl);
        if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
        if (pastFirstTick && Voice.isActiveHere()) Voice.playPing();
        if (voiceAutoSpeak[row.id]) {
          delete voiceAutoSpeak[row.id];
        }
      },
      onCancelled: function (row) {
        var typingEl = thread.querySelector('.pm-typing[data-msg-id="' + row.id + '"]');
        if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
        delete voiceAutoSpeak[row.id];
      },
      onUpdate: function (row) {
        var existing = thread.querySelector('.pm-msg-assistant[data-msg-id="' + row.id + '"]');
        if (!existing) return;
        addAssistantMessage(row.reply_text || '', row.notification_kind === 'mail_alert' ? null : row.transcript,
          row.id, existing, row.agent, row.notification_kind, !!row.notification_unread, row.replyAttachments);
        if (existing) existing.remove();
        if (row.notification_kind === 'mail_alert') {
          if (pastFirstTick && row.notification_unread && Voice.isActiveHere()) Voice.playPing();
          refreshAlertCount();
        }
      },
      onActivity: function () {},
      onTick: function (rows) {
        var inflight = rows.filter(function (row) { return row.status === 'pending' || row.status === 'running'; })
          .slice().sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); });
        inflight.forEach(function (row, index) {
          var typingEl = thread.querySelector('.pm-typing[data-msg-id="' + row.id + '"]');
          if (!typingEl) return;
          var copy = typingEl.querySelector('.pm-typing-copy');
          if (!copy) return;
          if (row.status === 'pending') {
            var ahead = inflight.slice(0, index).filter(function (item) { return item.status === 'running' || item.status === 'pending'; }).length;
            copy.textContent = 'Queued' + (ahead ? ' · ' + ahead + ' task' + (ahead === 1 ? '' : 's') + ' ahead' : ' · starting next');
          } else {
            copy.textContent = row.early_ack || (agentName(row.agent) + ' is actively working on this…');
          }
        });
        syncVisibleMailAlerts(rows);
        renderQueue(rows);
        renderActivity(rows);
        pastFirstTick = true;
        if (Date.now() - lastAlertRefresh > 10000) { lastAlertRefresh = Date.now(); refreshAlertCount(); }
      }
    });

    function sendText(text, mode, opts) {
      opts = opts || {};
      var autoSpeak = !!opts.autoSpeak;
      var images = opts.images || [];
      if (!text.trim() && !images.length) return;
      var replyTo = pendingReplyTo;
      clearPendingReplyTo();
      var userMessageEl = addMessage('user', text.trim(), null, images, replyTo ? replyTo.snippet : null);
      var agent = selectedAgent;
      var typingEl = addTyping(null, agent);
      renderActivity([], true);
      Voice.sendMessage(text.trim(), mode, images, replyTo ? replyTo.id : null, agent).then(function (created) {
        typingEl.dataset.msgId = created.id;
        userMessageEl.dataset.msgId = created.id;
        var persistedAttachments = Array.isArray(created.attachments) ? created.attachments : [];
        userMessageEl.querySelectorAll('.pm-msg-image').forEach(function (media, index) {
          if (!persistedAttachments[index] || !persistedAttachments[index].url) return;
          var previous = media.src;
          media.src = persistedAttachments[index].url;
          if (previous && previous.indexOf('blob:') === 0) URL.revokeObjectURL(previous);
        });
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
      var images = pendingImages.slice();
      textInput.value = '';
      textInput.style.height = 'auto';
      var carryVoice = lastSendWasVoice;
      lastSendWasVoice = false;
      clearPendingImages();
      sendText(text, 'respond', { autoSpeak: carryVoice, images: images });
    });
    // Desktop keeps the familiar chat behavior: Enter sends, while
    // Shift+Enter inserts a deliberate newline. The dedicated mobile view is
    // button-only because its on-screen keyboard made accidental sends easy.
    textInput.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      sendBtn.click();
    });
    function autoresize() {
      textInput.style.height = 'auto';
      var longPromptHeight = Math.max(160, Math.min(520, Math.round(window.innerHeight * 0.55)));
      textInput.style.height = Math.min(textInput.scrollHeight, longPromptHeight) + 'px';
      textInput.classList.toggle('long-prompt', textInput.scrollHeight > 160);
    }
    textInput.addEventListener('input', autoresize);

    // Recording state: exactly one obvious action while recording — click
    // the (now pulsing) mic again to finish. Hiding Send removes the
    // "mic again or Send?" ambiguity Harvey flagged; showing it again the
    // moment recording stops means there's still a way to fix a stray word
    // before it goes out.
    function setRecordingUI(state) {
      if (state === true) state = 'recording';
      if (!state) state = 'idle';
      var isStarting = state === 'starting';
      var isRecording = state === 'recording';
      var isActive = isStarting || isRecording;
      micBtn.classList.toggle('starting', isStarting);
      micBtn.classList.toggle('recording', isRecording);
      micBtn.title = isStarting ? 'Starting microphone…' : (isRecording ? 'Stop recording and send' : 'Record voice message');
      micBtn.setAttribute('aria-label', micBtn.title);
      sendBtn.hidden = isActive;
      // Don't talk over Harvey while he's dictating a new message — both
      // recording paths below (live recognition and record-and-upload)
      // funnel through this one function on every start/stop, so this is
      // the single place to gate it.
      Voice.setRecordingActive(isActive);
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
      var readyTimer = null;
      function clearReadyTimer() {
        if (readyTimer) clearTimeout(readyTimer);
        readyTimer = null;
      }
      function scheduleReadyCue(delay) {
        if (readyTimer) return;
        readyTimer = setTimeout(function () {
          readyTimer = null;
          if (activeRecognition === recognition) setRecordingUI('recording');
        }, delay);
      }
      // `audiostart` is the trustworthy boundary: recognition is already
      // receiving microphone audio. `start` supplies a conservative fallback
      // for browsers that omit audiostart, still with a healthy pre-roll.
      recognition.addEventListener('audiostart', function () { scheduleReadyCue(350); });
      recognition.addEventListener('start', function () { scheduleReadyCue(650); });
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
        clearReadyTimer();
        activeRecognition = null;
        setRecordingUI(false);
        var text = textInput.value;
        textInput.value = '';
        textInput.style.height = 'auto';
        if (text.trim()) { lastSendWasVoice = true; sendText(text, 'respond', { autoSpeak: true }); }
      });
      recognition.addEventListener('error', function (e) {
        clearReadyTimer();
        activeRecognition = null;
        setRecordingUI(false);
        if (e.error !== 'aborted' && e.error !== 'no-speech') {
          addMessage('error', 'Voice recognition error: ' + e.error);
        }
      });
      activeRecognition = recognition;
      setRecordingUI('starting');
      try { recognition.start(); }
      catch (error) {
        clearReadyTimer();
        activeRecognition = null;
        setRecordingUI(false);
        addMessage('error', 'Could not start the microphone.');
      }
    }

    // Fallback for browsers without live recognition (e.g. Firefox): the
    // original record-then-upload-then-transcribe flow, no live preview.
    function startRecordAndUpload() {
      setRecordingUI('starting');
      Voice.startRecording().then(function (rec) {
        activeRecorder = rec;
        setRecordingUI('recording');
      }).catch(function () {
        setRecordingUI(false);
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
      if (!confirm('Start a new conversation? Codex will lose context from this one.')) return;
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
  var PIECE_DRAFTS_KEY = 'rm-content-piece-drafts-v1';

  function readPieceDrafts() {
    try { return JSON.parse(localStorage.getItem(PIECE_DRAFTS_KEY) || '{}') || {}; }
    catch (error) { return {}; }
  }

  function writePieceDrafts(drafts) {
    try { localStorage.setItem(PIECE_DRAFTS_KEY, JSON.stringify(drafts)); return true; }
    catch (error) { return false; }
  }

  function storePieceDraftSnapshot(piece) {
    if (!piece || !piece.id) return '';
    var drafts = readPieceDrafts();
    var revision = Date.now() + '-' + Math.random().toString(36).slice(2);
    drafts[piece.id] = { revision: revision, piece: Object.assign({}, piece) };
    return writePieceDrafts(drafts) ? revision : '';
  }

  function clearPieceDraftSnapshot(id, revision) {
    var drafts = readPieceDrafts();
    if (!drafts[id] || (revision && drafts[id].revision !== revision)) return;
    delete drafts[id];
    writePieceDrafts(drafts);
  }

  // Network autosave is deliberately debounced, but a reload can happen
  // inside that delay. Recover the synchronous local snapshot first, then
  // immediately persist it through the normal version-checked API. A draft
  // is only cleared when the exact revision that was sent is acknowledged.
  function recoverPieceDrafts(rows) {
    var drafts = readPieceDrafts();
    var jobs = [];
    Object.keys(drafts).forEach(function (id) {
      var draft = drafts[id];
      if (!draft || !draft.piece || !draft.piece.id) return;
      var existing = pieces[id];
      var draftTime = Date.parse(draft.piece.updatedAt || 0);
      var serverTime = Date.parse(existing && existing.updatedAt || 0);
      if (existing && (!Number.isFinite(draftTime) || draftTime <= serverTime)) {
        clearPieceDraftSnapshot(id, draft.revision);
        return;
      }
      var recovered = Object.assign({}, existing || {}, draft.piece);
      pieces[id] = recovered;
      if (!existing) rows.push(recovered);
      jobs.push(Store.put('pieces', recovered).then(function () {
        clearPieceDraftSnapshot(id, draft.revision);
      }).catch(function () {
        // Retain the local recovery copy. A later reload can retry it and,
        // crucially, the user's words are never silently discarded.
      }));
    });
    return Promise.allSettled(jobs);
  }

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
  // back to In Production and picks up the "thumbnail selected" tag that
  // replaces it, so nothing gets silently stranded on a stage id that no
  // longer exists in Store.STAGES.
  function migrateThumbnailStage(rows) {
    var stragglers = rows.filter(function (r) { return r.stage === 'thumbnail'; });
    stragglers.forEach(function (r) {
      r.stage = 'in_production';
      syncTags(r);
      r.updatedAt = nowIso();
      Store.put('pieces', r);
    });
  }

  // A piece could only reach Final Check under the *old* flow by having
  // its stage set directly (no separate audio-spliced video ever built —
  // that pipeline didn't exist yet). Its Final Check card would now try
  // to play a "<id>-final" file that was never created. Sending it back
  // to In Production means it goes through the real build the next time
  // Harvey hits "Send to final check," same as any new upload — rather
  // than leaving a stale entry with a broken/missing video preview.
  function migrateUnbuiltFinalChecks(rows) {
    var stragglers = rows.filter(function (r) { return r.stage === 'final_check' && r.finalBuildStatus !== 'done'; });
    stragglers.forEach(function (r) {
      r.stage = 'in_production';
      r.updatedAt = nowIso();
      Store.put('pieces', r);
    });
  }

  function ensurePiecesLoaded() {
    if (!piecesLoadedPromise) {
      piecesLoadedPromise = Store.getAll('pieces').then(function (rows) {
        rows.forEach(function (r) { pieces[r.id] = r; });
        return recoverPieceDrafts(rows).then(function () {
          backfillMissingSeqs(rows);
          migrateThumbnailStage(rows);
          migrateUnbuiltFinalChecks(rows);
          return maybeSeedExamples();
        });
      });
    }
    return piecesLoadedPromise;
  }

  // Editor advances its existing video card to In Production server-side. Inject the fresh
  // record into this SPA's shared cache before navigating so Content
  // Production shows it immediately rather than waiting for a page reload.
  window.__rmOpenContentProduction = function (pieceId, freshPiece) {
    function open(piece) {
      if (piece && piece.id) pieces[piece.id] = piece;
      location.hash = 'upload-files';
    }
    if (freshPiece && freshPiece.id) { open(freshPiece); return Promise.resolve(freshPiece); }
    return Store.get('pieces', pieceId).then(function (piece) { open(piece); return piece; });
  };

  // Editor handoff happens server-side, outside this SPA cache. Register both
  // records from the authoritative response immediately so the new In Production
  // item and the linked planning card's Uploaded move appear without a reload.
  window.__rmRegisterEditorHandoff = function (result) {
    result = result || {};
    if (result.piece && result.piece.id) pieces[result.piece.id] = result.piece;
    if (result.planningPiece && result.planningPiece.id) pieces[result.planningPiece.id] = result.planningPiece;
    notifyPiecesChanged();
  };

  window.__rmRegisterEditorVideoCard = function (piece) {
    if (!piece || !piece.id) return;
    pieces[piece.id] = piece;
    notifyPiecesChanged();
  };

  function orderedIds(stageId) {
    return Object.keys(pieces)
      .filter(function (id) { return pieces[id].stage === stageId; })
      .sort(function (a, b) {
        if (stageId === 'publishing_queue') {
          var aLong = pieces[a].contentType === 'longform' ? 0 : 1;
          var bLong = pieces[b].contentType === 'longform' ? 0 : 1;
          if (aLong !== bLong) return aLong - bLong;
        }
        return (pieces[a].order || 0) - (pieces[b].order || 0);
      });
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
  // a video piece's *stage* is now fully explicit (In Production -> Final Check
  // -> Publishing Queue -> Scheduled -> Live, moved by explicit review and
  // the cadence-aware queue scheduler), but these three tags still
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

  function nextBangkokShortSlot(afterMs) {
    var offset = 7 * 60 * 60 * 1000;
    var local = new Date(afterMs + offset);
    var localMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    var candidates = [localMidnight + 12 * 3600000 - offset, localMidnight + 24 * 3600000 - offset];
    return candidates.filter(function (candidate) { return candidate > afterMs; })[0] || (localMidnight + 36 * 3600000 - offset);
  }

  function nextBangkokLongformSlot(afterMs, selectedTime, latestMs) {
    var offset = 7 * 60 * 60 * 1000;
    var match = String(selectedTime || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    var hour = match ? Number(match[1]) : 7;
    var minute = match ? Number(match[2]) : 55;
    var anchor = new Date((latestMs || afterMs) + offset);
    var localDay = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate());
    if (latestMs) localDay += 3 * 86400000;
    var candidate = localDay + hour * 3600000 + minute * 60000 - offset;
    if (!latestMs && candidate <= afterMs) candidate += 86400000;
    while (candidate <= afterMs) candidate += 3 * 86400000;
    return candidate;
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
      tail = nextBangkokShortSlot(tail);
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
      var latest = null;
      Object.keys(pieces).forEach(function (id) {
        var o = pieces[id];
        if (o.id !== p.id && o.contentType === 'longform' && o.scheduledAt && (o.stage === 'scheduled' || o.stage === 'live')) {
          var t = new Date(o.scheduledAt).getTime();
          if (!latest || t > latest) latest = t;
        }
      });
      p.scheduledAt = new Date(nextBangkokLongformSlot(Date.now(), settings.longformScheduleTime, latest)).toISOString();
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
        stage: 'uploaded', platforms: ['ytshort', 'tiktok'], contentType: 'ultra_short',
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
      kanbanDictateBtn, kanbanDictationStatus,
      teleprompterOpen, teleprompterView, teleprompterTitle,
      teleprompterScroll, teleprompterScript, teleprompterClose;

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
    teleprompterOpen = document.getElementById('teleprompterOpen');
    teleprompterView = document.getElementById('teleprompterView');
    teleprompterTitle = document.getElementById('teleprompterTitle');
    teleprompterScroll = document.getElementById('teleprompterScroll');
    teleprompterScript = document.getElementById('teleprompterScript');
    teleprompterClose = document.getElementById('teleprompterClose');

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
      el.addEventListener('input', captureDraftAndDebounceSync);
      el.addEventListener('blur', function () { clearTimeout(saveTimer); syncFromForm(); });
    });
    fieldNotes.addEventListener('input', captureDraftAndDebounceSync);
    fieldNotes.addEventListener('blur', function () { clearTimeout(saveTimer); syncFromForm(); });
    fieldTitle.addEventListener('focus', function () { setKanbanDictationTarget(fieldTitle); });
    fieldNotes.addEventListener('focus', function () { setKanbanDictationTarget(fieldNotes); });
    kanbanDictateBtn.addEventListener('pointerdown', function (event) { event.preventDefault(); });
    kanbanDictateBtn.addEventListener('click', startKanbanDictation);
    teleprompterOpen.addEventListener('click', openTeleprompter);
    teleprompterClose.addEventListener('click', closeTeleprompter);
    setKanbanDictationTarget(fieldNotes);
    fieldTranscript.addEventListener('input', captureDraftAndDebounceSync);
    fieldTranscript.addEventListener('blur', function () { clearTimeout(saveTimer); syncFromForm(); });
    [fieldYtTitle1, fieldYtTitle2, fieldYtTitle3].forEach(function (el) {
      el.addEventListener('input', captureDraftAndDebounceSync);
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
        clearPieceDraftSnapshot(activeId);
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
        clearPieceDraftSnapshot(id);
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
      if (e.key !== 'Escape') return;
      if (!teleprompterView.hidden) closeTeleprompter();
      else if (modalWrap.classList.contains('open')) closeModal();
    });
  }

  function openTeleprompter() {
    if (!activeId || !pieces[activeId] || pieces[activeId].hasVideo) return;
    teleprompterTitle.textContent = fieldTitle.value.trim() || 'Untitled piece';
    teleprompterScript.innerHTML = fieldNotes.innerHTML;
    teleprompterView.hidden = false;
    teleprompterView.setAttribute('aria-hidden', 'false');
    teleprompterScroll.scrollTop = 0;
    requestAnimationFrame(function () { teleprompterScroll.focus(); });
  }

  function closeTeleprompter() {
    if (!teleprompterView || teleprompterView.hidden) return;
    teleprompterView.hidden = true;
    teleprompterView.setAttribute('aria-hidden', 'true');
    teleprompterScript.innerHTML = '';
    if (teleprompterOpen && !teleprompterOpen.hidden) teleprompterOpen.focus();
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

  function buildUtmLink(p, settings, platform) {
    var base = (settings.baseLinkUrl || 'https://realitymanual.com').trim() || 'https://realitymanual.com';
    // Caption rendering passes the exact destination platform so a piece
    // tagged for both Facebook and YouTube never gives Facebook a
    // utm_source=youtube URL. The fallback preserves the modal's generic
    // one-link preview when no caption tab is selected there.
    var sourceByPlatform = { facebook: 'facebook', instagram: 'instagram', tiktok: 'tiktok', ytshort: 'youtube', ytlong: 'youtube' };
    var source = sourceByPlatform[platform] || ((p.platforms || []).indexOf('facebook') !== -1 && (p.platforms || []).indexOf('ytlong') === -1 ? 'facebook' : 'youtube');
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
        var text = Store.renderPlatformCaption(template, o.key, buildUtmLink(p, settings, o.key));
        var hasText = !!text.trim();
        return {
          key: o.key,
          label: o.label,
          template: template,
          empty: !hasText,
          text: hasText ? text : ''
        };
      });
  }

  function renderCaptionText(p, settings) {
    var entry = captionsForPiece(settings, p).filter(function (e) { return !e.empty; })[0];
    if (!entry) return 'No caption set for this type yet — add one in Settings.';
    return entry.text;
  }

  function updateStageAndScheduleUI(p) {
    stageReadout.textContent = stageLabelOf(p.stage);
    if (p.stage === 'scheduled' && p.scheduledAt) {
      scheduleStatus.textContent = 'Scheduled for ' + fmtFull(p.scheduledAt);
    } else if (p.stage === 'publishing_queue') {
      scheduleStatus.textContent = 'Approved and waiting in Publishing Queue.';
    } else if (p.stage === 'live') {
      scheduleStatus.textContent = p.scheduledAt ? ('Posted ' + fmtFull(p.scheduledAt)) : 'Posted — connect an API in Settings to confirm.';
    } else if (p.stage === 'final_check') {
      scheduleStatus.textContent = 'In Final Check — review the video, then approve to schedule it.';
    } else if (!p.audioTrackId && !p.editorProjectId) {
      scheduleStatus.textContent = 'Pick a backing audio track and a thumbnail, then send it to Final Check.';
    } else if (!p.thumbnailDataUrl) {
      scheduleStatus.textContent = (p.editorProjectId ? 'Backing audio came from Editor' : 'Audio picked') + ' — pick a thumbnail frame, then send it to Final Check.';
    } else {
      scheduleStatus.textContent = 'Ready — head to the Upload Files list to send this to Final Check.';
    }
    approveBtn.hidden = p.stage !== 'final_check';
  }

  function populateFields(p) {
    // Planning cards are primarily writing workspaces. Give them a denser,
    // viewport-filling layout; Production cards retain the scrollable media
    // form because they have several video-specific controls below Notes.
    pieceModal.classList.toggle('text-piece', !p.hasVideo);
    pieceModal.classList.toggle('video-piece', !!p.hasVideo);
    modalWrap.classList.toggle('text-workspace', !p.hasVideo);
    teleprompterOpen.hidden = !!p.hasVideo;
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
      fieldAudioTrack.closest('.field').hidden = false;
      videoPreview.removeAttribute('src');
      return Promise.resolve();
    }

    videoSection.hidden = false;
    // Editor-origin videos already carry the soundtrack Harvey auditioned and
    // approved there. The shared legacy modal must not offer a second place
    // to contradict that choice, but it retains the saved value underneath.
    fieldAudioTrack.closest('.field').hidden = !!p.editorProjectId;
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
    closeTeleprompter();
    modalWrap.classList.remove('open');
    modalWrap.classList.remove('text-workspace');
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
    var draftRevision = storePieceDraftSnapshot(p);
    metaUpdated.textContent = 'Updated ' + fmtFull(p.updatedAt);

    if (isNewUnsaved) {
      if (hasText(vals)) {
        isNewUnsaved = false;
        modalEyebrowText.textContent = 'Editing piece';
        metaCreated.textContent = 'Created ' + fmtFull(p.createdAt);
        Store.put('pieces', p).then(function () {
          clearPieceDraftSnapshot(p.id, draftRevision);
          flashSaved();
          notifyPiecesChanged();
        }).catch(function () { showPieceConflict('That note could not be saved yet. Your local recovery copy has been kept.'); });
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
      clearPieceDraftSnapshot(p.id, draftRevision);
      if (p.hasVideo) updateStageAndScheduleUI(p);
      flashSaved();
      if (p.stage !== prevStage) notifyPieceMoved(p.id);
      else notifyPiecesChanged();
    }).catch(function (error) {
      if (!error || error.code !== 'stale_write') showPieceConflict('That note could not be saved yet. Your local recovery copy has been kept.');
    });
  }

  function debounceSync() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(syncFromForm, 500);
  }

  function captureDraftAndDebounceSync() {
    if (activeId && pieces[activeId]) {
      var snapshot = Object.assign({}, pieces[activeId], currentFormValues(), { updatedAt: nowIso() });
      storePieceDraftSnapshot(snapshot);
    }
    debounceSync();
  }

  function closeModal() {
    clearTimeout(saveTimer);
    disarmDelete();
    if (activeId) {
      syncFromForm();
      if (isNewUnsaved) {
        clearPieceDraftSnapshot(activeId);
        delete pieces[activeId];
      }
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
    '<div class="ops-panel ops-panel--pipeline">' +
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
      '<div class="queue-coverage" id="queueCoverage" aria-label="Publishing runway"></div>' +
      '<div class="overview-row" id="overviewRow"></div>' +
      '<div class="board-wrap" id="boardWrap"><div class="board" id="board"></div></div>' +
    '</div>';

  var board, statStrip, overviewRow, queueCoverage, boardWrap, draggingId = null;
  var boardSettingsCache = null;
  // Which caption tab is currently selected on each Final Check card,
  // keyed by piece id — ephemeral (not persisted, resets on page load),
  // just enough to survive re-renders within the same page session.
  var fcCaptionTab = {};
  // Fetched once in bootContentOps (mirrors boardSettingsCache just above)
  // so a Final Check card's publishing-queue button can tell whether
  // there's actually a connected account to publish to, without every
  // card making its own request.
  var youtubeStatusCache = null;
  var tiktokStatusCache = null;
  var metaStatusCache = null;

  function renderStats() {
    var total = Object.keys(pieces).length;
    var liveCount = orderedIds('live').length;
    var activeCount = total - liveCount;
    statStrip.innerHTML =
      '<span><span class="n">' + total + '</span>total</span>' +
      '<span><span class="n">' + activeCount + '</span>in motion</span>' +
      '<span><span class="n">' + liveCount + '</span>live</span>';
  }

  function renderQueueCoverage() {
    if (!queueCoverage || !window.RMQueueCoverage) return;
    var status = tiktokStatusCache && tiktokStatusCache.connected ? tiktokStatusCache : null;
    var runway = window.RMQueueCoverage.calculate({
      pieces: Object.keys(pieces).map(function (id) { return pieces[id]; }),
      now: Date.now(),
      longformTime: boardSettingsCache && boardSettingsCache.longformScheduleTime,
      postingSchedule: status && status.channel && status.channel.postingSchedule
    });
    function dateLabel(value) {
      return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(value));
    }
    function timeLabel(value) {
      return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(value));
    }
    function summary(label, item, cadence) {
      var title = item.nextNeededAt === null ? 'Next refill date unavailable' :
        'Next video ready by ' + dateLabel(item.nextNeededAt) + (item.estimated ? '' : ' · ' + timeLabel(item.nextNeededAt));
      var sub = item.nextNeededAt === null ? 'Connect Buffer to confirm the short-form cadence.' :
        item.coveredSlots + ' slot' + (item.coveredSlots === 1 ? '' : 's') + ' covered · ' +
        item.daysUntilNeeded + ' day' + (item.daysUntilNeeded === 1 ? '' : 's') + ' until refill';
      return '<section class="queue-coverage-summary" aria-label="' + label + ' publishing runway">' +
        '<div class="queue-coverage-head"><span>' + label + '</span><span>' + cadence + '</span></div>' +
        '<strong class="queue-coverage-deadline">' + title + '</strong>' +
        '<div class="queue-coverage-meta">' + sub + ' · ' + item.readyCount + ' ready in queue' +
          (item.scheduledCount ? ' · ' + item.scheduledCount + ' already scheduled' : '') + '</div>' +
      '</section>';
    }
    function slotMarkers(slots, label) {
      if (!slots.length) return '<span class="queue-map-no-slot" aria-label="No ' + label + ' slot">—</span>';
      return slots.map(function (slot) {
        var stateLabel = slot.state === 'open' ? 'Needs a video' : slot.state === 'scheduled' ? 'Scheduled' :
          slot.state === 'published' ? 'Published' : 'Ready in queue';
        var detail = label + ' · ' + timeLabel(slot.at) + ' · ' + stateLabel;
        return '<span class="queue-map-slot queue-map-slot--' + slot.state + '" title="' + escapeHtml(detail) +
          '" aria-label="' + escapeHtml(detail) + '">' + (slot.state === 'open' ? '!' : '✓') + '</span>';
      }).join('');
    }
    var days = runway.days.map(function (day) {
      var date = dateLabel(day.at);
      return '<div class="queue-map-day' + (day.today ? ' queue-map-day--today' : '') + '" aria-label="' + escapeHtml(date) + '">' +
        '<div class="queue-map-date"><span>' + escapeHtml(date.split(' ')[0]) + '</span><strong>' + escapeHtml(date.replace(/^\w+ /, '')) + '</strong></div>' +
        '<div class="queue-map-path"><span class="queue-map-node"></span></div>' +
        '<div class="queue-map-lane"><small>LONG</small><span>' + slotMarkers(day.publishedLongform.concat(day.longform), 'Long-form') + '</span></div>' +
        '<div class="queue-map-lane"><small>SHORT</small><span>' + slotMarkers(day.publishedShortform.concat(day.shortform), 'Short-form') + '</span></div>' +
      '</div>';
    }).join('');
    queueCoverage.innerHTML = '<div class="queue-coverage-summary-row">' +
      summary('Long-form', runway.longform, 'Every 3 days') +
      summary('Short-form', runway.shortform, 'Buffer cadence') + '</div>' +
      '<div class="queue-map-head"><div><strong>Next 15 days</strong><span>Today → forward · Bangkok time</span><span class="queue-map-swipe">Swipe timeline →</span></div>' +
        '<div class="queue-map-key"><span class="queue-map-key-published">✓ Published</span><span class="queue-map-key-ready">✓ Ready</span><span class="queue-map-key-scheduled">✓ Scheduled</span><span class="queue-map-key-open">! Needs video</span><span>— No slot</span></div></div>' +
      '<div class="queue-map-scroll" aria-label="15-day publishing map"><div class="queue-map-days">' + days + '</div></div>' +
      (runway.shortform.estimated ? '<div class="queue-coverage-note">Short-form dates are daily estimates from the last actual post while Buffer’s schedule is unavailable.</div>' : '');
  }

  function renderOverview() {
    if (!overviewRow) return;
    var now = Date.now();
    var tiles = Store.CONTENT_TYPES.map(function (ct) {
      var items = Object.keys(pieces).map(function (k) { return pieces[k]; }).filter(function (p) { return p.contentType === ct.id && p.hasVideo; });
      var queued = items.filter(function (p) { return p.stage === 'publishing_queue'; });
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
        '<div class="overview-tile-sub2">' + queued.length + ' in publishing queue</div>' +
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
    if (piece.storageStatus === 'ready') out += '<span class="chip storage-chip">Cloud stored</span>';
    if (piece.storageStatus === 'uploading') out += '<span class="chip storage-chip">Storing video…</span>';
    return out;
  }

  function tiktokPerformanceHtml(piece) {
    if (!piece || piece.tiktokPublishProvider !== 'buffer') return '';
    var metrics = piece.tiktokMetrics || {};
    function value(type, fallback) {
      var metric = metrics[type] || (fallback ? metrics[fallback] : null);
      return metric ? Number(metric.value || 0).toLocaleString() : null;
    }
    var parts = [];
    var views = value('views');
    var reactions = value('reactions', 'likes');
    var comments = value('comments');
    var shares = value('shares', 'reposts');
    if (views !== null) parts.push(views + ' views');
    if (reactions !== null) parts.push(reactions + ' reactions');
    if (comments !== null) parts.push(comments + ' comments');
    if (shares !== null) parts.push(shares + ' shares');
    var link = /^https:\/\//i.test(piece.tiktokExternalLink || '')
      ? '<a class="card-external-link" href="' + escapeHtml(piece.tiktokExternalLink) + '" target="_blank" rel="noopener">View TikTok ↗</a>'
      : '';
    if (!parts.length && !link) return '';
    return '<div class="card-performance">' + (parts.length ? '<span>' + parts.join(' · ') + '</span>' : '') + link + '</div>';
  }

  function productionProgressHtml(piece) {
    if (!piece || piece.stage !== 'in_production' || !piece.hasVideo) return '';
    var status = piece.finalBuildStatus;
    var analyzing = piece.analysisStatus === 'pending' || piece.analysisStatus === 'running';
    var label = '';
    var detail = '';
    var percent = Math.max(0, Math.min(95, Math.round(Number(piece.finalBuildProgress) || 0)));
    if (status === 'pending') label = 'Preparing final video…';
    else if (status === 'running') {
      var steps = {
        preparing: 'Preparing source and audio…',
        rendering_picture: 'Rendering full-resolution video…',
        measuring_audio: 'Measuring dialogue and music…',
        mixing_audio: 'Mixing soundtrack…',
        measuring_mix: 'Checking audio levels…',
        finalizing_video: 'Encoding final video with audio…',
        verifying: 'Verifying final video…'
      };
      label = steps[piece.finalBuildStep] || (percent > 0 ? 'Rendering full-resolution video…' : 'Preparing final video…');
      if (piece.finalBuildStep === 'rendering_picture' && percent > 0) detail = percent + '%';
    } else if (status === 'error') {
      label = 'Final video build failed';
      detail = 'Open Content Production to retry.';
    } else if (status === 'done' && analyzing) {
      label = 'Final video ready';
      detail = 'Finishing transcription and title matching…';
    } else if (analyzing) label = 'Transcribing and matching title…';
    if (!label) return '';
    var busy = status === 'pending' || status === 'running';
    return '<div class="card-processing' + (status === 'error' ? ' error' : '') + '" role="status" aria-live="polite"' +
      (status === 'error' && piece.finalBuildError ? ' title="' + escapeHtml(piece.finalBuildError) + '"' : '') + '>' +
      '<span class="card-processing-heading"><span class="card-processing-indicator" aria-hidden="true"></span>' + escapeHtml(label) + '</span>' +
      (detail ? '<span class="card-processing-detail">' + escapeHtml(detail) + '</span>' : '') +
      (busy ? '<span class="card-processing-track"><i style="width:' + Math.max(3, percent) + '%"></i></span>' : '') +
      '</div>';
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
    // it's past In Production (§128's auto-capture) — Harvey asked for this
    // after noticing a normal (non-Final-Check) kanban card gave no
    // visual hint at all of which video it actually was.
    var thumbHtml = piece.thumbnailDataUrl ? '<div class="card-thumb"><img src="' + piece.thumbnailDataUrl + '" alt="" /></div>' : '';
    if (piece.stage === 'publishing_queue' && piece.hasVideo) {
      // Reuse Final Check's 720p review player and its existing playback
      // binding. Never attach the multi-gigabyte publish master to the board.
      thumbHtml = '<div class="fc-video-wrap queue-video-wrap' + (piece.videoIsVertical ? ' is-vertical' : '') + '">' +
        '<video class="fc-video" data-id="' + id + '" playsinline preload="metadata"' +
          (piece.thumbnailDataUrl ? ' poster="' + piece.thumbnailDataUrl + '"' : '') + '></video>' +
        '<div class="fc-video-overlay"><span class="fc-play-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 6l10 6-10 6V6Z"/></svg></span></div>' +
        '</div>' +
        '<div class="fc-player-controls queue-player-controls">' +
          '<button type="button" class="fc-play-toggle" aria-label="Play video">Play</button>' +
          '<input class="fc-seek" type="range" min="0" max="1000" value="0" disabled aria-label="Seek through video" />' +
          '<span class="fc-video-time">0:00 / 0:00</span>' +
          '<span class="fc-review-status" aria-live="polite">Preparing 720p review…</span>' +
          '<button type="button" class="fc-review-retry" hidden>Retry review copy</button>' +
        '</div>';
    }
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
      '<div class="card' + (isAuto ? ' card-auto' : '') + (isAi ? ' card-ai' : '') + '" draggable="' + (isAuto || !canEdit ? 'false' : 'true') + '" data-id="' + id + '"' + (isAi ? ' title="AI-generated"' : '') + '>' +
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
        productionProgressHtml(piece) +
        tiktokPerformanceHtml(piece) +
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
    // Final Check is the last safe place to catch a weak/incorrect title,
    // so these are real autosaving inputs rather than read-only lines. A
    // short still gets one slot; longform retains its three genuine title
    // options. The first saved value remains the publish-authoritative title
    // used by fc-yt-publish-btn below.
    var titleSlotCount = piece.contentType === 'longform' ? 3 : 1;
    var titleIndexes = [];
    for (var titleIndex = 0; titleIndex < titleSlotCount; titleIndex++) titleIndexes.push(titleIndex);
    var titlesHtml = '<div class="fc-titles" data-id="' + id + '">' + titleIndexes.map(function (i) {
      var label = titleSlotCount === 1 ? 'Title' : ('Title ' + (i + 1));
      var placeholder = titleSlotCount === 1 ? 'Add title' : ('Title option ' + (i + 1) + (i ? ' (optional)' : ''));
      return '<label class="fc-title-line"><strong>' + label + ':</strong>' +
        '<input type="text" class="fc-title-input" data-id="' + id + '" data-index="' + i + '" maxlength="100"' +
          ' value="' + escapeHtml(titles[i] || '') + '" placeholder="' + placeholder + '"' +
          (canEditPiece(piece) ? '' : ' disabled') + ' /></label>';
    }).join('') + '<span class="fc-title-save" aria-live="polite"></span></div>';
    // The publish master is already complete at this stage. Playback uses a
    // 720p picture rendition with the master AAC stream copied unchanged;
    // the full-resolution <id>-final file is still the only publish input.
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
    // fullscreen was the original trade-off. The separate controls below
    // provide reliable seeking without putting native chrome in the click path.
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
          '<video class="fc-video" data-id="' + id + '" playsinline preload="auto"' +
            (piece.thumbnailDataUrl ? ' poster="' + piece.thumbnailDataUrl + '"' : '') +
            '></video>' +
          '<div class="fc-video-overlay">' +
            '<span class="fc-play-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 6l10 6-10 6V6Z"/></svg></span>' +
          '</div>' +
        '</div>' +
        '<div class="fc-player-controls">' +
          '<button type="button" class="fc-play-toggle" aria-label="Play video">Play</button>' +
          '<input class="fc-seek" type="range" min="0" max="1000" value="0" disabled aria-label="Seek through video" />' +
          '<span class="fc-video-time">0:00 / 0:00</span>' +
          '<span class="fc-review-status" aria-live="polite">Preparing 720p review…</span>' +
          '<button type="button" class="fc-review-retry" hidden>Retry review copy</button>' +
        '</div>' +
        titlesHtml +
        fcCaptionSectionHtml(id, piece, boardSettingsCache) +
        '<div class="chip-row">' + chipHtml(piece, { hideVideoChip: true }) + '</div>' +
        // "Send to Publishing Queue" (below) is the one and only action on this
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

  // Platforms that have a real backend publish integration. Harvey's framing
  // (2026-09-20): the
  // button here should read as one generic scheduling/publish action that
  // goes out to every platform a piece is tagged for, not "Publish to
  // <platform>" — it just happens that only these two platforms can
  // genuinely act on that so far. Extend this list (and the per-platform
  // helpers right below) as other platforms get real integrations.
  var WIRED_PUBLISH_PLATFORMS = ['ytlong', 'ytshort', 'tiktok', 'instagram', 'facebook'];
  var PUBLISH_PLATFORM_LABELS = { ytlong: 'YouTube', ytshort: 'YouTube Shorts', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' };
  // A youtube-reviewer session only ever gets YouTube — TikTok has nothing
  // to do with why this account exists, and server.js's /api/tiktok
  // blanket rejects it outright anyway (401), so there's no point ever
  // offering it here.
  function effectiveWiredPlatforms() { return IS_REVIEWER ? ['ytlong'] : WIRED_PUBLISH_PLATFORMS; }

  function publishStatusFieldFor(platform) {
    if (platform === 'ytlong' || platform === 'ytshort') return 'youtubePublishStatus';
    if (platform === 'tiktok') return 'tiktokPublishStatus';
    if (platform === 'instagram') return 'instagramPublishStatus';
    return 'facebookPublishStatus';
  }
  function publishErrorFieldFor(platform) {
    if (platform === 'ytlong' || platform === 'ytshort') return 'youtubePublishError';
    if (platform === 'tiktok') return 'tiktokPublishError';
    if (platform === 'instagram') return 'instagramPublishError';
    return 'facebookPublishError';
  }
  function publishPlatformConnected(platform) {
    var cache = (platform === 'ytlong' || platform === 'ytshort')
      ? youtubeStatusCache
      : (platform === 'tiktok' ? tiktokStatusCache : metaStatusCache);
    return !!(cache && cache.connected);
  }

  // This is the single action covering every wired platform a
  // piece is tagged for. The backend owns release timing, topic separation,
  // and visibility. Final Check therefore offers no misleading per-card
  // privacy choice: Harvey's YouTube releases are always Public, while the
  // separately restricted reviewer account remains Private server-side.
  function fcScheduleVideoHtml(id, piece) {
    var actionLabel = IS_REVIEWER ? 'Schedule Video' : 'Send to Publishing Queue';
    // A reviewer session can only ever schedule a piece it made itself —
    // server.js enforces this too (real 403 on the publish routes), this
    // just avoids offering a button that would fail.
    if (!canEditPiece(piece)) {
      return '<div class="fc-yt-publish"><button type="button" class="btn-secondary" disabled title="You can only publish a video you uploaded yourself">' + actionLabel + '</button></div>';
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
          '<button type="button" class="btn-secondary" disabled title="None of this piece\'s selected platforms can be published yet">' + actionLabel + '</button>' +
          notWiredNote +
        '</div>';
    }
    var disconnected = wired.filter(function (p) { return !publishPlatformConnected(p); });
    var disabledAttr = disconnected.length
      ? ' disabled title="Connect ' + disconnected.map(function (p) { return PUBLISH_PLATFORM_LABELS[p] || p; }).join(' / ') + ' in Content Settings first"'
      : '';
    return '' +
      '<div class="fc-yt-publish">' +
        '<button type="button" class="btn-secondary fc-yt-publish-btn" data-id="' + id + '"' + disabledAttr + '>' +
          (erroredPlatforms.length ? 'Retry' : actionLabel) +
        '</button>' +
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
    // A background Production/queue refresh can redraw the entire board every
    // three seconds. Keep an in-progress Final Check player as the very same
    // DOM node: replacing <video> restarts playback from zero even though the
    // review file itself is complete. Preserve its controls too, because their
    // event handlers close over this player and its wrapper.
    var activeFinalCheckPlayers = [];
    board.querySelectorAll('.final-check-card[data-id]').forEach(function (card) {
      var wrap = card.querySelector('.fc-video-wrap');
      var video = wrap && wrap.querySelector('video');
      var controls = wrap && wrap.nextElementSibling;
      if (!video || !controls || video.ended || (video.paused && !(video.currentTime > 0))) return;
      activeFinalCheckPlayers.push({ id: card.dataset.id, wrap: wrap, controls: controls });
      wrap.remove();
      controls.remove();
    });
    // Rebuilding the board replaces every `.column-body`, which otherwise
    // resets each stage to the top. This is especially disruptive when an
    // editor opened halfway down a busy column closes and calls render().
    // Key the offsets by stage rather than DOM order so filtering, moving a
    // card, or adding a future stage cannot restore an offset to the wrong
    // column.
    var columnScrollTops = {};
    board.querySelectorAll('.column-body[data-stage]').forEach(function (body) {
      columnScrollTops[body.dataset.stage] = body.scrollTop;
    });
    var query = activeSearchQuery.trim().toLowerCase();
    board.innerHTML = Store.STAGES.map(function (s, idx) {
      var ids = orderedIds(s.id);
      if (activeTypeFilter) ids = ids.filter(function (id) { return pieces[id].contentType === activeTypeFilter; });
      if (query) ids = ids.filter(function (id) { return pieceMatchesSearch(pieces[id], query); });
      var isAutoCol = AUTO_STAGE_IDS.indexOf(s.id) !== -1;
      var isFinalCheck = s.id === 'final_check';
      var cards;
      if (s.id === 'publishing_queue') {
        var longformQueueIds = ids.filter(function (id) { return pieces[id].contentType === 'longform'; });
        var shortformQueueIds = ids.filter(function (id) { return pieces[id].contentType !== 'longform'; });
        var queueGroupHtml = function (label, groupIds) {
          return '<section class="publishing-queue-group">' +
            '<div class="publishing-queue-group-head"><span>' + label + '</span><span>' + groupIds.length + '</span></div>' +
            (groupIds.length ? groupIds.map(function (id) { return cardHtml(id, pieces[id]); }).join('') : '<div class="publishing-queue-empty">No videos waiting</div>') +
          '</section>';
        };
        cards = queueGroupHtml('Long-form queue', longformQueueIds) + queueGroupHtml('Short-form queue', shortformQueueIds);
      } else {
        cards = ids.map(function (id) { return isFinalCheck ? finalCheckCardHtml(id, pieces[id]) : cardHtml(id, pieces[id]); }).join('');
      }
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
    activeFinalCheckPlayers.forEach(function (saved) {
      var card = Array.from(board.querySelectorAll('.final-check-card[data-id]')).find(function (candidate) {
        return candidate.dataset.id === saved.id;
      });
      if (!card) {
        var departedVideo = saved.wrap.querySelector('video');
        if (departedVideo) departedVideo.pause();
        return;
      }
      var newWrap = card.querySelector('.fc-video-wrap');
      var newControls = newWrap && newWrap.nextElementSibling;
      if (!newWrap || !newControls) {
        var missingVideo = saved.wrap.querySelector('video');
        if (missingVideo) missingVideo.pause();
        return;
      }
      newWrap.replaceWith(saved.wrap);
      newControls.replaceWith(saved.controls);
    });
    boardWrap.scrollLeft = scrollLeft;
    board.querySelectorAll('.column-body[data-stage]').forEach(function (body) {
      if (Object.prototype.hasOwnProperty.call(columnScrollTops, body.dataset.stage)) {
        body.scrollTop = columnScrollTops[body.dataset.stage];
      }
    });
    renderStats();
    renderQueueCoverage();
    renderOverview();
    bindBoardEvents();
  }

  // A real move animation, originally built (2026-09-20) for just one
  // case — a card's *stage* changing because a background job finished
    // (In Production -> Final Check once a video build completes, Final Check
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
        if (e.target.closest('.card-move, .card-external-link, .queue-video-wrap, .queue-player-controls')) return;
        var piece = pieces[el.dataset.id];
        if (piece && piece.stage === 'in_editor' && piece.editorProjectId) {
          localStorage.setItem('rmEditorListFilter', 'active');
          localStorage.setItem('rmEditorActiveProjectId', piece.editorProjectId);
          location.hash = 'editor';
          return;
        }
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
      if (wrap.dataset.playerBound === 'true') return;
      wrap.dataset.playerBound = 'true';
      var v = wrap.querySelector('video');
      if (!v) return;
      var controls = wrap.nextElementSibling;
      var playButton = controls && controls.querySelector('.fc-play-toggle');
      var seek = controls && controls.querySelector('.fc-seek');
      var time = controls && controls.querySelector('.fc-video-time');
      var reviewStatus = controls && controls.querySelector('.fc-review-status');
      var reviewRetry = controls && controls.querySelector('.fc-review-retry');
      var reviewId = v.dataset.id;
      if (playButton) playButton.disabled = true;
      function loadReviewCopy() {
        if (!document.body.contains(wrap)) return;
        fetch('/api/videos/' + encodeURIComponent(reviewId) + '/final-review-status').then(function (response) {
          if (!response.ok) throw new Error('Review copy status is unavailable.');
          return response.json();
        }).then(function (result) {
          if (!document.body.contains(wrap)) return;
          if (result.status === 'ready') {
            v.src = '/api/files/videos/' + encodeURIComponent(reviewId) + '-final-review';
            v.load();
            if (playButton) playButton.disabled = false;
            if (reviewStatus) reviewStatus.textContent = '720p review · published audio';
            if (reviewRetry) reviewRetry.hidden = true;
          } else if (result.status === 'preparing') {
            if (reviewStatus) reviewStatus.textContent = 'Preparing 720p review…';
            setTimeout(loadReviewCopy, 3000);
          } else {
            if (reviewStatus) reviewStatus.textContent = result.message || 'Review copy unavailable.';
            if (reviewRetry) reviewRetry.hidden = result.status !== 'error';
          }
        }).catch(function () {
          if (!document.body.contains(wrap)) return;
          if (reviewStatus) reviewStatus.textContent = 'Checking review copy…';
          setTimeout(loadReviewCopy, 5000);
        });
      }
      if (reviewRetry) reviewRetry.addEventListener('click', function () {
        reviewRetry.hidden = true;
        if (reviewStatus) reviewStatus.textContent = 'Retrying 720p review…';
        fetch('/api/videos/' + encodeURIComponent(reviewId) + '/final-review-retry', { method: 'POST' })
          .then(function () { loadReviewCopy(); })
          .catch(function () { reviewRetry.hidden = false; });
      });
      function formatTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
        var whole = Math.floor(seconds);
        var hours = Math.floor(whole / 3600);
        var minutes = Math.floor((whole % 3600) / 60);
        var secondsPart = String(whole % 60).padStart(2, '0');
        return hours ? hours + ':' + String(minutes).padStart(2, '0') + ':' + secondsPart : minutes + ':' + secondsPart;
      }
      function syncPlayState() {
        wrap.classList.toggle('is-playing', !v.paused);
        if (playButton) {
          playButton.textContent = v.paused ? 'Play' : 'Pause';
          playButton.setAttribute('aria-label', v.paused ? 'Play video' : 'Pause video');
        }
      }
      function syncTime() {
        var duration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
        if (seek) {
          seek.disabled = !duration;
          if (!seek.matches(':active')) seek.value = duration ? String(Math.round(v.currentTime / duration * 1000)) : '0';
        }
        if (time) time.textContent = formatTime(v.currentTime) + ' / ' + formatTime(duration);
      }
      v.addEventListener('click', function () {
        if (v.paused) v.play().catch(function () {}); else v.pause();
      });
      if (playButton) playButton.addEventListener('click', function () {
        if (v.paused) v.play().catch(function () {}); else v.pause();
      });
      if (seek) {
        seek.addEventListener('input', function () {
          if (time && Number.isFinite(v.duration)) time.textContent = formatTime(v.duration * Number(seek.value) / 1000) + ' / ' + formatTime(v.duration);
        });
        seek.addEventListener('change', function () {
          if (Number.isFinite(v.duration)) v.currentTime = v.duration * Number(seek.value) / 1000;
        });
      }
      v.addEventListener('play', syncPlayState);
      v.addEventListener('pause', syncPlayState);
      v.addEventListener('loadedmetadata', syncTime);
      v.addEventListener('durationchange', syncTime);
      v.addEventListener('timeupdate', syncTime);
      v.addEventListener('seeked', syncTime);
      // Start preparing the small copy when Content Ops renders, even when
      // this column is offscreen. Never preload the 4K publish file here.
      loadReviewCopy();
      syncPlayState();
      syncTime();
    });
    // Final Check title edits persist without re-rendering the card (which
    // would reset video playback). Input updates the in-memory publish value
    // immediately; a short debounce writes through the normal version-checked
    // piece API and keeps a synchronous local recovery draft until confirmed.
    board.querySelectorAll('.fc-titles').forEach(function (titlesWrap) {
      var id = titlesWrap.dataset.id;
      var p = pieces[id];
      if (!p || !canEditPiece(p)) return;
      var inputs = Array.prototype.slice.call(titlesWrap.querySelectorAll('.fc-title-input'));
      var saveState = titlesWrap.querySelector('.fc-title-save');
      var saveTimer = null;

      function copyInputsToPiece() {
        var values = inputs.map(function (input) { return input.value.trim(); }).filter(Boolean);
        p.ytTitles = values;
        p.ytTitlesManuallyEdited = true;
        p.title = values[0] || '';
        p.updatedAt = nowIso();
        syncTags(p);
        return storePieceDraftSnapshot(p);
      }

      function saveTitles() {
        clearTimeout(saveTimer);
        saveTimer = null;
        var draftRevision = copyInputsToPiece();
        saveState.textContent = 'Saving…';
        Store.put('pieces', p).then(function () {
          clearPieceDraftSnapshot(id, draftRevision);
          saveState.textContent = 'Saved';
          clearTimeout(saveState._clearTimer);
          saveState._clearTimer = setTimeout(function () { saveState.textContent = ''; }, 1800);
        }).catch(function (error) {
          saveState.textContent = 'Not saved';
          if (!error || error.code !== 'stale_write') showPieceConflict('That title could not be saved yet. Your local recovery copy has been kept.');
        });
      }

      inputs.forEach(function (input) {
        input.addEventListener('input', function () {
          copyInputsToPiece();
          saveState.textContent = 'Saving…';
          clearTimeout(saveTimer);
          saveTimer = setTimeout(saveTitles, 450);
        });
        input.addEventListener('blur', function () {
          if (saveTimer) saveTitles();
        });
        input.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
        });
      });
    });
    // One coordinated backend job publishes every wired/tagged platform and
    // switches this one card into a
    // disabled "Publishing…" state without a full render(), matching the
    // same "don't reset the video's playback" reasoning as the caption-tab
    // toggle. The poller below (maybeStartYoutubePublishPoll) is what
    // notices the eventual done/error and does the full render() once the
    // piece's stage/status actually changes.
    // The server runs destinations sequentially and merges results, avoiding
    // duplicate retry posts and cross-platform record-write races.
    board.querySelectorAll('.fc-yt-publish-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.id;
        var p = pieces[id];
        if (!p || btn.disabled || !canEditPiece(p)) return;
        var platforms = (p.platforms || []).filter(function (pl) { return effectiveWiredPlatforms().indexOf(pl) !== -1; });
        if (!platforms.length) return;
        var captions = boardSettingsCache ? captionsForPiece(boardSettingsCache, p) : [];
        var title = (p.ytTitles && p.ytTitles[0]) || p.title || 'Untitled';

        btn.disabled = true;
        btn.textContent = IS_REVIEWER ? 'Publishing…' : 'Sending…';
        var unpublishedPlatforms = platforms.filter(function (platform) { return p[publishStatusFieldFor(platform)] !== 'done'; });
        unpublishedPlatforms.forEach(function (platform) { p[publishStatusFieldFor(platform)] = 'pending'; });
        pieces[id] = p;

        var destinations = unpublishedPlatforms.map(function (platform) {
          var captionEntry = captions.filter(function (c) { return c.key === platform; })[0];
          var caption = (captionEntry && !captionEntry.empty) ? captionEntry.text : '';
          return { platform: platform, title: title, caption: caption };
        });
        fetch('/api/publish/' + encodeURIComponent(id), {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ destinations: destinations })
        }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (data) { return { ok: r.ok, data: data }; }); })
          .then(function (result) {
            if (!result.ok) {
              unpublishedPlatforms.forEach(function (platform) {
                p[publishStatusFieldFor(platform)] = 'error';
                p[publishErrorFieldFor(platform)] = (result.data && result.data.error) || 'Could not start publish.';
              });
              render();
              return;
            }
            maybeStartYoutubePublishPoll();
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
      delBtn.textContent = pieces[id] && pieces[id].stage === 'publishing_queue' ? 'Delete queued video' : 'Delete';
      delBtn.addEventListener('click', function (e) { e.stopPropagation(); renderConfirm(); });
      menu.appendChild(delBtn);
    }
    function renderConfirm() {
      menu.innerHTML = '';
      var label = document.createElement('div');
      label.className = 'kanban-ctx-label';
      var queuedVideo = pieces[id] && pieces[id].stage === 'publishing_queue';
      label.textContent = queuedVideo ? 'Delete this video from the queue? It will not be scheduled.' : 'Delete this piece?';
      var confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'kanban-ctx-item kanban-ctx-confirm';
      confirmBtn.textContent = queuedVideo ? 'Delete queued video' : 'Confirm delete';
      confirmBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var p = pieces[id];
        if (!p) { closeKanbanCtxMenu(); return; }
        confirmBtn.disabled = true;
        label.textContent = 'Deleting…';
        if (p && p.stage === 'in_editor' && p.editorProjectId) {
          fetch('/api/editor/' + encodeURIComponent(p.editorProjectId), {
            method: 'DELETE', credentials: 'include'
          }).then(function (response) {
            if (!response.ok) throw new Error('Could not delete the Editor recording.');
            delete pieces[id];
            closeKanbanCtxMenu();
            render();
          }).catch(function (error) { label.textContent = error.message || 'Could not delete the recording.'; });
          return;
        }
        Store.del('pieces', id, p).then(function () {
          delete pieces[id];
          // The server cleans queue media and R2 after removing the queue
          // record. Other stages retain the existing file cleanup path.
          if (p.hasVideo && p.stage !== 'publishing_queue') {
            Store.del('videos', id);
            Store.del('videos', id + '-final');
            Store.del('videos', id + '-final-review');
          }
          closeKanbanCtxMenu();
          render();
        }).catch(function (error) { label.textContent = error.message || 'Could not delete this video.'; });
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

  // Real YouTube/Buffer-TikTok publishing both run in the background
  // server-side — this polls the
  // handful of pieces currently mid-publish on either platform and does a
  // full render() once one lands on done/error, since "done" moves the
  // piece out of the Final Check column entirely (a targeted DOM patch
  // wouldn't make sense there the way the caption-tab toggle's does).
  // Same shape as maybeStartAnalysisPolling in the Upload Files tab, kept
  // separate since it watches different fields on a different view.
  var youtubePublishPollTimer = null;
  var contentOpsRefreshTimer = null;

  function hasProcessingProductionCard() {
    return Object.keys(pieces).some(function (id) {
      var p = pieces[id];
      return p.stage === 'in_production' && (p.finalBuildStatus === 'pending' || p.finalBuildStatus === 'running' ||
        p.analysisStatus === 'pending' || p.analysisStatus === 'running');
    });
  }

  function sameProductionCardContent(before, after) {
    if (!before || before.stage !== 'in_production' || after.stage !== 'in_production') return false;
    return JSON.stringify([before.title, before.seq, before.thumbnailDataUrl, before.tags, before.platforms,
      before.contentType, before.storageStatus, before.tiktokMetrics, before.tiktokExternalLink]) ===
      JSON.stringify([after.title, after.seq, after.thumbnailDataUrl, after.tags, after.platforms,
        after.contentType, after.storageStatus, after.tiktokMetrics, after.tiktokExternalLink]);
  }

  function updateProductionCardProgress(id) {
    var card = board.querySelector('.card[data-id="' + id + '"]');
    if (!card) return false;
    var existing = card.querySelector('.card-processing');
    var markup = productionProgressHtml(pieces[id]);
    if (existing) existing.remove();
    if (markup) card.querySelector('.card-foot').insertAdjacentHTML('beforebegin', markup);
    return true;
  }

  // The natural publishing queue and Buffer publish later, independently of the browser tab that queued
  // the post. Refresh the board while it is open so Scheduled -> Posted/Live
  // and newly available metrics appear without a manual reload.
  function startContentOpsRefresh() {
    clearTimeout(contentOpsRefreshTimer);
    contentOpsRefreshTimer = setTimeout(function refreshContentOps() {
      if (currentTabId() !== 'content-ops') { contentOpsRefreshTimer = null; return; }
      if (pieceModal && pieceModal.getAttribute('aria-hidden') === 'false') {
        contentOpsRefreshTimer = setTimeout(refreshContentOps, 60000);
        return;
      }
      Store.getAll('pieces').then(function (rows) {
        var incoming = {};
        var changed = rows.length !== Object.keys(pieces).length;
        var progressOnly = !changed;
        var progressIds = [];
        rows.forEach(function (piece) {
          incoming[piece.id] = true;
          var current = pieces[piece.id];
          if (!current || current._recordVersion !== piece._recordVersion) {
            if (!sameProductionCardContent(current, piece)) progressOnly = false;
            else progressIds.push(piece.id);
            pieces[piece.id] = piece;
            changed = true;
          }
        });
        Object.keys(pieces).forEach(function (id) {
          if (!incoming[id]) { delete pieces[id]; changed = true; progressOnly = false; }
        });
        if (changed && (!progressOnly || !progressIds.every(updateProductionCardProgress))) render();
      }).finally(function () {
        if (currentTabId() === 'content-ops') contentOpsRefreshTimer = setTimeout(refreshContentOps, hasProcessingProductionCard() ? 3000 : 60000);
      });
    }, hasProcessingProductionCard() ? 3000 : 60000);
  }

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
        // Real move animation for Final Check -> Scheduled/Live once a
        // publish actually succeeds — same animateBoardMove used by
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
    queueCoverage = document.getElementById('queueCoverage');
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
    ensurePiecesLoaded().then(function () { render(); startContentOpsRefresh(); });
    // Final Check cards (see finalCheckCardHtml below) show the real
    // rendered caption inline, which needs Settings' caption templates —
    // fetched once here rather than only when Harvey happens to visit
    // the Settings tab. Re-renders once loaded so a caption isn't stuck
    // on its "Loading…" fallback for the rest of the session.
    Store.getSettings().then(function (s) { boardSettingsCache = s; render(); });
    fetch('/api/youtube/status', { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) { youtubeStatusCache = s; render(); }).catch(function () {});
    fetch('/api/buffer/status', { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) { tiktokStatusCache = s; render(); }).catch(function () {});
    fetch('/api/meta/status', { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) { metaStatusCache = s; render(); }).catch(function () {});
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
    '</div>';

  var dropzone, fileInput, uploadRows;
  // pieceId -> { trackId: mixed-audio object URL }. Production fills these
  // asynchronously from the server's persistent preview cache so every row
  // is ready for rapid soundtrack comparisons without blocking Editor.
  var uploadRowPreviewUrls = {};
  // pieceId -> pending debounce timer for the platform-checkbox save
  // below — see that handler's own comment for why this exists.
  var platformSaveTimers = {};
  var uploadCtxMenu = null;

  function closeUploadCtxMenu() {
    if (!uploadCtxMenu) return;
    uploadCtxMenu.remove();
    uploadCtxMenu = null;
    document.removeEventListener('click', closeUploadCtxMenuOnOutside, true);
    document.removeEventListener('contextmenu', closeUploadCtxMenuOnOutside, true);
    document.removeEventListener('keydown', closeUploadCtxMenuOnEscape, true);
  }
  function closeUploadCtxMenuOnOutside(e) {
    if (uploadCtxMenu && !uploadCtxMenu.contains(e.target)) closeUploadCtxMenu();
  }
  function closeUploadCtxMenuOnEscape(e) {
    if (e.key === 'Escape') closeUploadCtxMenu();
  }
  function openUploadCtxMenu(id, x, y) {
    closeUploadCtxMenu();
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
      label.textContent = 'Delete this video?';
      var confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'kanban-ctx-item kanban-ctx-confirm';
      confirmBtn.textContent = 'Confirm delete';
      confirmBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var p = pieces[id];
        if (!p || p.stage !== 'in_production' || !canEditPiece(p)) { closeUploadCtxMenu(); return; }
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Deleting…';
        clearTimeout(uploadRowSaveTimers[id]);
        delete uploadRowSaveTimers[id];
        clearTimeout(platformSaveTimers[id]);
        delete platformSaveTimers[id];
        Store.del('pieces', id, p).then(function () {
          delete pieces[id];
          // Media deletion is deliberately best-effort after the durable
          // piece deletion: a raw Production item may not have a `-final`
          // render yet, and that ordinary 404 must not make the card return.
          return Promise.all([
            Store.del('videos', id).catch(function () {}),
            Store.del('videos', id + '-final').catch(function () {})
          ]);
        }).then(function () {
          closeUploadCtxMenu();
          removeUploadRowAnimated(id);
        }).catch(function () {
          closeUploadCtxMenu();
          renderUploadLists();
        });
      });
      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'kanban-ctx-item kanban-ctx-cancel';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', function (e) { e.stopPropagation(); closeUploadCtxMenu(); });
      menu.appendChild(label);
      menu.appendChild(confirmBtn);
      menu.appendChild(cancelBtn);
    }
    renderInitial();

    document.body.appendChild(menu);
    var rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 8)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 8)) + 'px';
    uploadCtxMenu = menu;
    setTimeout(function () {
      document.addEventListener('click', closeUploadCtxMenuOnOutside, true);
      document.addEventListener('contextmenu', closeUploadCtxMenuOnOutside, true);
      document.addEventListener('keydown', closeUploadCtxMenuOnEscape, true);
    }, 0);
  }

  // One row per in-production video, everything Harvey needs inline —
  // thumbnail/title/id, a real scrubbable frame picker, the backing-audio
  // dropdown, the (up to 3) title fields, and "Send to final check" — no
  // modal click-through needed for the normal upload workflow anymore
  // (the shared modal still exists and still works, for anything this row
  // doesn't cover directly, e.g. notes/platforms/content type).
  // Rebuilding this row's own "head" (title/#id/tags/analysis
  // status) in place — rather than routing every small change through a
  // full renderUploadLists() — is what stops the whole list from
  // flashing/reloading (every other row's video blob getting re-fetched,
  // a real blank gap while the list was torn down and rebuilt) just
  // because Harvey clicked one audio dropdown or picked one thumbnail
  // frame. See buildUploadRow's callers below (captureBtn, audioSelect).
  function buildUploadRowHead(p) {
    var head = document.createElement('div');
    head.className = 'upload-row-head';
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
    // before the piece is allowed to leave In Production (see CLAUDE.md's
    // uploader-tool section on why), so this status line is what Harvey
    // actually watches after clicking "Send to final check."
    if (p.finalBuildStatus === 'running' || p.finalBuildStatus === 'pending') {
      var building = document.createElement('div');
      building.className = 'upload-row-status';
      building.textContent = 'Rendering full-resolution final video' +
        (Number(p.finalBuildProgress) > 0 ? ' · ' + Math.round(Number(p.finalBuildProgress)) + '%' : '') + '…';
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
      // In Production until analysis also settles (maybeAdvanceToFinalCheck)
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
    var videoShell = document.createElement('div');
    videoShell.className = 'upload-row-video-shell' + (p.videoIsVertical ? ' is-vertical' : '');
    if (p.thumbnailDataUrl) videoShell.classList.add('has-poster');
    var videoEl = document.createElement('video');
    videoEl.className = 'upload-row-video' + (p.videoIsVertical ? ' is-vertical' : '');
    videoEl.playsInline = true;
    videoEl.muted = true;
    // Range responses are capped server-side, so eager loading gets an actual
    // decodable frame quickly without risking a whole-file download.
    videoEl.preload = 'auto';
    if (p.thumbnailDataUrl) videoEl.poster = p.thumbnailDataUrl;
    var videoReady = videoEl.readyState >= 2;
    var frameLoader = document.createElement('div');
    frameLoader.className = 'upload-row-frame-loader';
    frameLoader.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Preparing 360p music preview…</span>';
    var scrub = document.createElement('input');
    scrub.type = 'range';
    scrub.className = 'upload-row-preview-scrub';
    scrub.setAttribute('aria-label', 'Video preview position');
    scrub.min = '0';
    scrub.max = '100';
    scrub.step = '0.1';
    scrub.value = '0';
    var scrubWrap = document.createElement('div');
    scrubWrap.className = 'upload-row-preview-timeline';
    var scrubTime = document.createElement('output');
    scrubTime.className = 'upload-row-preview-time';
    scrubTime.textContent = '0:00 / 0:00';
    scrubWrap.appendChild(scrub);
    scrubWrap.appendChild(scrubTime);
    var scrubDragging = false;
    function formatPreviewClock(seconds) {
      seconds = Math.max(0, Math.floor(Number(seconds) || 0));
      var hours = Math.floor(seconds / 3600);
      var minutes = Math.floor((seconds % 3600) / 60);
      var secs = String(seconds % 60).padStart(2, '0');
      return (hours ? hours + ':' + String(minutes).padStart(2, '0') : minutes) + ':' + secs;
    }
    function updatePreviewTimeline(seconds) {
      var current = Math.max(0, Number(seconds) || 0);
      if (!scrubDragging) scrub.value = String(current);
      scrubTime.textContent = formatPreviewClock(current) + ' / ' + formatPreviewClock(videoEl.duration);
    }
    videoEl.addEventListener('loadedmetadata', function () {
      if (videoEl.duration) scrub.max = videoEl.duration;
      updatePreviewTimeline(videoEl.currentTime);
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
        videoShell.classList.toggle('is-vertical', vertical);
      }
    });
    var frameMatchesThumbnail = !!p.thumbnailDataUrl;
    scrub.addEventListener('pointerdown', function () { scrubDragging = true; });
    scrub.addEventListener('pointerup', function () { scrubDragging = false; updatePreviewTimeline(videoEl.currentTime); });
    scrub.addEventListener('input', function () {
      try { videoEl.currentTime = parseFloat(scrub.value); } catch (e) {}
      updatePreviewTimeline(scrub.value);
      frameMatchesThumbnail = false;
      // Seeking can synchronously drop readyState below HAVE_CURRENT_DATA.
      // Keep the button unavailable only until the requested frame arrives;
      // `seeked` below is the missing half that used to leave it disabled
      // forever even though the new frame was visibly on screen.
      setCaptureButtonState(false);
    });
    // The playback proxy is intentionally tiny. Capture the selected frame
    // from the original Production source so publishing thumbnails do not
    // inherit the audition video's 360p resolution.
    async function captureCurrentFrame() {
      if (!videoEl.videoWidth || !videoEl.videoHeight) throw new Error('Video frame not ready');
      var selectedTime = Number(videoEl.currentTime) || 0;
      var response = await fetch('/api/videos/' + encodeURIComponent(p.id) + '/production-thumbnail-frame?t=' + encodeURIComponent(selectedTime.toFixed(3)), { credentials: 'include' });
      if (!response.ok) throw new Error('Could not capture the source frame');
      var imageBlob = await response.blob();
      var dataUrl = await new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = reject;
        reader.readAsDataURL(imageBlob);
      });
      p.thumbnailDataUrl = dataUrl;
      p.thumbnailTimeSeconds = selectedTime;
      p.updatedAt = nowIso();
      syncTags(p);
      await Store.put('pieces', p);
      refreshHead();
    }
    var captureBtn = document.createElement('button');
    captureBtn.type = 'button';
    captureBtn.className = 'btn-secondary btn-tiny upload-row-capture';
    captureBtn.addEventListener('click', function () {
      captureBtn.disabled = true;
      captureBtn.textContent = 'Capturing source frame…';
      captureCurrentFrame().then(function () {
        frameMatchesThumbnail = true;
        setCaptureButtonState(true);
      }).catch(function () {
        frameMatchesThumbnail = false;
        setCaptureButtonState(true, 'Could not capture — try again');
      });
    });
    var videoPreviewControls = document.createElement('div');
    videoPreviewControls.className = 'upload-row-video-preview-controls';
    var videoPreviewBtn = document.createElement('button');
    videoPreviewBtn.type = 'button';
    videoPreviewBtn.className = 'btn-primary btn-tiny upload-row-video-preview';
    videoPreviewBtn.textContent = '▶ Preview video';
    videoPreviewBtn.disabled = true;
    var videoPreviewHint = document.createElement('span');
    videoPreviewHint.textContent = 'Voice + selected backing track';
    videoPreviewControls.appendChild(videoPreviewBtn);
    videoPreviewControls.appendChild(videoPreviewHint);
    videoShell.appendChild(videoEl);
    videoShell.appendChild(frameLoader);
    frameSection.appendChild(videoShell);
    frameSection.appendChild(videoPreviewControls);
    frameSection.appendChild(scrubWrap);
    frameSection.appendChild(captureBtn);
    // Disabled while a spinner covers the frame area until the video
    // actually has a frame to give — found live (2026-09-20, headless-browser test
    // against a throttled connection) that with several rows in the list
    // at once, a later row's (often multi-MB) video blob can take a real
    // while to fetch, and clicking "Use this frame" during that window
    // silently no-op'd via captureCurrentFrame()'s own early-return guard
    // with zero feedback — looked exactly like a dead button, especially
    // on a slower real connection than this container's own fast link to
    // the VPS. `loadeddata` (readyState >= HAVE_CURRENT_DATA) now removes
    // the spinner and enables the button from the same readiness signal.
    function setCaptureButtonState(ready, overrideText) {
      captureBtn.disabled = !ready || !canEditRow;
      captureBtn.classList.toggle('is-selected', ready && frameMatchesThumbnail);
      captureBtn.textContent = overrideText || (ready && frameMatchesThumbnail ? '✓ Thumbnail selected' : 'Use this frame');
    }
    function setFrameControlsReady(ready) {
      videoReady = ready;
      frameLoader.hidden = ready;
      videoShell.classList.toggle('is-loading', !ready);
      setCaptureButtonState(ready);
      scrub.disabled = !ready || !canEditRow;
      if (audioPreviewBtn) setPreviewButtonState();
    }
    setFrameControlsReady(videoEl.readyState >= 2);
    videoEl.addEventListener('loadeddata', function () { setFrameControlsReady(true); });
    videoEl.addEventListener('seeked', function () {
      if (videoEl.videoWidth && videoEl.videoHeight) setFrameControlsReady(true);
    });
    videoEl.addEventListener('error', function () {
      frameLoader.innerHTML = '<span>Video preview could not load.</span>';
      setFrameControlsReady(false);
    });
    // One small 360p picture serves every soundtrack audition for this piece;
    // the original source is fetched only for an explicitly chosen thumbnail.
    var videoPreviewPoll = null;
    function loadProductionPicture() {
      if (!videoEl.isConnected) return;
      fetch('/api/videos/' + encodeURIComponent(p.id) + '/production-preview-status', { credentials: 'include', cache: 'no-store' })
        .then(function (response) { if (!response.ok) throw new Error('Preview status unavailable'); return response.json(); })
        .then(function (result) {
          if (!videoEl.isConnected) return;
          if (result.status === 'ready') {
            videoEl.src = '/api/videos/' + encodeURIComponent(p.id) + '/production-preview?v=' + encodeURIComponent(result.version || 'ready');
            videoPreviewHint.textContent = '360p audition · voice + selected backing track';
          } else if (result.status === 'preparing') {
            videoPreviewPoll = setTimeout(loadProductionPicture, 2000);
          } else {
            // An unusual encode failure must not prevent music selection.
            videoPreviewHint.textContent = 'Low-res preview unavailable · using source video';
            videoEl.src = '/api/files/videos/' + encodeURIComponent(p.id);
          }
        }).catch(function () {
          if (videoEl.isConnected) videoPreviewPoll = setTimeout(loadProductionPicture, 3000);
        });
    }
    videoPreviewPoll = setTimeout(loadProductionPicture, 0);

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
    var audioPicker = document.createElement('div');
    audioPicker.className = 'upload-row-audio-picker';
    var audioPrevious = document.createElement('button');
    audioPrevious.type = 'button';
    audioPrevious.className = 'btn-secondary btn-tiny';
    audioPrevious.textContent = '←';
    audioPrevious.title = 'Previous soundtrack';
    var audioNext = document.createElement('button');
    audioNext.type = 'button';
    audioNext.className = 'btn-secondary btn-tiny';
    audioNext.textContent = '→';
    audioNext.title = 'Next soundtrack';
    var audioPreviewBtn = document.createElement('button');
    audioPreviewBtn.type = 'button';
    audioPreviewBtn.className = 'btn-secondary btn-tiny upload-row-audio-preview';
    audioPreviewBtn.textContent = 'Preview';
    var audioPreviewStatus = document.createElement('span');
    audioPreviewStatus.className = 'upload-row-audio-preview-status';
    var audioPreviewProgress = document.createElement('div');
    audioPreviewProgress.className = 'upload-row-audio-preview-progress';
    audioPreviewProgress.setAttribute('role', 'status');
    audioPreviewProgress.setAttribute('aria-live', 'polite');
    var audioPreviewSpinner = document.createElement('span');
    audioPreviewSpinner.className = 'spinner upload-row-audio-preview-spinner';
    audioPreviewSpinner.setAttribute('aria-hidden', 'true');
    audioPreviewProgress.appendChild(audioPreviewSpinner);
    audioPreviewProgress.appendChild(audioPreviewStatus);
    var previewAudio = document.createElement('audio');
    previewAudio.preload = 'auto';
    previewAudio.hidden = true;
    var previewUrls = {};
    uploadRowPreviewUrls[p.id] = previewUrls;
    var previewRequest = 0;
    var previewPlaying = false;
    var previewCompleted = 0;
    var previewFailed = 0;
    var previewCancelled = false;
    var pendingAutoPlayTrack = '';

    function updatePreviewReadiness() {
      if (previewCancelled) return;
      if (!audioTracks.length) audioPreviewStatus.textContent = 'No backing tracks are currently in the library.';
      else if (previewCompleted < audioTracks.length) {
        var selectedStillMixing = audioSelect.value && audioSelect.value !== '__none__' && !previewUrls[audioSelect.value];
        audioPreviewStatus.textContent = 'Mixing backing-audio previews ' + previewCompleted + '/' + audioTracks.length + '… ' +
          (selectedStillMixing ? 'The selected preview will unlock automatically when ready.' : 'Each preview unlocks automatically when ready.');
      }
      else audioPreviewStatus.textContent = (audioTracks.length - previewFailed) + ' soundtrack previews ready' + (previewFailed ? ' · ' + previewFailed + ' failed' : '') + '. Switching is instant.';
      var preparing = audioTracks.length > 0 && previewCompleted < audioTracks.length;
      audioPreviewSpinner.hidden = !preparing;
      audioPreviewProgress.classList.toggle('is-preparing', preparing);
      audioSection.setAttribute('aria-busy', preparing ? 'true' : 'false');
      setPreviewButtonState();
      if (pendingAutoPlayTrack && pendingAutoPlayTrack === audioSelect.value &&
          (pendingAutoPlayTrack === '__none__' || previewUrls[pendingAutoPlayTrack])) {
        var readyTrack = pendingAutoPlayTrack;
        pendingAutoPlayTrack = '';
        startSynchronizedPreview(readyTrack, true);
      }
    }

    function setPreviewButtonState() {
      var selectable = !!audioSelect.value;
      var ready = audioSelect.value === '__none__' || !!previewUrls[audioSelect.value];
      var canPreview = selectable && ready && videoReady;
      audioPreviewBtn.disabled = !canPreview;
      audioPreviewBtn.textContent = previewPlaying ? 'Stop' : (selectable && !ready ? 'Preparing…' : 'Preview');
      audioPreviewBtn.title = selectable && !ready ? 'This backing-audio mix is still being built and will unlock automatically.' : '';
      videoPreviewBtn.disabled = !canPreview;
      videoPreviewBtn.textContent = previewPlaying ? '■ Stop video' : (selectable && !ready ? 'Mixing audio…' : '▶ Preview video');
      videoPreviewBtn.title = selectable && !ready ? 'Video preview will unlock when the selected backing-audio mix is ready.' : '';
      audioPrevious.disabled = audioTracks.length < 2;
      audioNext.disabled = audioTracks.length < 2;
    }

    function stopAudioPreview(message) {
      previewRequest++;
      previewPlaying = false;
      pendingAutoPlayTrack = '';
      previewAudio.pause();
      videoEl.pause();
      videoEl.muted = true;
      setPreviewButtonState();
      if (message !== undefined) audioPreviewStatus.textContent = message;
    }

    function startSynchronizedPreview(trackId, restart) {
      var startAt = restart ? 0 : Math.max(0, Number(videoEl.currentTime) || 0);
      if (restart) videoEl.currentTime = 0;
      pendingAutoPlayTrack = '';
      previewPlaying = true;
      if (trackId === '__none__') {
        previewAudio.pause();
        videoEl.muted = false;
        setPreviewButtonState();
        audioPreviewStatus.textContent = restart ? 'Playing the original audio from the start.' : 'Playing the original audio from ' + formatPreviewClock(startAt) + '.';
        videoEl.play().catch(function () { stopAudioPreview('Press Preview to play.'); });
        return;
      }
      var previewUrl = previewUrls[trackId];
      if (previewAudio.getAttribute('src') !== previewUrl) previewAudio.src = previewUrl;
      try { previewAudio.currentTime = startAt; } catch (e) {}
      videoEl.muted = true;
      setPreviewButtonState();
      audioPreviewStatus.textContent = restart ? 'Playing from the start. Drag the timeline to audition another point.' : 'Playing from ' + formatPreviewClock(startAt) + '.';
      Promise.all([videoEl.play(), previewAudio.play()]).catch(function () {
        stopAudioPreview('Preview is ready. Press Preview to play it.');
      });
    }

    function playSelectedPreviewFromStart() {
      var trackId = audioSelect.value;
      if (!trackId) return;
      if (trackId === '__none__' || previewUrls[trackId]) {
        startSynchronizedPreview(trackId, true);
      } else {
        pendingAutoPlayTrack = trackId;
        audioPreviewStatus.textContent = 'Mixing the selected backing track… The video will start automatically when it is ready.';
        setPreviewButtonState();
      }
    }

    function prioritizeSelectedAudio() {
      var trackId = audioSelect.value;
      if (!trackId || trackId === '__none__' || previewUrls[trackId]) return;
      fetch('/api/videos/' + encodeURIComponent(p.id) + '/audio-preview-priority/' + encodeURIComponent(trackId), {
        method: 'POST', credentials: 'include'
      }).catch(function () {});
    }

    audioSelect.addEventListener('change', function () {
      stopAudioPreview('');
      p.audioTrackId = audioSelect.value;
      p.updatedAt = nowIso();
      syncTags(p);
      Store.put('pieces', p).then(refreshHead);
      prioritizeSelectedAudio();
      updatePreviewReadiness();
      playSelectedPreviewFromStart();
    });
    audioPreviewBtn.addEventListener('click', function () {
      if (previewPlaying) { stopAudioPreview(''); return; }
      var trackId = audioSelect.value;
      if (!trackId) return;
      if (trackId === '__none__' || previewUrls[trackId]) { startSynchronizedPreview(trackId, false); return; }
      audioPreviewStatus.textContent = 'This soundtrack preview is still preparing…';
    });
    videoPreviewBtn.addEventListener('click', function () {
      audioPreviewBtn.click();
    });
    function selectAdjacentTrack(offset) {
      var choices = ['__none__'].concat(audioTracks.map(function (track) { return track.id; }));
      var index = choices.indexOf(audioSelect.value);
      index = index < 0 ? 0 : (index + offset + choices.length) % choices.length;
      audioSelect.value = choices[index];
      audioSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    audioPrevious.addEventListener('click', function () { selectAdjacentTrack(-1); });
    audioNext.addEventListener('click', function () { selectAdjacentTrack(1); });
    previewAudio.addEventListener('ended', function () { stopAudioPreview('Preview finished.'); });
    videoEl.addEventListener('ended', function () { if (previewPlaying) stopAudioPreview('Preview finished.'); });
    videoEl.addEventListener('pause', function () {
      if (previewPlaying && !videoEl.ended && !videoEl.seeking) previewAudio.pause();
    });
    videoEl.addEventListener('play', function () {
      if (!previewPlaying || audioSelect.value === '__none__' || !previewAudio.src) return;
      if (Math.abs((previewAudio.currentTime || 0) - (videoEl.currentTime || 0)) > 0.2) {
        previewAudio.currentTime = videoEl.currentTime || 0;
      }
      previewAudio.play().catch(function () {});
    });
    videoEl.addEventListener('timeupdate', function () {
      updatePreviewTimeline(videoEl.currentTime);
      if (!previewPlaying || audioSelect.value === '__none__' || !previewAudio.src || videoEl.seeking) return;
      if (Math.abs((previewAudio.currentTime || 0) - (videoEl.currentTime || 0)) > 0.35) {
        try { previewAudio.currentTime = videoEl.currentTime || 0; } catch (e) {}
      }
    });
    videoEl.addEventListener('seeked', function () {
      if (!previewPlaying || audioSelect.value === '__none__' || !previewAudio.src) return;
      try { previewAudio.currentTime = videoEl.currentTime || 0; } catch (e) {}
    });
    setPreviewButtonState();
    var previewStatusTimer = null;
    function refreshPreviewStatus() {
      return fetch('/api/videos/' + encodeURIComponent(p.id) + '/audio-previews', {
        method: 'GET', credentials: 'include', cache: 'no-store'
      }).then(function (response) {
        if (!response.ok) throw new Error('Could not check soundtrack previews.');
        return response.json();
      }).then(function (body) {
        if (previewCancelled) return;
        (body.ready || []).forEach(function (ready) {
          previewUrls[ready.id] = '/api/videos/' + encodeURIComponent(p.id) + '/audio-preview/' + encodeURIComponent(ready.id) + '?v=' + encodeURIComponent(ready.version || 'ready');
        });
        previewCompleted = Object.keys(previewUrls).length;
        previewFailed = 0;
        updatePreviewReadiness();
        if (previewCompleted < audioTracks.length) previewStatusTimer = setTimeout(refreshPreviewStatus, 1200);
      }).catch(function () {
        if (previewCancelled) return;
        audioPreviewStatus.textContent = 'Backing-audio previews are still mixing in Production. Preview controls will unlock automatically.';
        audioPreviewSpinner.hidden = false;
        audioPreviewProgress.classList.add('is-preparing');
        audioSection.setAttribute('aria-busy', 'true');
        previewStatusTimer = setTimeout(refreshPreviewStatus, 2000);
      });
    }
    row._cancelAudioPreviews = function () { previewCancelled = true; clearTimeout(previewStatusTimer); clearTimeout(videoPreviewPoll); };
    updatePreviewReadiness();
    refreshPreviewStatus();
    prioritizeSelectedAudio();
    audioSection.appendChild(audioLabel);
    audioPicker.appendChild(audioPrevious);
    audioPicker.appendChild(audioSelect);
    audioPicker.appendChild(audioPreviewBtn);
    audioPicker.appendChild(audioNext);
    audioSection.appendChild(audioPicker);
    audioSection.appendChild(audioPreviewProgress);
    audioSection.appendChild(previewAudio);

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
        // Background transcription/title matching can finish while Harvey is
        // editing this field. Persist an explicit ownership marker so its
        // late suggestions can never overwrite a deliberate title choice.
        p.ytTitlesManuallyEdited = true;
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
    // Soundtrack selection belongs here for every Production video, including
    // Editor handoffs (which now arrive deliberately unselected).
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
    if (typeof row._cancelAudioPreviews === 'function') row._cancelAudioPreviews();
    row.classList.add('upload-row-removing');
    setTimeout(function () {
      if (uploadRowPreviewUrls[id]) {
        Object.keys(uploadRowPreviewUrls[id]).forEach(function (trackId) { URL.revokeObjectURL(uploadRowPreviewUrls[id][trackId]); });
        delete uploadRowPreviewUrls[id];
      }
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
    // Only In Production pieces get the editable row treatment here
    // — once a piece reaches Final Check it has its own dedicated review
    // card on the kanban board instead (§113), so showing it here too
    // would just be a redundant, stale-looking duplicate of the same
    // piece in two places.
    var inProgress = items.filter(function (p) { return p.stage === 'in_production'; }).sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });

    function swapIn(audioTracks) {
      Array.from(uploadRows.querySelectorAll('.upload-row')).forEach(function (row) {
        if (typeof row._cancelAudioPreviews === 'function') row._cancelAudioPreviews();
      });
      var oldPreviewUrls = uploadRowPreviewUrls;
      uploadRowPreviewUrls = {};
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
      Object.keys(oldPreviewUrls).forEach(function (id) {
        Object.keys(oldPreviewUrls[id]).forEach(function (trackId) { URL.revokeObjectURL(oldPreviewUrls[id][trackId]); });
      });
    }

    if (!inProgress.length) {
      swapIn([]);
    } else {
      // Building these rows only needs soundtrack ids/names. getAll() on a
      // file store downloads every full audio Blob first (30 tracks today),
      // which made Content Production look empty for a long time and was
      // especially wasteful for Editor-origin rows whose audio is locked.
      Store.getAllMetadata('audioTracks').then(swapIn);
    }

    maybeStartAnalysisPolling();
  }

  // Two server-side background jobs land here: transcribe+match analysis
  // (§111) and the final audio-splice video build (§115) — this polls
  // the handful of pieces still waiting on either and updates just their
  // own row once something changes, rather than a full
  // renderUploadLists() (which would re-fetch every other row's video
  // blob and flash the whole panel, §112). A piece whose build finished
  // (stage moved off In Production) gets the same instant-tick removal
  // animation the button itself used to fake instantly; one still in
  // In Production with a changed status (analysis landed, or a build
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
          var wasInProduction = existing && existing.stage === 'in_production';
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
            var localManualTitles = existing.ytTitlesManuallyEdited === true;
            var remoteManualTitles = r.ytTitlesManuallyEdited === true;
            ['analysisStatus', 'analysisError', 'analysisMatchedPieceId', 'transcript',
             'finalBuildStatus', 'finalBuildError', 'finalBuildProgress', 'finalBuildStep', 'stage', 'updatedAt', '_recordVersion'
            ].forEach(function (k) { if (k in r) existing[k] = r[k]; });
            // An old poll response containing generated suggestions must not
            // clobber a title currently being typed. A manual choice from the
            // server (e.g. another device) is authoritative and may merge.
            if (!localManualTitles || remoteManualTitles) {
              if ('ytTitles' in r) existing.ytTitles = r.ytTitles;
              if ('title' in r) existing.title = r.title;
            }
            if (remoteManualTitles) existing.ytTitlesManuallyEdited = true;
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
          if (wasInProduction && r.stage !== 'in_production') {
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
          stage: 'in_production', // a finished external edit bypasses the raw-footage Editor stage
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
          order: maxOrder('in_production') + 10,
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
    uploadRows.addEventListener('contextmenu', function (e) {
      var row = e.target.closest('.upload-row');
      if (!row || !row.dataset.id || !canEditPiece(pieces[row.dataset.id])) return;
      e.preventDefault();
      openUploadCtxMenu(row.dataset.id, e.clientX, e.clientY);
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
      '<section class="settings-section" id="desktopUploaderSettings">' +
        '<h3>Automatic OBS upload</h3>' +
        '<p class="settings-hint">Choose separate recording folders for your <strong>Vertical</strong> and <strong>Horizontal</strong> OBS profiles. The Windows tray app watches both, waits until OBS finishes each file, then uploads it safely into Editor. Your laptop copy is never deleted.</p>' +
        '<div class="desktop-uploader-actions">' +
          '<a class="btn-secondary" href="/downloads/reality-manual-uploader.exe">Download Windows uploader</a>' +
          '<button type="button" class="btn-secondary" id="desktopPairBtn">Generate pairing code</button>' +
          '<span class="desktop-pairing-code" id="desktopPairCode" hidden></span>' +
        '</div>' +
        '<p class="settings-hint" id="desktopPairHint">Download and run the app, then generate a one-time code here and enter it on your laptop.</p>' +
        '<div class="desktop-device-list" id="desktopDeviceList"><span class="ink-faint">Checking paired laptops…</span></div>' +
      '</section>' +
      '<section class="settings-section">' +
        '<h3>Publishing cadence</h3>' +
        '<p class="settings-hint">Every short-form piece uses one shared slot across TikTok, YouTube Shorts, Instagram and Facebook. ' +
          'TikTok remains the source of truth in Buffer; the direct platforms wait for the exact same release time. ' +
          'Longform keeps its separate rolling YouTube/Facebook timeline.</p>' +
        '<p class="settings-hint">Approved videos wait naturally in Publishing Queue. When the next slot is available, the scheduler chooses the best short-form or long-form video using topic separation, format variety and age.</p>' +
        '<div class="tiktok-schedule-block shortform-mirror-block">' +
          '<div class="cadence-label">Shared short-form schedule</div>' +
          '<div class="shortform-schedule-summary" id="directShortScheduleSummary">12:00 AM · 12:00 PM daily (Asia/Bangkok)</div>' +
          '<p class="settings-hint tiktok-schedule-note">YouTube Shorts, Instagram and Facebook automatically mirror the TikTok queue slot assigned by Buffer.</p>' +
        '</div>' +
        '<div class="cadence-grid" id="cadenceGrid"></div>' +
        '<div class="tiktok-schedule-block">' +
          '<div class="cadence-label">TikTok via Buffer <span class="ink-faint">(read-only)</span></div>' +
          '<div class="tiktok-schedule-grid" id="tiktokScheduleGrid"><span class="ink-faint">Checking Buffer schedule…</span></div>' +
          '<p class="settings-hint tiktok-schedule-note">To change these TikTok times, edit the posting schedule in Buffer. Content Studio reads them automatically.</p>' +
        '</div>' +
      '</section>' +
      '<section class="settings-section">' +
        '<h3>Ambient audio library</h3>' +
        '<p class="settings-hint">Backing tracks offered in the audio dropdown when editing an uploaded video. Loudness matching anchors the loudest sustained three-second passage actually used by the video to the selected level below dialogue, so a soft intro stays soft without an unused later build making the whole preview too quiet.</p>' +
        '<div class="ambient-mix-controls">' +
          '<div class="ambient-volume-row"><label for="audioMixModeSelect"><span>Mixing method</span><small>Loudness matched is recommended; Legacy preserves the old percentage control for comparison</small></label><select class="stage-select" id="audioMixModeSelect"><option value="loudness">Loudness matched</option><option value="legacy_percent">Legacy percentage</option></select></div>' +
          '<div id="loudnessMixSettings">' +
            '<div class="ambient-volume-row"><label for="dialogueLufsSelect"><span>Finished dialogue loudness</span><small>Integrated programme target; −16 LUFS is the spoken-video default</small></label><select class="stage-select" id="dialogueLufsSelect"></select></div>' +
            '<div class="ambient-volume-row"><label for="musicBelowDialogueSelect"><span>Music level below dialogue</span><small>Applied to the loudest sustained passage used in this video; larger negative values make music quieter</small></label><select class="stage-select" id="musicBelowDialogueSelect"></select></div>' +
            '<div class="ambient-volume-row"><label for="audioTruePeakSelect"><span>True-peak ceiling</span><small>Final safety limit after the completed mix is measured</small></label><select class="stage-select" id="audioTruePeakSelect"></select></div>' +
            '<div class="ambient-volume-row"><label for="musicDuckingToggle"><span>Gentle speech ducking</span><small>Slightly lowers music while dialogue is active</small></label><input type="checkbox" id="musicDuckingToggle"></div>' +
          '</div>' +
          '<div id="legacyMixSettings"><div class="ambient-volume-row"><label for="ambientMusicVolumeSelect"><span>Legacy background percentage</span><small>Old fixed-gain method for direct A/B comparison</small></label><select class="stage-select" id="ambientMusicVolumeSelect"></select></div></div>' +
        '</div>' +
        '<label class="btn-secondary file-btn">Upload audio<input type="file" id="audioUpload" accept="audio/*" multiple hidden /></label>' +
        '<div class="audio-upload-progress" id="audioUploadProgress"></div>' +
        '<div class="audio-list" id="audioList"></div>' +
      '</section>' +
      '<section class="settings-section">' +
        '<h3>Captions</h3>' +
        '<p class="settings-hint">One description per platform, organized by content shape — a piece can be tagged ' +
          'for several platforms at once, each getting its own independently-set caption (Final Check shows all of ' +
          'them with a toggle when there\'s more than one). Facebook and long-form YouTube publish the caption you ' +
          'choose and support an optional <code>[LINK]</code> token for the tracked store URL. Nothing is added or ' +
          'removed from Facebook automatically. YouTube Shorts, Instagram and TikTok are kept link-free.</p>' +
        '<div class="caption-group-tabs" id="captionGroupTabs">' +
          '<button type="button" class="caption-group-tab active" data-group="shortform">Short-form</button>' +
          '<button type="button" class="caption-group-tab" data-group="longform">Longform</button>' +
        '</div>' +
        '<div class="caption-group-panel" data-group="shortform" id="captionPanelShortform">' +
          '<label class="field-label">YT Shorts caption</label>' +
          '<textarea class="notes-input settings-textarea" id="caption-shortform-ytshort" placeholder="Shorts caption — no external link"></textarea>' +
          '<label class="field-label" style="margin-top:14px;display:block;">TikTok caption</label>' +
          '<textarea class="notes-input settings-textarea" id="caption-shortform-tiktok" placeholder="TikTok caption — no external link"></textarea>' +
          '<label class="field-label" style="margin-top:14px;display:block;">Instagram caption</label>' +
          '<textarea class="notes-input settings-textarea" id="caption-shortform-instagram" placeholder="Instagram caption — no external link"></textarea>' +
          '<label class="field-label" style="margin-top:14px;display:block;">Facebook caption</label>' +
          '<textarea class="notes-input settings-textarea" id="caption-shortform-facebook" placeholder="Choose your Facebook caption — [LINK] is optional"></textarea>' +
        '</div>' +
        '<div class="caption-group-panel" data-group="longform" id="captionPanelLongform" hidden>' +
          '<label class="field-label">YouTube caption</label>' +
          '<textarea class="notes-input settings-textarea" id="caption-longform-ytlong" placeholder="e.g. Grab your copy of the book here [LINK]!"></textarea>' +
          '<label class="field-label" style="margin-top:14px;display:block;">Facebook caption</label>' +
          '<textarea class="notes-input settings-textarea" id="caption-longform-facebook" placeholder="Choose your Facebook caption — [LINK] is optional"></textarea>' +
        '</div>' +
      '</section>' +
      '<section class="settings-section">' +
        '<h3>Tracked link</h3>' +
        '<p class="settings-hint">Base URL used for the optional Facebook and long-form YouTube <code>[LINK]</code>.</p>' +
        '<input class="title-input settings-input" id="baseLinkInput" />' +
      '</section>' +
      '<section class="settings-section">' +
        '<h3>Platform connections</h3>' +
        '<p class="settings-hint">YouTube publishes directly through Google. Facebook and Instagram connect directly through Meta. TikTok alone is scheduled through Buffer.</p>' +
        '<div class="platform-connect-card" id="r2StorageCard">' +
          '<div class="platform-connect-info">' +
            '<span class="platform-connect-name">Publishing storage · Cloudflare R2</span>' +
            '<span class="platform-connect-status" id="r2StorageStatus">Checking…</span>' +
          '</div>' +
          '<span class="auto-stage-badge" id="r2StorageBadge">…</span>' +
        '</div>' +
        '<div class="platform-connect-card" id="youtubeConnectCard">' +
          '<div class="platform-connect-info">' +
            '<span class="platform-connect-name">YouTube</span>' +
            '<span class="platform-connect-status" id="youtubeConnectStatus">Checking…</span>' +
          '</div>' +
          '<button type="button" class="btn-secondary btn-tiny" id="youtubeConnectBtn" disabled>…</button>' +
        '</div>' +
        '<div class="platform-connect-card" id="tiktokConnectCard">' +
          '<div class="platform-connect-info">' +
            '<span class="platform-connect-name">TikTok via Buffer</span>' +
            '<span class="platform-connect-status" id="tiktokConnectStatus">Checking…</span>' +
          '</div>' +
          '<button type="button" class="btn-secondary btn-tiny" id="tiktokConnectBtn" disabled>…</button>' +
        '</div>' +
        '<div class="platform-connect-card meta-connect-card" id="metaConnectCard">' +
          '<div class="platform-connect-info">' +
            '<span class="platform-connect-name">Facebook + Instagram · direct</span>' +
            '<span class="platform-connect-status" id="metaConnectStatus">Checking…</span>' +
          '</div>' +
          '<button type="button" class="btn-secondary btn-tiny" id="metaConnectBtn" disabled>…</button>' +
          '<div class="meta-credential-fields" id="metaCredentialFields">' +
            '<label>Meta App ID<input class="title-input settings-input" id="metaAppIdInput" inputmode="numeric" autocomplete="off" /></label>' +
            '<label>Meta App Secret<input class="title-input settings-input" id="metaAppSecretInput" type="password" autocomplete="new-password" placeholder="Not shown after saving" /></label>' +
            '<button type="button" class="btn-secondary btn-tiny" id="metaSaveCredentialsBtn">Save credentials</button>' +
            '<span class="platform-connect-status" id="metaCredentialMessage"></span>' +
          '</div>' +
          '<div class="meta-page-fields" id="metaPageFields" hidden>' +
            '<label>Publishing destination<select class="title-input settings-input" id="metaPageSelect"></select></label>' +
            '<button type="button" class="btn-secondary btn-tiny" id="metaSavePageBtn">Use this Page</button>' +
            '<span class="platform-connect-status" id="metaPageMessage"></span>' +
          '</div>' +
        '</div>' +
        '<div class="platform-connect-card meta-connect-card" id="instagramInsightsCard">' +
          '<div class="platform-connect-info">' +
            '<span class="platform-connect-name">Instagram Insights · view counts</span>' +
            '<span class="platform-connect-status" id="instagramInsightsStatus">Checking…</span>' +
          '</div>' +
          '<button type="button" class="btn-secondary btn-tiny" id="instagramInsightsConnectBtn" disabled>…</button>' +
          '<div class="meta-credential-fields">' +
            '<label>Instagram App ID<input class="title-input settings-input" id="instagramInsightsAppId" inputmode="numeric" autocomplete="off" /></label>' +
            '<label>Instagram App Secret<input class="title-input settings-input" id="instagramInsightsAppSecret" type="password" autocomplete="new-password" placeholder="Not shown after saving" /></label>' +
            '<button type="button" class="btn-secondary btn-tiny" id="instagramInsightsSaveBtn">Save Instagram credentials</button>' +
            '<span class="platform-connect-status" id="instagramInsightsMessage"></span>' +
          '</div>' +
          '<p class="settings-hint">In Meta, open <strong>Set up Instagram business login</strong> and add ' +
            '<code>https://ops.realitymanual.com/api/instagram/oauth/callback</code> under Valid OAuth Redirect URIs. ' +
            'Do not put it in the Webhooks Callback URL field. This analytics login does not change Facebook/Instagram publishing.</p>' +
        '</div>' +
      '</section>' +
      '<section class="settings-section">' +
        '<h3>API keys</h3>' +
        '<p class="settings-hint">Stored on the ops-service backend (same place as everything else here — the ' +
          'shared `settings` record), not just this browser. Publishing credentials such as Buffer and YouTube remain ' +
          'server-only and are represented by the connection cards above.</p>' +
        '<div class="key-grid" id="keyGrid"></div>' +
      '</section>' +
    '</div>';

  var KEY_FIELDS = [
    { id: 'transcriptionProvider', label: 'Transcription provider', placeholder: 'e.g. AssemblyAI, Deepgram, Whisper' },
    { id: 'transcriptionKey', label: 'Transcription API key', type: 'password' }
  ];

  // YouTube's OAuth and Buffer's server-only API key are represented by the
  // connection cards above. Neither credential belongs in this browser-side
  // settings record, so there is no duplicate plain-text field here.
  function renderR2StorageCard() {
    var card = document.getElementById('r2StorageCard');
    var statusEl = document.getElementById('r2StorageStatus');
    var badge = document.getElementById('r2StorageBadge');
    if (!card || !statusEl || !badge) return;
    if (IS_REVIEWER) { card.remove(); return; }
    fetch('/api/storage/status', { credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error('unavailable'); return r.json(); })
      .then(function (status) {
        if (status.connected) {
          var archived = Number(status.archived || 0);
          statusEl.textContent = 'Connected to ' + status.bucket + ' · ' + archived + ' scheduled file' + (archived === 1 ? '' : 's') + ' stored · released ' + status.retentionDays + ' days after publishing.';
          badge.textContent = 'Ready';
        } else if (status.configured) {
          statusEl.textContent = 'Configured, but the bucket check failed' + (status.error ? ': ' + status.error : '.');
          badge.textContent = 'Check setup';
        } else {
          statusEl.textContent = 'Not configured yet. Scheduled videos remain on the VPS until the R2 environment values are added.';
          badge.textContent = 'Setup needed';
        }
      })
      .catch(function () { statusEl.textContent = 'Storage status could not be checked.'; badge.textContent = 'Unavailable'; });
  }

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

  // TikTok scheduling now goes through Buffer. The API key stays exclusively
  // in the server environment; this card only reports whether Buffer can see
  // one usable TikTok channel.
  function renderTiktokConnectCard() {
    var statusEl = document.getElementById('tiktokConnectStatus');
    var btn = document.getElementById('tiktokConnectBtn');
    if (!statusEl || !btn) return;
    if (IS_REVIEWER) { statusEl.textContent = 'Not available for this account.'; btn.disabled = true; btn.textContent = 'N/A'; return; }
    fetch('/api/buffer/status', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        renderTiktokSchedule(s);
        if (!s) { statusEl.textContent = 'Status unavailable.'; btn.disabled = true; btn.textContent = '—'; return; }
        if (!s.configured) {
          statusEl.textContent = 'Buffer API key is not installed on the server yet.';
          btn.disabled = true;
          btn.textContent = 'Pending';
          return;
        }
        if (s.connected) {
          var activeDays = s.channel && s.channel.postingSchedule ? s.channel.postingSchedule.filter(function (day) { return !day.paused; }) : [];
          var slotCounts = activeDays.map(function (day) { return (day.times || []).length; });
          var uniformSlots = slotCounts.length && slotCounts.every(function (count) { return count === slotCounts[0]; }) ? slotCounts[0] : null;
          var scheduleNote = uniformSlots !== null
            ? ' Queue: ' + uniformSlots + ' post' + (uniformSlots === 1 ? '' : 's') + '/day' + (s.channel.timezone ? ' (' + s.channel.timezone + ')' : '') + '.'
            : ' Queue schedule is configured in Buffer.';
          var insightsNote = s.channel && s.channel.canViewInsights ? ' Performance tracking active.' : '';
          statusEl.textContent = 'Buffer can schedule to ' + ((s.channel && s.channel.displayName) || 'the connected TikTok channel') +
            (s.channel && s.channel.isQueuePaused ? ' — queue is paused.' : '.' + scheduleNote + insightsNote);
          btn.textContent = 'Connected';
          btn.disabled = true;
        } else {
          statusEl.textContent = s.reason || 'No usable TikTok channel is connected in Buffer.';
          btn.textContent = 'Check Buffer';
          btn.disabled = true;
        }
      })
      .catch(function () { statusEl.textContent = 'Status unavailable.'; renderTiktokSchedule(null); });
  }

  function renderTiktokSchedule(status) {
    var grid = document.getElementById('tiktokScheduleGrid');
    var directSummary = document.getElementById('directShortScheduleSummary');
    if (!grid) return;
    var days = status && status.connected && status.channel ? (status.channel.postingSchedule || []) : [];
    if (!days.length) {
      grid.innerHTML = '<span class="ink-faint">Buffer schedule unavailable.</span>';
      if (directSummary) directSummary.textContent = '12:00 AM · 12:00 PM daily (Asia/Bangkok fallback)';
      return;
    }
    var labels = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
    grid.innerHTML = days.map(function (day) {
      var times = day.paused ? ['Paused'] : (day.times || []);
      return '<div class="tiktok-schedule-day"><strong>' + (labels[day.day] || escapeHtml(day.day)) + '</strong>' +
        '<span>' + times.map(function (time) { return escapeHtml(time); }).join(' · ') + '</span></div>';
    }).join('') + '<div class="tiktok-schedule-zone">Timezone: ' + escapeHtml(status.channel.timezone || 'Buffer account') + '</div>';
    if (directSummary) {
      var active = days.filter(function (day) { return !day.paused; });
      var firstTimes = active.length ? (active[0].times || []) : [];
      var uniform = active.length && active.every(function (day) {
        return JSON.stringify(day.times || []) === JSON.stringify(firstTimes);
      });
      directSummary.textContent = uniform
        ? firstTimes.join(' · ') + ' daily (' + (status.channel.timezone || 'Buffer timezone') + ')'
        : 'Mirrors each day’s Buffer slots (' + (status.channel.timezone || 'Buffer timezone') + ')';
    }
  }

  function renderMetaConnectCard() {
    var statusEl = document.getElementById('metaConnectStatus');
    var btn = document.getElementById('metaConnectBtn');
    var appIdInput = document.getElementById('metaAppIdInput');
    var secretInput = document.getElementById('metaAppSecretInput');
    var saveBtn = document.getElementById('metaSaveCredentialsBtn');
    var message = document.getElementById('metaCredentialMessage');
    var pageFields = document.getElementById('metaPageFields');
    var pageSelect = document.getElementById('metaPageSelect');
    var pageSaveBtn = document.getElementById('metaSavePageBtn');
    var pageMessage = document.getElementById('metaPageMessage');
    if (!statusEl || !btn || !saveBtn) return;
    if (IS_REVIEWER) {
      statusEl.textContent = 'Not available for this account.';
      btn.disabled = saveBtn.disabled = appIdInput.disabled = secretInput.disabled = true;
      btn.textContent = 'N/A';
      return;
    }
    fetch('/api/meta/status', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('status')); })
      .then(function (s) {
        appIdInput.value = s.appId || '';
        secretInput.value = '';
        secretInput.placeholder = s.hasAppSecret ? 'Saved securely · enter only to replace' : 'Paste Meta App Secret';
        statusEl.textContent = s.connected
          ? 'Connected to ' + ((s.page && s.page.name) || 'Facebook') + (s.instagram ? ' and @' + (s.instagram.username || s.instagram.id) : '; no linked professional Instagram account found.')
          : (s.authorized ? 'Meta authorized. Choose the Page this app should publish to.' : (s.configured ? 'Credentials saved. Connect your Meta accounts.' : 'Save the App ID and App Secret, then connect.'));
        btn.disabled = !s.configured;
        btn.textContent = s.authorized ? 'Disconnect' : 'Connect';
        btn.onclick = s.authorized ? function () {
          btn.disabled = true;
          fetch('/api/meta/disconnect', { method: 'POST', credentials: 'include' }).then(renderMetaConnectCard);
        } : function () { window.location.href = '/api/meta/oauth/start'; };
        pageFields.hidden = !s.authorized;
        if (s.authorized) {
          pageMessage.textContent = 'Loading available Pages…';
          fetch('/api/meta/pages', { credentials: 'include' })
            .then(function (r) { return r.json().then(function (body) { if (!r.ok) throw new Error(body.error || 'Could not load Pages.'); return body; }); })
            .then(function (body) {
              pageSelect.innerHTML = (body.pages || []).map(function (page) {
                var linked = page.instagram ? ' · @' + (page.instagram.username || page.instagram.id) : ' · no linked Instagram';
                var portfolio = page.business ? ' · ' + page.business + ' portfolio' : '';
                return '<option value="' + escapeHtml(page.id) + '"' + (page.id === body.selectedPageId ? ' selected' : '') + '>' + escapeHtml(page.name + portfolio + linked) + '</option>';
              }).join('');
              pageSaveBtn.disabled = !(body.pages || []).length;
              pageMessage.textContent = (body.pages || []).length ? 'Choose explicitly; the app will never guess between Pages.' : 'No Pages are available to this authorization.';
            }).catch(function (error) { pageMessage.textContent = error.message; pageSaveBtn.disabled = true; });
          pageSaveBtn.onclick = function () {
            pageSaveBtn.disabled = true;
            pageMessage.textContent = 'Saving destination…';
            fetch('/api/meta/page', {
              method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pageId: pageSelect.value })
            }).then(function (r) { return r.json().then(function (body) { if (!r.ok) throw new Error(body.error || 'Could not select Page.'); }); })
              .then(renderMetaConnectCard)
              .catch(function (error) { pageMessage.textContent = error.message; pageSaveBtn.disabled = false; });
          };
        }
        saveBtn.onclick = function () {
          message.textContent = 'Saving…';
          saveBtn.disabled = true;
          fetch('/api/meta/config', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appId: appIdInput.value.trim(), appSecret: secretInput.value })
          }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (body) { if (!r.ok) throw new Error(body.error || 'Could not save credentials.'); });
          }).then(function () { message.textContent = 'Saved.'; renderMetaConnectCard(); })
            .catch(function (error) { message.textContent = error.message; })
            .finally(function () { saveBtn.disabled = false; });
        };
      })
      .catch(function () { statusEl.textContent = 'Status unavailable.'; btn.disabled = true; });
  }

  function renderInstagramInsightsCard() {
    var card = document.getElementById('instagramInsightsCard');
    if (!card) return;
    if (IS_REVIEWER) { card.remove(); return; }
    var status = document.getElementById('instagramInsightsStatus');
    var button = document.getElementById('instagramInsightsConnectBtn');
    var appId = document.getElementById('instagramInsightsAppId');
    var secret = document.getElementById('instagramInsightsAppSecret');
    var save = document.getElementById('instagramInsightsSaveBtn');
    var message = document.getElementById('instagramInsightsMessage');
    fetch('/api/instagram/insights/status', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('Status unavailable.')); })
      .then(function (data) {
        appId.value = data.appId || '';
        secret.value = '';
        secret.placeholder = data.hasAppSecret ? 'Saved securely · enter only to replace' : 'Paste Instagram App Secret';
        status.textContent = data.connected
          ? 'Connected to @' + (data.username || 'Instagram') + ' for analytics.'
          : (data.configured ? 'Credentials saved. Connect Instagram to retrieve Reel views.' :
            'Use the Instagram App ID and Secret shown in Business Login setup.');
        button.disabled = !data.configured;
        button.textContent = data.connected ? 'Disconnect insights' : 'Connect insights';
        button.onclick = data.connected ? function () {
          button.disabled = true;
          fetch('/api/instagram/insights/disconnect', { method: 'POST', credentials: 'include' })
            .then(renderInstagramInsightsCard).catch(function () { status.textContent = 'Could not disconnect Instagram Insights.'; button.disabled = false; });
        } : function () { window.location.href = '/api/instagram/oauth/start'; };
        save.onclick = function () {
          save.disabled = true;
          message.textContent = 'Saving…';
          fetch('/api/instagram/insights/config', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appId: appId.value.trim(), appSecret: secret.value })
          }).then(function (r) { return r.json().then(function (body) {
            if (!r.ok) throw new Error(body.error || 'Could not save Instagram credentials.');
          }); }).then(function () { message.textContent = 'Saved.'; renderInstagramInsightsCard(); })
            .catch(function (error) { message.textContent = error.message; })
            .finally(function () { save.disabled = false; });
        };
      }).catch(function (error) { status.textContent = error.message; button.disabled = true; });
  }

  var settingsCache = null;
  var settingsSaveTimer = null;

  function saveSettingsDebounced() {
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = setTimeout(function () { Store.saveSettings(settingsCache); }, 400);
  }

  function renderCadenceGrid() {
    var grid = document.getElementById('cadenceGrid');
    if (!grid) return;
    var dis = IS_REVIEWER ? ' disabled' : '';
    grid.innerHTML = '<div class="cadence-row" data-key="longform">' +
      '<span class="cadence-label">Direct longform <span class="ink-faint">(YouTube / Facebook)</span></span>' +
      '<span class="cadence-inputs">First video at the next <input type="time" class="cadence-time" id="longformScheduleTime" value="' +
        escapeHtml(settingsCache.longformScheduleTime || '07:55') + '"' + dis + ' /> <span>Asia/Bangkok, then every 3 days</span></span>' +
    '</div>';
    var timeInput = document.getElementById('longformScheduleTime');
    timeInput.addEventListener('change', function () {
      settingsCache.longformScheduleTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(timeInput.value) ? timeInput.value : '07:55';
      settingsCache.cadence.longform = { every: 3, unit: 'days' };
      timeInput.value = settingsCache.longformScheduleTime;
      saveSettingsDebounced();
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
        var url = t.blob instanceof Blob ? URL.createObjectURL(t.blob) : '';
        if (url) audioListObjectUrls.push(url);
        var note = t.note || '';
        return '<div class="audio-row" data-id="' + escapeHtml(t.id) + '" title="' + escapeHtml(note) + '">' +
          '<div class="audio-track-meta">' +
            '<label>Name<input class="title-input audio-track-name" value="' + escapeHtml(t.name || '') + '"' + (IS_REVIEWER ? ' disabled' : '') + ' /></label>' +
            '<label>Use note <span class="audio-note-tip" title="' + escapeHtml(note || 'Add a note such as: Good for reflective, slower videos.') + '">ⓘ</span><input class="title-input audio-track-note" value="' + escapeHtml(note) + '" placeholder="Good for reflective, slower videos…"' + (IS_REVIEWER ? ' disabled' : '') + ' /></label>' +
          '</div>' +
          (url ? '<audio controls preload="none" src="' + url + '"></audio>' : '<span class="audio-upload-error">Audio file unavailable</span>') +
          // Ambient-library management (add/remove tracks) is admin-only —
          // a reviewer can still freely pick from existing tracks in
          // Content Production's audio dropdown, just can't change the
          // library itself.
          (IS_REVIEWER ? '' : '<div class="audio-track-actions"><button type="button" class="btn-secondary btn-tiny audio-save" data-id="' + escapeHtml(t.id) + '">Save</button><button type="button" class="link-btn audio-delete" data-id="' + escapeHtml(t.id) + '">Delete</button></div>') +
        '</div>';
      }).join('');
      list.querySelectorAll('.audio-save').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var row = btn.closest('.audio-row');
          var track = tracks.find(function (candidate) { return candidate.id === btn.dataset.id; });
          if (!row || !track) return;
          var name = row.querySelector('.audio-track-name').value.trim();
          var note = row.querySelector('.audio-track-note').value.trim();
          btn.disabled = true;
          Store.put('audioTracks', {
            id: track.id,
            name: name || track.name || 'Untitled track',
            note: note,
            createdAt: track.createdAt,
            mimeType: track.mimeType
          }).then(renderAudioList).catch(function () {
            btn.disabled = false;
            btn.textContent = 'Could not save';
          });
        });
      });
      list.querySelectorAll('.audio-delete').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var track = tracks.find(function (candidate) { return candidate.id === btn.dataset.id; });
          if (!window.confirm('Delete "' + ((track && track.name) || 'this track') + '"?')) return;
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

  function renderDesktopUploaderSettings() {
    var section = document.getElementById('desktopUploaderSettings');
    if (!section) return;
    if (IS_REVIEWER) { section.remove(); return; }
    var list = document.getElementById('desktopDeviceList');
    var pairButton = document.getElementById('desktopPairBtn');
    var pairCode = document.getElementById('desktopPairCode');
    var pairHint = document.getElementById('desktopPairHint');
    function refreshDevices() {
      return fetch('/api/desktop-uploader/devices', { credentials: 'include' }).then(function (response) {
        if (!response.ok) throw new Error('Could not load paired laptops.');
        return response.json();
      }).then(function (result) {
        var devices = (result.devices || []).filter(function (device) { return !device.revokedAt; });
        if (!devices.length) { list.innerHTML = '<span class="ink-faint">No laptop paired yet.</span>'; return; }
        list.innerHTML = devices.map(function (device) {
          var state = device.status || 'offline';
          var detail = state === 'uploading'
            ? 'Uploading ' + (device.currentFileName || 'recording') + ' · ' + Math.round(device.uploadProgress || 0) + '%'
            : state.charAt(0).toUpperCase() + state.slice(1) + (device.queuedCount ? ' · ' + device.queuedCount + ' queued' : '');
          if (device.errorMessage) detail += ' · ' + device.errorMessage;
          return '<div class="desktop-device-row"><div class="desktop-device-main"><strong>' + escapeHtml(device.name || 'Windows laptop') + '</strong><span>' + escapeHtml(detail) + '</span></div>' +
            '<button type="button" class="btn-secondary btn-tiny" data-revoke-device="' + escapeHtml(device.id) + '">Revoke</button></div>';
        }).join('');
        list.querySelectorAll('[data-revoke-device]').forEach(function (button) {
          button.addEventListener('click', function () {
            if (!confirm('Disconnect this laptop uploader?')) return;
            fetch('/api/desktop-uploader/devices/' + encodeURIComponent(button.dataset.revokeDevice), { method: 'DELETE', credentials: 'include' }).then(refreshDevices);
          });
        });
      }).catch(function (error) { list.textContent = error.message; });
    }
    pairButton.addEventListener('click', function () {
      pairButton.disabled = true;
      fetch('/api/desktop-uploader/pairing-code', { method: 'POST', credentials: 'include' }).then(function (response) {
        if (!response.ok) throw new Error('Could not create a pairing code.');
        return response.json();
      }).then(function (result) {
        pairCode.hidden = false;
        pairCode.textContent = result.code;
        pairHint.textContent = 'Enter this code in the Windows app within 10 minutes. It can only be used once.';
      }).catch(function (error) { pairHint.textContent = error.message; }).finally(function () { pairButton.disabled = false; });
    });
    refreshDevices();
  }

  function bootSettings() {
    Store.getSettings().then(function (settings) {
      // The user may leave Settings while this request is in flight. The
      // shared panel has already been replaced in that case, so none of the
      // Settings renderers should write into the next tool's DOM.
      if (!document.getElementById('cadenceGrid')) return;
      settingsCache = settings;
      renderCadenceGrid();
      renderAudioList();
      renderKeyGrid();
      renderDesktopUploaderSettings();
      renderR2StorageCard();
      renderYoutubeConnectCard();
      renderTiktokConnectCard();
      renderMetaConnectCard();
      renderInstagramInsightsCard();

      var audioMixModeSelect = document.getElementById('audioMixModeSelect');
      var dialogueLufsSelect = document.getElementById('dialogueLufsSelect');
      var musicBelowDialogueSelect = document.getElementById('musicBelowDialogueSelect');
      var audioTruePeakSelect = document.getElementById('audioTruePeakSelect');
      var musicDuckingToggle = document.getElementById('musicDuckingToggle');
      var ambientMusicVolumeSelect = document.getElementById('ambientMusicVolumeSelect');
      dialogueLufsSelect.innerHTML = [-18, -17, -16, -15, -14].map(function (value) {
        return '<option value="' + value + '">' + value + ' LUFS</option>';
      }).join('');
      musicBelowDialogueSelect.innerHTML = Array.from({ length: 11 }, function (_, index) {
        var value = index + 15;
        return '<option value="' + value + '">−' + value + ' dB</option>';
      }).join('');
      audioTruePeakSelect.innerHTML = [-3, -2.5, -2, -1.5, -1].map(function (value) {
        return '<option value="' + value + '">' + value + ' dBTP</option>';
      }).join('');
      ambientMusicVolumeSelect.innerHTML = Array.from({ length: 26 }, function (_, index) {
        var percent = index + 5;
        return '<option value="' + percent + '">' + percent + '%</option>';
      }).join('');
      audioMixModeSelect.value = settings.audioMixMode || 'loudness';
      dialogueLufsSelect.value = String(settings.dialogueLufsTarget == null ? -16 : settings.dialogueLufsTarget);
      musicBelowDialogueSelect.value = String(settings.musicBelowDialogueDb || 20);
      audioTruePeakSelect.value = String(settings.audioTruePeakDbtp == null ? -1.5 : settings.audioTruePeakDbtp);
      musicDuckingToggle.checked = settings.musicDuckingEnabled === true;
      ambientMusicVolumeSelect.value = String(settings.ambientMusicVolumePercent || 10);
      [audioMixModeSelect, dialogueLufsSelect, musicBelowDialogueSelect, audioTruePeakSelect, musicDuckingToggle, ambientMusicVolumeSelect].forEach(function (control) { control.disabled = IS_REVIEWER; });
      function showMixMethod() {
        document.getElementById('loudnessMixSettings').hidden = audioMixModeSelect.value !== 'loudness';
        document.getElementById('legacyMixSettings').hidden = audioMixModeSelect.value !== 'legacy_percent';
      }
      showMixMethod();
      audioMixModeSelect.addEventListener('change', function () {
        settingsCache.audioMixMode = audioMixModeSelect.value === 'legacy_percent' ? 'legacy_percent' : 'loudness';
        showMixMethod(); saveSettingsDebounced();
      });
      dialogueLufsSelect.addEventListener('change', function () {
        settingsCache.dialogueLufsTarget = Math.max(-18, Math.min(-14, parseInt(dialogueLufsSelect.value, 10) || -16));
        saveSettingsDebounced();
      });
      musicBelowDialogueSelect.addEventListener('change', function () {
        settingsCache.musicBelowDialogueDb = Math.max(15, Math.min(25, parseInt(musicBelowDialogueSelect.value, 10) || 20));
        saveSettingsDebounced();
      });
      audioTruePeakSelect.addEventListener('change', function () {
        settingsCache.audioTruePeakDbtp = Math.max(-3, Math.min(-1, parseFloat(audioTruePeakSelect.value) || -1.5));
        saveSettingsDebounced();
      });
      musicDuckingToggle.addEventListener('change', function () {
        settingsCache.musicDuckingEnabled = musicDuckingToggle.checked;
        saveSettingsDebounced();
      });
      ambientMusicVolumeSelect.addEventListener('change', function () {
        settingsCache.ambientMusicVolumePercent = Math.max(5, Math.min(30, parseInt(ambientMusicVolumeSelect.value, 10) || 10));
        saveSettingsDebounced();
      });

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
