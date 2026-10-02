// Privacy controls for consent-free aggregate site statistics and optional
// advertising tags. Basic first-party statistics default on under the UK
// statistical-purpose exception and always have a simple footer opt-out.
// Advertising remains off until an explicit opt-in and is not even prompted
// for while no Meta/Google advertising identifier is configured.
(function () {
  'use strict';

  var STORAGE_KEY = 'rm_privacy_choices_v2';
  var LEGACY_KEY = 'rm_privacy_consent_v1';
  var listeners = [];
  var config = window.RM_CONFIG || {};
  var advertisingConfigured = /^\d{5,40}$/.test(String(config.META_PIXEL_ID || '')) ||
    /^AW-\d{5,30}$/.test(String(config.GOOGLE_ADS_ID || ''));
  var state = read();

  function defaults() {
    return {
      version: 2,
      necessary: true,
      analytics: true,
      advertising: false,
      advertisingDecided: false,
      updatedAt: ''
    };
  }

  function read() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (parsed && parsed.version === 2) {
        return {
          version: 2,
          necessary: true,
          analytics: parsed.analytics !== false,
          advertising: parsed.advertising === true,
          advertisingDecided: parsed.advertisingDecided === true,
          updatedAt: parsed.updatedAt || ''
        };
      }

      // Preserve choices made through the brief v1 consent panel. Someone
      // who rejected analytics remains opted out; no preference is reset.
      var legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
      if (legacy && legacy.version === 1) {
        return {
          version: 2,
          necessary: true,
          analytics: legacy.analytics === true,
          advertising: legacy.advertising === true,
          advertisingDecided: true,
          updatedAt: legacy.updatedAt || ''
        };
      }
    } catch (error) {}
    return defaults();
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (error) {}
  }

  function notify() {
    listeners.slice().forEach(function (listener) {
      try { listener(state); } catch (error) {}
    });
    try { window.dispatchEvent(new CustomEvent('rm:consent', { detail: state })); } catch (error) {}
  }

  function save(analytics, advertising, advertisingDecided) {
    state = {
      version: 2,
      necessary: true,
      analytics: analytics !== false,
      advertising: advertisingConfigured && advertising === true,
      advertisingDecided: advertisingConfigured && advertisingDecided === true,
      updatedAt: new Date().toISOString()
    };
    persist();
    hidePanels();
    notify();
  }

  function allows(category) {
    return !!(state && state[category] === true);
  }

  function onChange(listener) {
    if (typeof listener !== 'function') return function () {};
    listeners.push(listener);
    listener(state);
    return function () {
      listeners = listeners.filter(function (item) { return item !== listener; });
    };
  }

  function hidePanels() {
    var banner = document.getElementById('privacy-consent-banner');
    var choices = document.getElementById('privacy-consent-choices');
    if (banner) banner.hidden = true;
    if (choices) choices.hidden = true;
  }

  function openChoices() {
    var banner = document.getElementById('privacy-consent-banner');
    var choices = document.getElementById('privacy-consent-choices');
    if (!choices) return;
    if (banner) banner.hidden = true;
    choices.hidden = false;
    choices.querySelector('#privacy-analytics').checked = state.analytics !== false;
    var advertising = choices.querySelector('#privacy-advertising');
    if (advertising) advertising.checked = state.advertising === true;
    choices.querySelector('#privacy-analytics').focus();
  }

  function mount() {
    if (!document.body || document.getElementById('privacy-consent-banner')) return;
    var showAdvertisingPrompt = advertisingConfigured && !state.advertisingDecided;
    var advertisingChoice = advertisingConfigured
      ? '<label><span><b>Advertising</b><small>Optional Meta and Google tags for campaign measurement and retargeting. Off unless you allow it.</small></span><input type="checkbox" id="privacy-advertising"></label>'
      : '';
    var root = document.createElement('div');
    root.innerHTML =
      '<section class="privacy-consent" id="privacy-consent-banner" role="dialog" aria-label="Optional advertising"' + (showAdvertisingPrompt ? '' : ' hidden') + '>' +
        '<div><strong>Optional advertising</strong><p>May we use Meta or Google tags to measure campaigns and show relevant ads? The shop works normally if you say no. <a href="privacy.html">Learn more</a>.</p></div>' +
        '<div class="privacy-consent__actions"><button type="button" data-consent="reject-ads">No thanks</button><button type="button" data-consent="choose">Choose</button><button type="button" class="privacy-consent__primary" data-consent="accept-ads">Allow advertising</button></div>' +
      '</section>' +
      '<section class="privacy-consent privacy-consent--choices" id="privacy-consent-choices" role="dialog" aria-modal="true" aria-label="Privacy choices" hidden>' +
        '<strong>Privacy choices</strong>' +
        '<p>Anonymous site statistics help us improve the shop and are aggregated daily. You can opt out here at any time.</p>' +
        '<label><span><b>Site statistics</b><small>First-party page and checkout-funnel totals. No advertising provider receives them.</small></span><input type="checkbox" id="privacy-analytics"></label>' +
        advertisingChoice +
        '<div class="privacy-consent__actions"><button type="button" data-consent="cancel">Cancel</button><button type="button" class="privacy-consent__primary" data-consent="save">Save choices</button></div>' +
      '</section>';
    while (root.firstChild) document.body.appendChild(root.firstChild);

    document.addEventListener('click', function (event) {
      var action = event.target && event.target.getAttribute('data-consent');
      if (!action) return;
      if (action === 'accept-ads') save(state.analytics, true, true);
      if (action === 'reject-ads') save(state.analytics, false, true);
      if (action === 'choose') openChoices();
      if (action === 'cancel') hidePanels();
      if (action === 'save') {
        var advertising = document.getElementById('privacy-advertising');
        save(
          document.getElementById('privacy-analytics').checked,
          advertising ? advertising.checked : false,
          !!advertising
        );
      }
    });

    document.querySelectorAll('.footer-links').forEach(function (footer) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'privacy-choices-link';
      button.textContent = 'Privacy choices';
      button.addEventListener('click', openChoices);
      footer.appendChild(button);
    });
  }

  window.RMConsent = {
    current: function () { return state; },
    allows: allows,
    onChange: onChange,
    open: openChoices,
    advertisingConfigured: function () { return advertisingConfigured; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
