// Privacy choices for optional analytics and advertising storage.
// Advertising/analytics code must ask RMConsent before doing any work.
(function () {
  'use strict';

  var STORAGE_KEY = 'rm_privacy_consent_v1';
  var listeners = [];
  var state = read();

  function read() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!parsed || parsed.version !== 1) return null;
      return {
        version: 1,
        necessary: true,
        analytics: parsed.analytics === true,
        advertising: parsed.advertising === true,
        updatedAt: parsed.updatedAt || ''
      };
    } catch (error) {
      return null;
    }
  }

  function notify() {
    listeners.slice().forEach(function (listener) {
      try { listener(state); } catch (error) {}
    });
    try { window.dispatchEvent(new CustomEvent('rm:consent', { detail: state })); } catch (error) {}
  }

  function save(analytics, advertising) {
    state = {
      version: 1,
      necessary: true,
      analytics: analytics === true,
      advertising: advertising === true,
      updatedAt: new Date().toISOString()
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (error) {}
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
    choices.querySelector('#privacy-analytics').checked = !!(state && state.analytics);
    choices.querySelector('#privacy-advertising').checked = !!(state && state.advertising);
    choices.querySelector('#privacy-analytics').focus();
  }

  function mount() {
    if (!document.body || document.getElementById('privacy-consent-banner')) return;
    var root = document.createElement('div');
    root.innerHTML =
      '<section class="privacy-consent" id="privacy-consent-banner" role="dialog" aria-label="Privacy choices"' + (state ? ' hidden' : '') + '>' +
        '<div><strong>Your privacy choices</strong><p>We use optional analytics to improve the shop and, with your permission, advertising tags to measure campaigns and show relevant Reality Manual ads. <a href="privacy.html">Learn more</a>.</p></div>' +
        '<div class="privacy-consent__actions"><button type="button" data-consent="reject">Only necessary</button><button type="button" data-consent="choose">Choose</button><button type="button" class="privacy-consent__primary" data-consent="accept">Accept all</button></div>' +
      '</section>' +
      '<section class="privacy-consent privacy-consent--choices" id="privacy-consent-choices" role="dialog" aria-modal="true" aria-label="Choose privacy settings" hidden>' +
        '<strong>Choose privacy settings</strong>' +
        '<p>Necessary storage keeps the checkout and these choices working and cannot be switched off.</p>' +
        '<label><span><b>Analytics</b><small>Anonymous first-party traffic and checkout-funnel measurement.</small></span><input type="checkbox" id="privacy-analytics"></label>' +
        '<label><span><b>Advertising</b><small>Meta and Google tags for campaign measurement and retargeting audiences.</small></span><input type="checkbox" id="privacy-advertising"></label>' +
        '<div class="privacy-consent__actions"><button type="button" data-consent="cancel">Cancel</button><button type="button" class="privacy-consent__primary" data-consent="save">Save choices</button></div>' +
      '</section>';
    while (root.firstChild) document.body.appendChild(root.firstChild);

    document.addEventListener('click', function (event) {
      var action = event.target && event.target.getAttribute('data-consent');
      if (!action) return;
      if (action === 'accept') save(true, true);
      if (action === 'reject') save(false, false);
      if (action === 'choose') openChoices();
      if (action === 'cancel') hidePanels();
      if (action === 'save') {
        save(
          document.getElementById('privacy-analytics').checked,
          document.getElementById('privacy-advertising').checked
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
    open: openChoices
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
