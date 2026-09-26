(function () {
  'use strict';

  var root = null;
  var index = null;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function api(path, options) {
    options = options || {};
    options.credentials = 'include';
    options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    return fetch('/api/manuscript' + path, options).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) throw new Error(data.error || 'Request failed');
        return data;
      });
    });
  }

  function conceptCard(concept, score) {
    return '<article class="research-concept" data-concept-id="' + esc(concept.id) + '">' +
      '<div class="research-concept-head"><span class="research-kind">' + esc(concept.group === 'rule' ? 'Rule ' + concept.rule : concept.group) + '</span>' +
      (score ? '<span class="research-score">match ' + score + '</span>' : '<span class="research-pages">pp. ' + esc(concept.pages.join('–')) + '</span>') + '</div>' +
      '<h3>' + esc(concept.title) + '</h3><p>' + esc(concept.thesis) + '</p>' +
      '<blockquote>“' + esc(concept.quote) + '” <cite>p. ' + concept.quotePage + '</cite></blockquote>' +
      '<button type="button" class="research-open" data-page="' + concept.quotePage + '" data-quote="' + esc(concept.quote) + '">Open verified passage →</button>' +
    '</article>';
  }

  function bindOpenButtons(scope) {
    scope.querySelectorAll('.research-open').forEach(function (button) {
      button.onclick = function () {
        window.RMManuscript.open(Number(button.dataset.page), button.dataset.quote);
      };
    });
  }

  function renderConcepts(filter) {
    var target = root.querySelector('#researchConcepts');
    var needle = String(filter || '').toLowerCase().trim();
    var visible = index.concepts.filter(function (concept) {
      if (!needle) return true;
      return [concept.title, concept.thesis].concat(concept.aliases || []).join(' ').toLowerCase().indexOf(needle) !== -1;
    });
    target.innerHTML = index.groups.map(function (group) {
      var concepts = visible.filter(function (concept) { return concept.group === group.id; });
      if (!concepts.length) return '';
      return '<section class="research-group"><div class="research-group-title"><h2>' + esc(group.label) + '</h2><span>' + concepts.length + '</span></div>' +
        '<div class="research-concept-grid">' + concepts.map(function (concept) { return conceptCard(concept); }).join('') + '</div></section>';
    }).join('') || '<div class="research-empty">No concepts match that filter.</div>';
    bindOpenButtons(target);
    root.querySelector('#researchVisibleCount').textContent = visible.length + ' of ' + index.conceptCount + ' concepts';
  }

  function renderMatches(matches) {
    var target = root.querySelector('#researchMatches');
    if (!matches.length) {
      target.innerHTML = '<div class="research-empty">No strong lexical candidate yet. This does not mean there is no conceptual connection—the source-ingestion model will compare the full statement against all 35 concept theses.</div>';
      return;
    }
    target.innerHTML = '<div class="research-match-head">Candidate Manual connections <span>These are leads, not conclusions. Verify the page before using one.</span></div>' +
      '<div class="research-concept-grid research-match-grid">' + matches.map(function (concept) { return conceptCard(concept, concept.score); }).join('') + '</div>';
    bindOpenButtons(target);
  }

  function bind() {
    root.querySelector('#researchFilter').oninput = function (event) { renderConcepts(event.target.value); };
    root.querySelector('#researchMatchForm').onsubmit = function (event) {
      event.preventDefault();
      var statement = root.querySelector('#researchStatement').value.trim();
      var status = root.querySelector('#researchMatchStatus');
      if (statement.length < 3) { status.textContent = 'Paste or dictate a source statement first.'; return; }
      status.textContent = 'Comparing against the compact Manual index…';
      api('/concepts/match', { method: 'POST', body: JSON.stringify({ statement: statement, limit: 5 }) })
        .then(function (data) { status.textContent = data.nextStep; renderMatches(data.matches); })
        .catch(function (error) { status.textContent = error.message; });
    };
    root.querySelector('#researchStatement').onkeydown = function (event) {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      root.querySelector('#researchMatchForm').requestSubmit();
    };
  }

  function renderShell() {
    root.innerHTML = '<div class="research-workspace">' +
      '<header class="research-hero"><div><div class="eyebrow">Source-grounded idea engine</div><h1>Idea Research</h1>' +
      '<p>The 180-page Manual is compressed into a fast conceptual map. External statements are matched here first; every useful connection then returns to the real manuscript for Harvey’s exact wording, quotation, and page.</p></div>' +
      '<div class="research-stats"><strong>' + index.conceptCount + '</strong><span>core concepts</span><strong>' + index.ruleCount + '</strong><span>named Rules</span></div></header>' +
      '<section class="research-workflow"><div><b>1 · Candidate</b><span>' + esc(index.workflow.candidate) + '</span></div><div><b>2 · Verify</b><span>' + esc(index.workflow.verify) + '</span></div><div><b>3 · Develop</b><span>' + esc(index.workflow.develop) + '</span></div></section>' +
      '<section class="research-matcher"><div><div class="eyebrow">Test the matching layer</div><h2>Compare a source statement</h2><p>Paste a claim from a thinker, article, interview, or caption transcript. Enter compares it; Shift+Enter adds a line.</p></div>' +
      '<form id="researchMatchForm"><textarea id="researchStatement" placeholder="e.g. Suffering comes from resisting reality and wanting the present moment to be different."></textarea><button type="submit">Find Manual connections</button></form>' +
      '<div class="research-match-status" id="researchMatchStatus" role="status"></div><div id="researchMatches"></div></section>' +
      '<section class="research-index-head"><div><div class="eyebrow">Canonical comparison vocabulary</div><h2>The Manual, compressed</h2></div><div><input id="researchFilter" type="search" placeholder="Filter concepts…"><span id="researchVisibleCount"></span></div></section>' +
      '<div id="researchConcepts"></div></div>';
    bind();
    renderConcepts('');
  }

  function mount(container) {
    root = container;
    root.innerHTML = '<div class="research-loading"><div class="spinner"></div><span>Loading the Manual concept index…</span></div>';
    api('/concepts').then(function (data) {
      if (root !== container || !document.body.contains(container)) return;
      index = data;
      renderShell();
    }).catch(function (error) {
      if (root === container) root.innerHTML = '<div class="research-empty">' + esc(error.message) + '</div>';
    });
  }

  window.RMResearch = { mount: mount };
})();
