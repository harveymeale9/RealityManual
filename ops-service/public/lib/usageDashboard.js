window.RMUsage = (function () {
  'use strict';
  var API_BASE = window.RMStore ? window.RMStore.API_BASE : '';
  var pollTimer = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function relativeReset(value) {
    if (!value) return 'Reset time unavailable';
    var then = new Date(value);
    if (isNaN(then.getTime())) return 'Reset time unavailable';
    var mins = Math.ceil((then.getTime() - Date.now()) / 60000);
    if (mins <= 0) return 'Resetting now';
    var days = Math.floor(mins / 1440), hours = Math.floor((mins % 1440) / 60), rem = mins % 60;
    if (days) return 'Resets in ' + days + 'd ' + hours + 'h';
    if (hours) return 'Resets in ' + hours + 'h ' + rem + 'm';
    return 'Resets in ' + rem + 'm';
  }
  function stateClass(percent) { return percent <= 20 ? 'critical' : percent <= 40 ? 'low' : 'healthy'; }
  function renderProvider(provider) {
    var details = [];
    if (provider.plan) details.push(escapeHtml(provider.plan) + ' plan');
    if (provider.currentModel) details.push(escapeHtml(provider.currentModel));
    if (provider.reasoningLevel) details.push(escapeHtml(provider.reasoningLevel) + ' reasoning');
    var head = '<section class="usage-provider usage-provider--' + escapeHtml(provider.provider) + '">' +
      '<div class="usage-provider-head"><div><span class="usage-provider-dot"></span><h3>' + escapeHtml(provider.displayName) + '</h3></div>' +
      (details.length ? '<span class="usage-provider-meta">' + details.join(' · ') + '</span>' : '') + '</div>';
    if (!provider.available) return head + '<div class="usage-unavailable">Usage data unavailable</div></section>';
    var body = (provider.limits || []).map(function (item) {
      var pct = item.remainingPercentage;
      if (pct == null) return '<div class="usage-limit"><div class="usage-limit-head"><strong>' + escapeHtml(item.name) + '</strong><span>Percentage unavailable</span></div></div>';
      var exact = item.resetAt ? new Date(item.resetAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
      return '<div class="usage-limit usage-limit--' + stateClass(pct) + '">' +
        '<div class="usage-limit-head"><strong>' + escapeHtml(item.name) + '</strong><span>' + escapeHtml(pct) + '% remaining</span></div>' +
        '<div class="usage-meter" role="progressbar" aria-label="' + escapeHtml(provider.displayName + ' ' + item.name) + ' remaining" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + escapeHtml(pct) + '"><span style="width:' + escapeHtml(pct) + '%"></span></div>' +
        '<div class="usage-reset" title="' + escapeHtml(exact) + '">' + escapeHtml(relativeReset(item.resetAt)) + (exact ? '<small>' + escapeHtml(exact) + '</small>' : '') + '</div></div>';
    }).join('');
    if (!body) body = '<div class="usage-unavailable">No percentage-based limits are currently exposed.</div>';
    if (provider.extraCredits && provider.extraCredits.enabled) {
      var creditText = provider.extraCredits.unlimited ? 'Unlimited' : (provider.extraCredits.remaining == null ? 'Available' : provider.extraCredits.remaining + ' remaining');
      body += '<div class="usage-credit"><strong>Additional credits</strong><span>' + escapeHtml(creditText) + '</span></div>';
    }
    return head + body + '</section>';
  }
  function ensureDialog() {
    var existing = document.getElementById('agentUsageDialog');
    if (existing) return existing;
    var wrap = document.createElement('div');
    wrap.id = 'agentUsageDialog'; wrap.className = 'usage-overlay'; wrap.hidden = true;
    wrap.innerHTML = '<div class="usage-dialog" role="dialog" aria-modal="true" aria-labelledby="usageTitle"><header><div><span class="usage-kicker">Subscription allowance</span><h2 id="usageTitle">Agent usage</h2></div><button type="button" class="usage-close" aria-label="Close usage dashboard">✕</button></header><div class="usage-content"><div class="usage-loading"><span></span>Checking provider usage…</div></div><footer><span class="usage-updated"></span><button type="button" class="btn-secondary usage-refresh">Refresh</button></footer></div>';
    document.body.appendChild(wrap);
    wrap.querySelector('.usage-close').addEventListener('click', close);
    wrap.addEventListener('click', function (event) { if (event.target === wrap) close(); });
    wrap.querySelector('.usage-refresh').addEventListener('click', function () { load(true); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && !wrap.hidden) close(); });
    return wrap;
  }
  function load(force) {
    var dialog = ensureDialog(), content = dialog.querySelector('.usage-content'), refresh = dialog.querySelector('.usage-refresh');
    refresh.disabled = true;
    if (!content.querySelector('.usage-provider')) content.innerHTML = '<div class="usage-loading"><span></span>Checking provider usage…</div>';
    fetch(API_BASE + '/api/voice/usage' + (force ? '?refresh=1' : ''), { credentials: 'include' })
      .then(function (response) { if (!response.ok) throw new Error('unavailable'); return response.json(); })
      .then(function (data) {
        content.innerHTML = (data.providers || []).map(renderProvider).join('') || '<div class="usage-unavailable">Usage data unavailable</div>';
        var updated = new Date(data.lastUpdated);
        dialog.querySelector('.usage-updated').textContent = 'Last updated ' + (isNaN(updated.getTime()) ? 'just now' : updated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
      }).catch(function () {
        content.innerHTML = '<div class="usage-unavailable">Usage data unavailable. Claude and Codex are unaffected.</div>';
        dialog.querySelector('.usage-updated').textContent = 'Refresh failed';
      }).finally(function () { refresh.disabled = false; });
  }
  function open() {
    var dialog = ensureDialog(); dialog.hidden = false; document.body.classList.add('usage-open');
    document.querySelectorAll('.pm-usage-option').forEach(function (button) { button.classList.add('open'); button.setAttribute('aria-expanded', 'true'); });
    load(false); clearInterval(pollTimer); pollTimer = setInterval(function () { if (!dialog.hidden) load(false); }, 120000);
  }
  function close() {
    var dialog = document.getElementById('agentUsageDialog'); if (dialog) dialog.hidden = true;
    document.body.classList.remove('usage-open');
    document.querySelectorAll('.pm-usage-option').forEach(function (button) { button.classList.remove('open'); button.setAttribute('aria-expanded', 'false'); });
    clearInterval(pollTimer); pollTimer = null;
  }
  function attach(button) {
    if (!button || button.dataset.usageBound) return;
    button.dataset.usageBound = '1'; button.setAttribute('aria-expanded', 'false'); button.addEventListener('click', open);
  }
  return { attach: attach, open: open, close: close };
})();
