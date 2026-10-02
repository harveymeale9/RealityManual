// Consent-gated Meta Pixel and Google Ads remarketing adapters.
// Public platform IDs live in config.js; no customer PII is supplied.
(function () {
  'use strict';

  var config = window.RM_CONFIG || {};
  var metaId = /^\d{5,40}$/.test(String(config.META_PIXEL_ID || '')) ? String(config.META_PIXEL_ID) : '';
  var googleId = /^AW-\d{5,30}$/.test(String(config.GOOGLE_ADS_ID || '')) ? String(config.GOOGLE_ADS_ID) : '';
  var googlePurchaseLabel = /^[\w-]{3,100}$/.test(String(config.GOOGLE_ADS_PURCHASE_LABEL || ''))
    ? String(config.GOOGLE_ADS_PURCHASE_LABEL) : '';
  var pending = [];
  var started = false;

  function advertisingAllowed() {
    return !!(window.RMConsent && window.RMConsent.allows('advertising'));
  }

  function anyConfigured() { return !!(metaId || googleId); }

  function start() {
    if (started || !advertisingAllowed() || !anyConfigured()) return;
    started = true;

    if (metaId) {
      /* Meta's official base loader, deferred until affirmative consent. */
      !function (f, b, e, v, n, t, s) {
        if (f.fbq) return;
        n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
        if (!f._fbq) f._fbq = n;
        n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
        t = b.createElement(e); t.async = true; t.src = v;
        s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
      }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
      window.fbq('init', metaId);
      window.fbq('track', 'PageView');
    }

    if (googleId) {
      window.dataLayer = window.dataLayer || [];
      window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
      window.gtag('js', new Date());
      window.gtag('config', googleId);
      var tag = document.createElement('script');
      tag.async = true;
      tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(googleId);
      document.head.appendChild(tag);
    }

    var queued = pending.slice();
    pending = [];
    queued.forEach(send);
  }

  function googleEventName(name) {
    if (name === 'ViewContent') return 'view_item';
    if (name === 'InitiateCheckout') return 'begin_checkout';
    if (name === 'Purchase') return 'purchase';
    return name;
  }

  function sentKey(entry) {
    return entry.orderId ? 'rm_marketing_purchase_' + entry.orderId : '';
  }

  function alreadySent(entry) {
    var key = sentKey(entry);
    if (!key) return false;
    try { return localStorage.getItem(key) === '1'; } catch (error) { return false; }
  }

  function markSent(entry) {
    var key = sentKey(entry);
    if (!key) return;
    try { localStorage.setItem(key, '1'); } catch (error) {}
  }

  function send(entry) {
    if (!advertisingAllowed() || !anyConfigured() || alreadySent(entry)) return;
    if (metaId && window.fbq) {
      if (entry.orderId) window.fbq('track', entry.name, entry.params, { eventID: 'purchase_' + entry.orderId });
      else window.fbq('track', entry.name, entry.params);
    }
    if (googleId && window.gtag) {
      var params = Object.assign({}, entry.params);
      if (entry.name === 'Purchase' && googlePurchaseLabel) params.send_to = googleId + '/' + googlePurchaseLabel;
      window.gtag('event', googleEventName(entry.name), params);
    }
    markSent(entry);
  }

  function track(name, params, orderId) {
    var entry = { name: String(name || ''), params: params || {}, orderId: orderId || '' };
    if (!entry.name || alreadySent(entry)) return;
    var consent = window.RMConsent && window.RMConsent.current();
    if (!consent) {
      pending.push(entry);
      return;
    }
    if (!consent.advertising) return;
    start();
    send(entry);
  }

  if (window.RMConsent) {
    window.RMConsent.onChange(function (consent) {
      if (!consent) return;
      if (!consent.advertising) {
        pending = [];
        return;
      }
      start();
    });
  }

  window.RMMarketing = {
    track: track,
    configured: function () { return { meta: !!metaId, google: !!googleId }; }
  };
})();
