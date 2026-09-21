(function () {
  'use strict';

  var root = null;
  var pageCount = 180;
  var currentPage = 1;
  var pollTimer = null;

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

  function isMounted() { return root && location.hash === '#manuscript' && document.body.contains(root); }

  function pageBody(page, side) {
    if (!page) return '<section class="manual-page manual-page-' + side + ' manual-page-blank"><span>' + (side === 'left' ? 'The Reality Manual' : '') + '</span></section>';
    var paragraphs = String(page.text || '').split(/\n\s*\n/).filter(Boolean).map(function (paragraph) {
      return '<p>' + esc(paragraph).replace(/\n/g, '<br>') + '</p>';
    }).join('');
    return '<section class="manual-page manual-page-' + (page.page % 2 === 0 ? 'left' : 'right') + '" data-page="' + page.page + '">' +
      '<div class="manual-page-body">' + paragraphs + '</div><span class="manual-page-number">' + page.page + '</span></section>';
  }

  function loadPage(page) {
    page = Math.max(1, Math.min(pageCount, Number(page) || 1));
    currentPage = page;
    var input = root.querySelector('#manualPageInput');
    if (input) input.value = page;
    var book = root.querySelector('#manualBook');
    book.classList.remove('flipping');
    book.innerHTML = '<section class="manual-page manual-page-left manual-page-blank manual-page-loading">Opening…</section><section class="manual-page manual-page-right manual-page-blank"></section>';
    return api('/pages/' + page).then(function (data) {
      if (!isMounted()) return;
      pageCount = data.pageCount;
      root.querySelector('#manualPageCount').textContent = 'of ' + pageCount;
      book.innerHTML = pageBody(data.left, 'left') + pageBody(data.right, 'right');
      void book.offsetWidth;
      book.classList.add('flipping');
    }).catch(function (error) {
      if (isMounted()) book.innerHTML = '<section class="manual-page manual-page-left manual-page-blank">' + esc(error.message) + '</section><section class="manual-page manual-page-right manual-page-blank"></section>';
    });
  }

  function renderResults(results) {
    var target = root.querySelector('#manualResults');
    target.innerHTML = (results || []).map(function (result) {
      return '<button type="button" class="manual-result" data-page="' + result.page + '"><span class="manual-result-head"><span>' + esc(result.title) + '</span><span>p. ' + result.page + '</span></span><p>' + esc(result.relevance) + '</p><blockquote>“' + esc(result.excerpt) + '”</blockquote></button>';
    }).join('');
    target.querySelectorAll('.manual-result').forEach(function (button) {
      button.onclick = function () {
        loadPage(Number(button.dataset.page)).then(function () {
          var stage = root.querySelector('.manual-stage');
          if (stage) stage.scrollTo({ top: 0, behavior: 'smooth' });
        });
      };
    });
  }

  function setSearchStatus(message, state) {
    if (!isMounted()) return;
    var status = root.querySelector('#manualSearchStatus');
    status.textContent = message;
    status.className = 'manual-search-status' + (state ? ' ' + state : '');
  }

  function pollSearch(id) {
    if (!isMounted()) return;
    api('/search/' + id).then(function (job) {
      if (!isMounted()) return;
      if (job.status === 'done') {
        setSearchStatus(job.results.length + ' relevant passage' + (job.results.length === 1 ? '' : 's') + ', ranked by ' + job.provider + '.');
        root.querySelector('#manualSearchButton').disabled = false;
        renderResults(job.results);
      } else if (job.status === 'error') {
        setSearchStatus(job.error || 'Search failed.', 'error');
        root.querySelector('#manualSearchButton').disabled = false;
      } else {
        var activity = job.activity && job.activity.length ? ' ' + job.activity[job.activity.length - 1] : '';
        setSearchStatus('AI is reading and ranking the manuscript…' + activity, 'working');
        pollTimer = setTimeout(function () { pollSearch(id); }, 1800);
      }
    }).catch(function (error) {
      setSearchStatus(error.message, 'error');
      if (isMounted()) root.querySelector('#manualSearchButton').disabled = false;
    });
  }

  function bind() {
    root.querySelector('#manualPageForm').onsubmit = function (event) {
      event.preventDefault();
      loadPage(root.querySelector('#manualPageInput').value);
    };
    root.querySelector('#manualPrev').onclick = function () { loadPage(Math.max(1, currentPage - 2)); };
    root.querySelector('#manualNext').onclick = function () { loadPage(Math.min(pageCount, currentPage + 2)); };
    root.querySelector('#manualSearchForm').onsubmit = function (event) {
      event.preventDefault();
      var query = root.querySelector('#manualSearchQuery').value.trim();
      if (query.length < 3) { setSearchStatus('Describe what you are looking for.', 'error'); return; }
      if (pollTimer) clearTimeout(pollTimer);
      root.querySelector('#manualSearchButton').disabled = true;
      root.querySelector('#manualResults').innerHTML = '';
      setSearchStatus('Starting a meaning-based search of all 180 pages…', 'working');
      api('/search', { method: 'POST', body: JSON.stringify({ query: query }) }).then(function (job) { pollSearch(job.id); }).catch(function (error) {
        setSearchStatus(error.message, 'error');
        if (isMounted()) root.querySelector('#manualSearchButton').disabled = false;
      });
    };
  }

  function mount(container) {
    if (pollTimer) clearTimeout(pollTimer);
    root = container;
    root.innerHTML = '<div class="manual-reader"><aside class="manual-finder"><div class="eyebrow">Intelligent finder</div><h2>Search the Manual</h2><p class="manual-finder-intro">Describe an idea, question, quotation, or section. The AI searches by meaning, ranks the strongest passages, and opens the book at the result you choose.</p><form class="manual-search-form" id="manualSearchForm"><textarea id="manualSearchQuery" placeholder="e.g. What does the Manual say about why people cannot make themselves take action?"></textarea><button id="manualSearchButton" type="submit">Find relevant passages</button></form><div class="manual-search-status" id="manualSearchStatus" role="status" aria-live="polite"></div><div class="manual-results" id="manualResults"></div></aside><section class="manual-stage"><div class="manual-toolbar"><form class="manual-page-controls" id="manualPageForm"><button type="button" id="manualPrev" aria-label="Previous spread">←</button><label for="manualPageInput">Page</label><input id="manualPageInput" type="number" min="1" max="180" value="1" inputmode="numeric"><span class="manual-page-count" id="manualPageCount">of 180</span><button type="submit">Go</button><button type="button" id="manualNext" aria-label="Next spread">→</button></form></div><div class="manual-book" id="manualBook" aria-live="polite"></div></section></div>';
    bind();
    api('/meta').then(function (meta) {
      pageCount = meta.pageCount;
      if (isMounted()) root.querySelector('#manualPageCount').textContent = 'of ' + pageCount;
    });
    loadPage(currentPage);
  }

  window.RMManuscript = { mount: mount };
})();
