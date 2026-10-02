// First-party aggregate site statistics — see CLAUDE.md §31-34/§456.
// Independent from Meta advertising events and delayed until trustworthy
// human browser evidence exists.
// Every call is wrapped so a network failure or missing backend can never
// break the page that fired it.
window.RMAnalytics = (function () {
  var API_BASE_URL = (window.RM_CONFIG && window.RM_CONFIG.API_BASE_URL) || '';
  var SESSION_KEY = 'rm_session_id';
  var ATTRIBUTION_KEY = 'rm_attribution';
  var INTERNAL_KEY = 'rm_analytics_internal_v1';
  var pending = [];
  var humanVerified = false;
  var verificationMethod = '';
  var verificationSent = false;

  // Opening ?rm_internal=1 once disables analytics for this browser. The
  // private dashboard links here so Harvey's own checks stay out of reports.
  // ?rm_internal=0 reverses it.
  try {
    var internalParam = new URLSearchParams(window.location.search).get('rm_internal');
    if (internalParam === '1') localStorage.setItem(INTERNAL_KEY, '1');
    if (internalParam === '0') localStorage.removeItem(INTERNAL_KEY);
    if (internalParam !== null && window.history && window.history.replaceState) {
      var cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('rm_internal');
      window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
    }
  } catch (e) {}

  function isInternal() {
    try { return localStorage.getItem(INTERNAL_KEY) === '1'; } catch (e) { return false; }
  }

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // One id per browser, kept in localStorage rather than sessionStorage —
  // "session" here means "this visitor", not "this tab"; the funnel needs
  // to survive a landing-page visit today and a checkout tomorrow.
  function getSessionId() {
    try {
      var id = localStorage.getItem(SESSION_KEY);
      if (!id) {
        id = uuid();
        localStorage.setItem(SESSION_KEY, id);
      }
      return id;
    } catch (e) {
      return 'no-storage-' + Math.random().toString(16).slice(2);
    }
  }

  // First-touch attribution: captured once (whatever UTM params/referrer
  // brought this visitor in first), then reused on every later page/event
  // so a purchase two days later still credits the original campaign.
  function getAttribution() {
    try {
      var raw = localStorage.getItem(ATTRIBUTION_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}

    var params = new URLSearchParams(window.location.search);
    var attribution = {
      utm_source: params.get('utm_source') || '',
      utm_medium: params.get('utm_medium') || '',
      utm_campaign: params.get('utm_campaign') || '',
      utm_term: params.get('utm_term') || '',
      utm_content: params.get('utm_content') || '',
      referrer: document.referrer || '',
    };
    try { localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(attribution)); } catch (e) {}
    return attribution;
  }

  function send(eventName, extra) {
    if (!API_BASE_URL) return;
    try {
      var attribution = getAttribution();
      var payload = {
        session_id: getSessionId(),
        event_name: eventName,
        page: window.location.pathname,
        referrer: attribution.referrer,
        utm_source: attribution.utm_source,
        utm_medium: attribution.utm_medium,
        utm_campaign: attribution.utm_campaign,
        utm_term: attribution.utm_term,
        utm_content: attribution.utm_content,
        human_verified: humanVerified,
        human_verification: verificationMethod,
      };
      if (extra) {
        Object.keys(extra).forEach(function (k) { payload[k] = extra[k]; });
      }

      fetch(API_BASE_URL + '/api/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(function () {});
    } catch (e) {
      // Analytics must never break the page it's called from.
    }
  }

  function track(eventName, extra) {
    if (isInternal()) return;
    if (!humanVerified) {
      pending.push([eventName, extra]);
      return;
    }
    send(eventName, extra);
  }

  function flush() {
    if (isInternal() || !humanVerified) return;
    if (!verificationSent) {
      verificationSent = true;
      send('human_verified');
    }
    var queued = pending.slice();
    pending = [];
    queued.forEach(function (event) { send(event[0], event[1]); });
  }

  function markHuman(method) {
    if (humanVerified) return;
    humanVerified = true;
    verificationMethod = method;
    flush();
  }

  ['pointerdown', 'keydown', 'touchstart'].forEach(function (eventName) {
    window.addEventListener(eventName, function (event) {
      if (event.isTrusted !== false) markHuman('interaction');
    }, { capture: true, once: true, passive: true });
  });
  window.addEventListener('scroll', function (event) {
    if (event.isTrusted !== false) markHuman('interaction');
  }, { capture: true, once: true, passive: true });
  window.setTimeout(function () {
    if (document.visibilityState === 'visible' && document.hasFocus()) markHuman('visible_time');
  }, 7000);

  track('page_view');

  return { track: track };
})();
