(function () {
  'use strict';

  var root = null;
  var index = null;
  var ideaState = null;
  var pollTimer = null;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function request(base, path, options) {
    options = options || {};
    options.credentials = 'include';
    options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    return fetch(base + path, options).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) throw new Error(data.error || 'Request failed');
        return data;
      });
    });
  }

  function manuscriptApi(path, options) { return request('/api/manuscript', path, options); }
  function researchApi(path, options) { return request('/api/research', path, options); }

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
      manuscriptApi('/concepts/match', { method: 'POST', body: JSON.stringify({ statement: statement, limit: 5 }) })
        .then(function (data) { status.textContent = data.nextStep; renderMatches(data.matches); })
        .catch(function (error) { status.textContent = error.message; });
    };
    root.querySelector('#researchStatement').onkeydown = function (event) {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      root.querySelector('#researchMatchForm').requestSubmit();
    };
  }

  function ideaCard(idea, number) {
    var concepts = (idea.manualConcepts || []).map(function (concept) {
      return '<button type="button" class="research-idea-concept research-open" data-page="' + concept.quotePage + '" data-quote="' + esc(concept.quote) + '">' + esc(concept.title) + ' · p. ' + concept.quotePage + '</button>';
    }).join('');
    var outliers = (idea.outlierMatches || []).map(function (match) {
      return '<div class="research-outlier-match"><div><b>1/10 corroboration</b><span>' + esc(match.channel) + (match.lift ? ' · ' + match.lift + '× median views' : '') + '</span></div><strong>' + esc(match.title || match.bigIdea) + '</strong><p>' + esc(match.why) + '</p></div>';
    }).join('');
    return '<article class="research-idea-card' + (idea.approved ? ' is-approved' : '') + '" data-idea-id="' + esc(idea.id) + '">' +
      '<div class="research-idea-number">' + String(number + 1).padStart(2, '0') + '</div>' +
      '<div class="research-idea-body"><div class="research-idea-meta"><span>' + (idea.thinkerNames || []).map(function (name) { return esc(name); }).join(' × ') + '</span>' + (idea.approved ? '<b>Approved</b>' : '') + '</div>' +
      '<p class="research-big-idea">' + esc(idea.bigIdea) + '</p><div class="research-idea-concepts">' + concepts + '</div>' + outliers +
      '<label class="research-notes-label">Notes<textarea class="research-idea-notes" placeholder="Add a direction, correction, or thought…">' + esc(idea.notes || '') + '</textarea></label>' +
      '<div class="research-idea-actions"><button type="button" data-action="approve">' + (idea.approved ? 'Undo approval' : 'Approve') + '</button><button type="button" data-action="reject" class="is-reject">Not interested</button><button type="button" data-action="transfer" class="is-primary">Send to Ideation</button><span class="research-save-state" aria-live="polite"></span></div></div></article>';
  }

  function ideaJobMessage() {
    var job = (ideaState.jobs || []).find(function (item) { return item.status === 'error'; });
    if (job) return '<div class="research-idea-error">Generation paused: ' + esc(job.error) + ' <button type="button" data-retry-job="' + esc(job.id) + '">Retry</button></div>';
    if ((ideaState.jobs || []).some(function (item) { return item.status === 'pending' || item.status === 'running'; })) {
      return '<div class="research-idea-generating"><div class="spinner"></div><span>Researching and checking the next ideas against caption-derived outliers…</span></div>';
    }
    return '';
  }

  function renderIdeas() {
    if (!root || !ideaState) return;
    var target = root.querySelector('#researchIdeaCards');
    var status = root.querySelector('#researchIdeaStatus');
    if (!target || !status) return;
    target.innerHTML = (ideaState.ideas || []).map(ideaCard).join('');
    status.innerHTML = ideaJobMessage();
    root.querySelector('#researchSourceCount').textContent = ideaState.sourceCount;
    root.querySelector('#researchOutlierCount').textContent = ideaState.outlierCount;
    root.querySelector('#researchSourceRoster').innerHTML = (ideaState.sources || []).map(function (source) { return '<span title="' + esc(source.focus) + '">' + esc(source.name) + '</span>'; }).join('');
    bindOpenButtons(target);
    bindIdeaCards(target);
    status.querySelectorAll('[data-retry-job]').forEach(function (button) {
      button.onclick = function () { researchApi('/jobs/' + encodeURIComponent(button.dataset.retryJob) + '/retry', { method: 'POST' }).then(loadIdeas); };
    });
  }

  function loadIdeas() {
    return researchApi('/state').then(function (data) {
      ideaState = data; renderIdeas();
      clearTimeout(pollTimer);
      if ((data.jobs || []).some(function (job) { return job.status === 'pending' || job.status === 'running'; })) pollTimer = setTimeout(loadIdeas, 2500);
    }).catch(function (error) {
      var status = root && root.querySelector('#researchIdeaStatus');
      if (status) status.textContent = error.message;
    });
  }

  function bindIdeaCards(scope) {
    scope.querySelectorAll('.research-idea-card').forEach(function (card) {
      var id = card.dataset.ideaId;
      var notes = card.querySelector('.research-idea-notes');
      var saved = card.querySelector('.research-save-state');
      var noteTimer;
      notes.oninput = function () {
        saved.textContent = 'Saving…'; clearTimeout(noteTimer);
        noteTimer = setTimeout(function () {
          researchApi('/ideas/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ notes: notes.value }) })
            .then(function () { saved.textContent = 'Saved'; setTimeout(function () { saved.textContent = ''; }, 1200); })
            .catch(function (error) { saved.textContent = error.message; });
        }, 450);
      };
      card.querySelectorAll('[data-action]').forEach(function (button) {
        button.onclick = function () {
          var action = button.dataset.action;
          button.disabled = true;
          var call;
          if (action === 'approve') {
            var current = (ideaState.ideas || []).find(function (item) { return item.id === id; });
            call = researchApi('/ideas/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ notes: notes.value, approved: !current.approved }) });
          } else {
            call = researchApi('/ideas/' + encodeURIComponent(id) + '/' + action, { method: 'POST', body: JSON.stringify({ notes: notes.value }) });
          }
          call.then(loadIdeas).catch(function (error) { button.disabled = false; saved.textContent = error.message; });
        };
      });
    });
  }

  function renderShell() {
    root.innerHTML = '<div class="research-workspace">' +
      '<header class="research-hero"><div><div class="eyebrow">Source-grounded idea engine</div><h1>Idea Research</h1>' +
      '<p>The 180-page Manual is compressed into a fast conceptual map. External statements are matched here first; every useful connection then returns to the real manuscript for Harvey’s exact wording, quotation, and page.</p></div>' +
      '<div class="research-stats"><strong>' + index.conceptCount + '</strong><span>core concepts</span><strong>' + index.ruleCount + '</strong><span>named Rules</span></div></header>' +
      '<section class="research-ideas"><div class="research-ideas-head"><div><div class="eyebrow">Browse for inspiration</div><h2>10 Big Ideas</h2><p>Fresh syntheses drawn from <b id="researchSourceCount">41</b> selected thinkers and checked against <b id="researchOutlierCount">0</b> caption-derived 1/10 videos. Thinker names are lenses, not attributed quotations.</p></div><button type="button" id="researchFreshIdeas">Generate a fresh 10</button></div>' +
      '<details class="research-source-roster"><summary>View the 41-source research pool</summary><div id="researchSourceRoster"></div></details>' +
      '<div id="researchIdeaStatus"></div><div id="researchIdeaCards" class="research-idea-list"><div class="research-idea-generating"><div class="spinner"></div><span>Loading ideas…</span></div></div></section>' +
      '<section class="research-workflow"><div><b>1 · Candidate</b><span>' + esc(index.workflow.candidate) + '</span></div><div><b>2 · Verify</b><span>' + esc(index.workflow.verify) + '</span></div><div><b>3 · Develop</b><span>' + esc(index.workflow.develop) + '</span></div></section>' +
      '<section class="research-matcher"><div><div class="eyebrow">Test the matching layer</div><h2>Compare a source statement</h2><p>Paste a claim from a thinker, article, interview, or caption transcript. Enter compares it; Shift+Enter adds a line.</p></div>' +
      '<form id="researchMatchForm"><textarea id="researchStatement" placeholder="e.g. Suffering comes from resisting reality and wanting the present moment to be different."></textarea><button type="submit">Find Manual connections</button></form>' +
      '<div class="research-match-status" id="researchMatchStatus" role="status"></div><div id="researchMatches"></div></section>' +
      '<section class="research-index-head"><div><div class="eyebrow">Canonical comparison vocabulary</div><h2>The Manual, compressed</h2></div><div><input id="researchFilter" type="search" placeholder="Filter concepts…"><span id="researchVisibleCount"></span></div></section>' +
      '<div id="researchConcepts"></div></div>';
    bind();
    renderConcepts('');
    root.querySelector('#researchFreshIdeas').onclick = function () {
      if (!window.confirm('Replace the current research queue with a fresh set of 10?')) return;
      root.querySelector('#researchFreshIdeas').disabled = true;
      researchApi('/fresh', { method: 'POST' }).then(function () { return loadIdeas(); }).finally(function () {
        if (root && root.querySelector('#researchFreshIdeas')) root.querySelector('#researchFreshIdeas').disabled = false;
      });
    };
    loadIdeas();
  }

  function mount(container) {
    root = container;
    root.innerHTML = '<div class="research-loading"><div class="spinner"></div><span>Loading the Manual concept index…</span></div>';
    clearTimeout(pollTimer);
    manuscriptApi('/concepts').then(function (data) {
      if (root !== container || !document.body.contains(container)) return;
      index = data;
      renderShell();
    }).catch(function (error) {
      if (root === container) root.innerHTML = '<div class="research-empty">' + esc(error.message) + '</div>';
    });
  }

  window.RMResearch = { mount: mount };
})();
