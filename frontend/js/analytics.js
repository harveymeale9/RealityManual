// First-party analytics tracker — see CLAUDE.md §31-34. No third-party
// scripts, no blocking. Every call is wrapped so a network failure or a
// missing backend can never break the page it's called from.
window.RMAnalytics = (function () {
  var API_BASE_URL = (window.RM_CONFIG && window.RM_CONFIG.API_BASE_URL) || '';
  var SESSION_KEY = 'rm_session_id';
  var ATTRIBUTION_KEY = 'rm_attribution';

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

  function track(eventName, extra) {
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

  track('page_view');

  return { track: track };
})();
