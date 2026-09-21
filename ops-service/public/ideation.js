(function () {
  'use strict';
  var root = null, timer = null, lastState = null, dirty = {}, expanded = {}, expansionInitialized = false, renderSignature = null;
  function esc(v) { var d = document.createElement('div'); d.textContent = v == null ? '' : String(v); return d.innerHTML; }
  function api(path, options) {
    options = options || {}; options.credentials = 'include';
    options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    return fetch('/api/ideation' + path, options).then(function (r) { return r.json().then(function (data) { if (!r.ok) throw new Error(data.error || 'Request failed'); return data; }); });
  }
  function labelType(v) { return ({ ultra_short: 'Ultra-short', short: 'Short', long_short: 'Long-short', longform: 'Long-form' })[v] || v; }
  function field(id, key) { return root.querySelector('[data-idea="' + id + '"] [data-field="' + key + '"]'); }
  function payload(id) { return { title: field(id, 'title').value, bigIdea: field(id, 'bigIdea').value, hook: field(id, 'hook').value, script: field(id, 'script').value }; }
  function list(values) { return (values || []).map(function (v) { return '<span class="idea-chip">' + esc(v) + '</span>'; }).join('') || '<span class="idea-none">None</span>'; }
  function alternatives(values) {
    if (!values || !values.length) return '';
    return '<section class="idea-alternatives"><h4>Alternative titles</h4><ol>' + values.map(function (title) { return '<li>' + esc(title) + '</li>'; }).join('') + '</ol></section>';
  }
  function micMarkup(state) {
    var icon = state === 'processing' ? '…' : state === 'stop' ? '■' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/></svg>';
    return icon + '<b>' + (state === 'processing' ? 'Transcribing' : state === 'stop' ? 'Stop' : 'Record') + '</b>';
  }
  function feedback(items) { return (items || []).map(function (f) { return '<div class="idea-feedback-entry"><span>' + esc(f.source) + ' · ' + new Date(f.created_at).toLocaleString() + '</span>' + esc(f.text) + '</div>'; }).join('') || '<div class="idea-none">No feedback yet.</div>'; }
  function diff(revisions) {
    var revision = (revisions || []).filter(function (r) { return r.kind === 'ai_revision'; })[0];
    if (!revision) return '';
    var summary = (revision.snapshot.changeSummary || []).map(function (line) { return '<li>' + esc(line) + '</li>'; }).join('');
    return '<details class="idea-diff"><summary>What changed in revision ' + revision.revision_number + '</summary>' + (summary ? '<ul class="idea-change-summary">' + summary + '</ul>' : '') + '<div class="idea-diff-lines">' +
      (revision.diff || []).map(function (line) { return '<div class="diff-' + line.type + '">' + (line.type === 'add' ? '+ ' : line.type === 'remove' ? '− ' : '  ') + esc(line.text || ' ') + '</div>'; }).join('') + '</div></details>';
  }
  function card(idea, index) {
    var meta = idea.generation_meta || {};
    var revisionJob = lastState && (lastState.jobs || []).filter(function (j) { return j.kind === 'revise' && j.idea_id === idea.id && j.status !== 'error'; })[0];
    var isOpen = !!expanded[idea.id];
    return '<article class="idea-card' + (idea.edited ? ' is-edited' : '') + (revisionJob ? ' idea-revising' : '') + '" data-idea="' + idea.id + '">' +
      '<button class="idea-summary" type="button" aria-expanded="' + String(isOpen) + '">' +
        '<span class="idea-number">' + String(index + 1).padStart(2, '0') + '</span><span class="idea-summary-main"><span class="idea-kicker">' + esc(labelType(idea.content_type)) + ' · ' + esc(idea.estimated_runtime) + '</span><strong>' + esc(idea.title) + '</strong><span>' + esc(idea.big_idea) + '</span></span>' +
        '<span class="idea-origin">' + esc(idea.provider) + (idea.edited ? '<b>EDITED</b>' : '') + '</span><span class="idea-chevron">⌄</span></button>' +
      '<div class="idea-body"' + (isOpen ? '' : ' hidden') + '>' +
        '<div class="idea-edit-grid"><label>Working title<input data-field="title" value="' + esc(idea.title) + '"></label><label class="wide">Big idea<textarea data-field="bigIdea" rows="3">' + esc(idea.big_idea) + '</textarea></label><label class="wide">Hook / opening<textarea data-field="hook" rows="3">' + esc(idea.hook) + '</textarea></label></div>' +
        (idea.content_type === 'longform' ? alternatives(idea.alternative_titles) : '') +
        '<section class="idea-script"><div class="idea-section-head"><h4>Script / outline</h4><span>Estimated runtime · ' + esc(idea.estimated_runtime) + '</span></div><textarea data-field="script">' + esc(idea.script) + '</textarea><button class="idea-save" type="button">Save manual edits</button><span class="idea-save-state" aria-live="polite"></span></section>' +
        diff(idea.revisions) +
        '<section class="idea-feedback"><div class="idea-section-head"><h4>Feedback</h4><span>Permanent history · used as a strong learning signal</span></div><div class="idea-feedback-history">' + feedback(idea.feedback) + '</div><div class="idea-feedback-compose"><textarea data-feedback rows="3" placeholder="Tell the ideation engine what works, what doesn’t, or exactly what to change…"></textarea><button class="idea-mic" type="button" title="Record feedback" aria-label="Record feedback">' + micMarkup('record') + '</button><button class="idea-feedback-save" type="button">Save feedback</button></div></section>' +
        '<div class="idea-actions"><button data-action="started" type="button">Send to Outline Started</button><button data-action="completed" class="primary" type="button">Send to Outline Completed</button><button data-action="revise" type="button">Implement Feedback</button><button data-action="reject" class="danger" type="button">Not Interested</button></div>' +
        '<div class="idea-status" aria-live="polite">' + (revisionJob ? esc(revisionJob.provider) + ' is implementing feedback…' : '') + '</div><div class="idea-meta">Generated by ' + esc(idea.provider) + ' · ' + esc(idea.model) + ' · revision ' + idea.revision_number + (meta.generatedAt ? ' · ' + new Date(meta.generatedAt).toLocaleString() : '') + '</div>' +
      '</div></article>';
  }
  function jobs(state) {
    var open = (state.jobs || []).filter(function (j) { return j.kind === 'generate' && j.status !== 'error'; });
    var missing = Math.max(0, state.target - state.ideas.length);
    var html = '';
    for (var i = 0; i < missing; i++) html += '<div class="idea-card idea-generating"><div class="idea-pulse"></div><div><strong>Generating a grounded proposal…</strong><span>' + esc(open[0] ? open[0].provider : state.selectedProvider) + ' is reading the manuscript and checking for duplicates.</span></div></div>';
    (state.jobs || []).filter(function (j) { return j.status === 'error'; }).forEach(function (j) { html += '<div class="idea-job-error"><strong>' + esc(j.provider) + ' ' + esc(j.kind) + ' failed</strong><span>' + esc(j.error) + '</span><button data-retry="' + j.id + '">Retry with ' + esc(j.provider) + '</button></div>'; });
    return html;
  }
  function profile(p) { return '<details class="idea-profile"><summary>Learned content preferences <span>' + (p.signalCount || 0) + ' signals</span></summary><p>' + esc(p.summary) + '</p><div><b>Prefer</b>' + list(p.likes) + '</div><div><b>Avoid</b>' + list(p.avoids) + '</div><div><b>Hooks</b>' + list(p.hookPreferences) + '</div><div><b>Formats</b>' + list(p.formatPreferences) + '</div></details>'; }
  function render(state) {
    if (!root || location.hash !== '#content-ideation') return;
    var signature = JSON.stringify(state);
    lastState = state;
    // Most polls are identical. Replacing the DOM anyway was what snapped the
    // document and script textarea back to the top every five seconds.
    if (signature === renderSignature) return;
    var active = document.activeElement;
    if (active && active.closest && active.closest('.idea-card') && (active.matches('textarea') || active.matches('input'))) return;
    // Polling must never replace a card containing unsaved manual wording.
    // The next explicit save/action clears this guard and refreshes normally.
    if (Object.keys(dirty).some(function (id) { return dirty[id]; })) return;
    if (!expansionInitialized) {
      if (state.ideas[0]) expanded[state.ideas[0].id] = true;
      expansionInitialized = true;
    }
    var pageY = window.scrollY, rootScroll = root.scrollTop;
    var fieldScroll = {};
    root.querySelectorAll('.idea-card[data-idea]').forEach(function (card) {
      card.querySelectorAll('textarea').forEach(function (box) {
        var key = box.hasAttribute('data-field') ? box.getAttribute('data-field') : 'feedback';
        fieldScroll[card.dataset.idea + ':' + key] = box.scrollTop;
      });
    });
    root.innerHTML = '<div class="ideation-workspace"><header class="ideation-hero"><div><div class="eyebrow">Manuscript-grounded development queue</div><h2>Content Ideation</h2><p>Ten active proposals shaped by the book, your strongest completed outlines, and the feedback you give here.</p></div><div class="idea-provider"><span>Generation model</span><div role="group"><button data-provider="codex" class="' + (state.selectedProvider === 'codex' ? 'active' : '') + '">Codex</button><button data-provider="claude" class="' + (state.selectedProvider === 'claude' ? 'active' : '') + '">Claude</button></div><small>Applies to new ideas and revisions. Independent of Project Manager.</small></div></header>' +
      '<div class="idea-queue-bar"><span><b>' + state.ideas.length + '</b> / ' + state.target + ' active proposals</span><span>Target mix 6:1 short-form to long-form</span></div>' + profile(state.preferenceProfile || {}) + '<div class="idea-list">' + state.ideas.map(card).join('') + jobs(state) + '</div></div>';
    bind();
    renderSignature = signature;
    requestAnimationFrame(function () {
      Object.keys(fieldScroll).forEach(function (compound) {
        var split = compound.indexOf(':'), id = compound.slice(0, split), key = compound.slice(split + 1);
        var selector = key === 'feedback' ? '[data-feedback]' : '[data-field="' + key + '"]';
        var box = root.querySelector('[data-idea="' + id + '"] ' + selector);
        if (box) box.scrollTop = fieldScroll[compound];
      });
      root.scrollTop = rootScroll;
      window.scrollTo(0, pageY);
    });
  }
  function refresh() { api('/state').then(render).catch(function (e) { if (root) root.innerHTML = '<div class="idea-fatal">Could not load Content Ideation: ' + esc(e.message) + '</div>'; }); }
  function setStatus(card, text, bad) { var el = card.querySelector('.idea-status'); el.textContent = text; el.classList.toggle('bad', !!bad); }
  function save(id, card) { setStatus(card, 'Saving…'); return api('/ideas/' + id, { method: 'PATCH', body: JSON.stringify(payload(id)) }).then(function () { dirty[id] = false; setStatus(card, 'Saved'); }); }
  function bind() {
    root.querySelectorAll('.idea-summary').forEach(function (btn) { btn.onclick = function () { var body = btn.nextElementSibling, opening = body.hidden, id = btn.closest('.idea-card').dataset.idea; body.hidden = !opening; expanded[id] = opening; btn.setAttribute('aria-expanded', String(opening)); }; });
    root.querySelectorAll('[data-provider]').forEach(function (btn) { btn.onclick = function () { api('/provider', { method: 'PUT', body: JSON.stringify({ provider: btn.dataset.provider }) }).then(refresh); }; });
    root.querySelectorAll('.idea-card[data-idea]').forEach(function (card) {
      var id = card.dataset.idea;
      card.querySelectorAll('input,textarea').forEach(function (el) { el.oninput = function () { dirty[id] = true; }; });
      card.querySelector('.idea-save').onclick = function () { save(id, card).catch(function (e) { setStatus(card, e.message, true); }); };
      card.querySelector('.idea-feedback-save').onclick = function () { var box = card.querySelector('[data-feedback]'); if (!box.value.trim()) return; setStatus(card, 'Saving feedback…'); api('/ideas/' + id + '/feedback', { method: 'POST', body: JSON.stringify({ text: box.value, source: box.dataset.voice === 'true' ? 'voice' : 'typed' }) }).then(function () { dirty[id] = false; refresh(); }).catch(function (e) { setStatus(card, e.message, true); }); };
      card.querySelector('.idea-mic').onclick = function (e) { var btn = e.currentTarget, box = card.querySelector('[data-feedback]'); dirty[id] = true; btn.classList.add('recording'); btn.innerHTML = micMarkup('stop'); window.RMVoice.startRecording().then(function (recording) { btn.onclick = function () { recording.stop().then(function (blob) { btn.innerHTML = micMarkup('processing'); return window.RMVoice.transcribe(blob); }).then(function (transcript) { box.value = (box.value ? box.value + ' ' : '') + transcript; box.dataset.voice = 'true'; dirty[id] = true; btn.innerHTML = micMarkup('record'); btn.classList.remove('recording'); bind(); }).catch(function (err) { btn.innerHTML = micMarkup('record'); btn.classList.remove('recording'); setStatus(card, err.message, true); }); }; }).catch(function (err) { dirty[id] = false; btn.classList.remove('recording'); btn.innerHTML = micMarkup('record'); setStatus(card, err.message, true); }); };
      card.querySelectorAll('[data-action]').forEach(function (btn) { btn.onclick = function () {
        var action = btn.dataset.action, box = card.querySelector('[data-feedback]'), body = payload(id); body.feedback = box.value; body.source = box.dataset.voice === 'true' ? 'voice' : 'typed';
        var path, text;
        if (action === 'revise') { path = '/ideas/' + id + '/revise'; text = 'Revision queued with ' + (lastState ? lastState.selectedProvider : 'selected provider') + '…'; }
        else if (action === 'reject') { path = '/ideas/' + id + '/reject'; text = 'Recording rejection…'; }
        else { path = '/ideas/' + id + '/transfer'; body.destination = action === 'completed' ? 'outline_completed' : 'outline_started'; text = 'Sending to the Content Pipeline…'; }
        setStatus(card, text); btn.disabled = true;
        api(path, { method: 'POST', body: JSON.stringify(body) }).then(function () { dirty[id] = false; if (action !== 'revise') card.classList.add(action === 'reject' ? 'idea-exit-reject' : 'idea-exit-send'); else card.classList.add('idea-revising'); setTimeout(refresh, 430); }).catch(function (err) { btn.disabled = false; setStatus(card, err.message, true); });
      }; });
    });
    root.querySelectorAll('[data-retry]').forEach(function (btn) { btn.onclick = function () { api('/jobs/' + btn.dataset.retry + '/retry', { method: 'POST', body: '{}' }).then(refresh); }; });
  }
  function mount(container) {
    if (timer) clearInterval(timer); root = container; expanded = {}; expansionInitialized = false; renderSignature = null;
    root.innerHTML = '<div class="idea-loading" role="status" aria-label="Loading Content Ideation"><span aria-hidden="true"></span></div>'; refresh();
    timer = setInterval(function () { if (location.hash === '#content-ideation') refresh(); else clearInterval(timer); }, 5000);
  }
  window.RMIdeation = { mount: mount };
})();
