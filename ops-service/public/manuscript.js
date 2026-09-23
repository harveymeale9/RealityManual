(function () {
  'use strict';

  var root = null;
  var pageCount = 180;
  var currentPage = 1;
  var pollTimer = null;
  var resizeBound = false;

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

  function normalizedOffsets(value) {
    var text = String(value || '');
    var normalized = '';
    var starts = [];
    var ends = [];
    for (var i = 0; i < text.length; i++) {
      var char = text[i].replace(/[“”]/g, '"').replace(/[‘’]/g, "'").toLowerCase();
      if (/\s/.test(char)) {
        if (!normalized || normalized[normalized.length - 1] === ' ') continue;
        normalized += ' ';
        starts.push(i);
        ends.push(i + 1);
      } else {
        normalized += char;
        starts.push(i);
        ends.push(i + 1);
      }
    }
    if (normalized[normalized.length - 1] === ' ') {
      normalized = normalized.slice(0, -1);
      starts.pop();
      ends.pop();
    }
    return { text: normalized, starts: starts, ends: ends };
  }

  function matchRange(paragraph, highlightText) {
    var haystack = normalizedOffsets(paragraph);
    var needle = normalizedOffsets(String(highlightText || '').replace(/…\s*$/, '')).text;
    var index = needle ? haystack.text.indexOf(needle) : -1;
    if (index >= 0) return { start: haystack.starts[index], end: haystack.ends[index + needle.length - 1], score: 100000 + needle.length };

    // A search excerpt can legitimately cross a paragraph boundary. Find
    // the longest exact run of its words that lives inside this rendered
    // paragraph instead of requiring the whole multi-paragraph excerpt to
    // appear in one <p>. This also tolerates an excerpt shortened with an
    // ellipsis while keeping the highlight anchored to real book text.
    var words = needle.split(' ').filter(Boolean);
    for (var length = Math.min(words.length, 32); length >= Math.min(5, words.length); length--) {
      for (var startWord = 0; startWord + length <= words.length; startWord++) {
        var fragment = words.slice(startWord, startWord + length).join(' ');
        index = haystack.text.indexOf(fragment);
        if (index >= 0) return { start: haystack.starts[index], end: haystack.ends[index + fragment.length - 1], score: fragment.length };
      }
    }
    return null;
  }

  function highlightPlan(paragraphs, highlightText) {
    if (!highlightText) return null;
    var best = null;
    paragraphs.forEach(function (paragraph, index) {
      var range = matchRange(paragraph, highlightText);
      if (range && (!best || range.score > best.score)) best = { paragraph: index, start: range.start, end: range.end, score: range.score };
    });
    if (best) return best;

    // The backend normally guarantees a verbatim excerpt, but stale cached
    // search data should still produce a useful visible highlight. Choose
    // the paragraph with the strongest word overlap and mark the paragraph
    // itself rather than silently opening a page with no indication at all.
    var wanted = new Set(normalizedOffsets(highlightText).text.split(/[^a-z0-9']+/).filter(function (word) { return word.length > 3; }));
    var overlapBest = null;
    paragraphs.forEach(function (paragraph, index) {
      var words = new Set(normalizedOffsets(paragraph).text.split(/[^a-z0-9']+/).filter(Boolean));
      var score = 0;
      wanted.forEach(function (word) { if (words.has(word)) score++; });
      if (!overlapBest || score > overlapBest.score) overlapBest = { paragraph: index, start: 0, end: paragraph.length, score: score };
    });
    return overlapBest;
  }

  function paragraphHtml(paragraph, range) {
    if (!range) return esc(paragraph).replace(/\n/g, '<br>');
    var start = range.start;
    var end = range.end;
    return esc(paragraph.slice(0, start)).replace(/\n/g, '<br>') +
      '<mark class="manual-passage-highlight" tabindex="-1">' + esc(paragraph.slice(start, end)).replace(/\n/g, '<br>') + '</mark>' +
      esc(paragraph.slice(end)).replace(/\n/g, '<br>');
  }

  function pageBody(page, side, highlightText, highlightPage) {
    if (!page) return '<section class="manual-page manual-page-' + side + ' manual-page-blank"><span>' + (side === 'left' ? 'The Reality Manual' : '') + '</span></section>';
    var paragraphs = String(page.text || '').split(/\n\s*\n/).filter(Boolean);
    var plan = page.page === highlightPage ? highlightPlan(paragraphs, highlightText) : null;
    var paragraphMarkup = paragraphs.map(function (paragraph, index) {
      return '<p>' + paragraphHtml(paragraph, plan && plan.paragraph === index ? plan : null) + '</p>';
    }).join('');
    return '<section class="manual-page manual-page-' + (page.page % 2 === 0 ? 'left' : 'right') + '" data-page="' + page.page + '">' +
      '<div class="manual-page-body">' + paragraphMarkup + '</div><span class="manual-page-number">' + page.page + '</span></section>';
  }

  function turnControls() {
    return '<button type="button" class="manual-turn manual-turn-prev" aria-label="Previous pages" title="Previous pages"><span>‹</span></button>' +
      '<button type="button" class="manual-turn manual-turn-next" aria-label="Next pages" title="Next pages"><span>›</span></button>';
  }

  // Size the physical spread from the stage's *actual remaining space*, not
  // the viewport. Laptop browser chrome + the app header/subtabs make those
  // materially different; the old 100dvh calculation could produce a book
  // taller than its own panel and then fit text against the wrong geometry.
  function fitBookGeometry() {
    var stage = root.querySelector('.manual-stage');
    var toolbar = root.querySelector('.manual-toolbar');
    var book = root.querySelector('#manualBook');
    if (!stage || !toolbar || !book) return;
    var stageStyle = getComputedStyle(stage);
    var toolbarStyle = getComputedStyle(toolbar);
    var availableWidth = stage.clientWidth - parseFloat(stageStyle.paddingLeft) - parseFloat(stageStyle.paddingRight);
    var availableHeight = stage.clientHeight - parseFloat(stageStyle.paddingTop) - parseFloat(stageStyle.paddingBottom) - toolbar.offsetHeight - parseFloat(toolbarStyle.marginBottom);
    var width = Math.min(1060, availableWidth * 0.96, availableHeight * (4 / 3));
    var height = Math.min(780, availableHeight, width * (3 / 4));
    width = Math.min(width, height * (4 / 3));
    book.style.width = Math.max(0, Math.floor(width)) + 'px';
    book.style.height = Math.max(0, Math.floor(height)) + 'px';
  }

  // Canonical pages vary in word count. Reduce only a long page's type until
  // the body fits inside its dedicated body region; the page-number footer is
  // outside that region and therefore can never sit on top of manuscript text.
  function fitSpread() {
    if (!isMounted()) return;
    fitBookGeometry();
    root.querySelectorAll('.manual-page:not(.manual-page-blank)').forEach(function (page) {
      page.style.fontSize = '';
      page.classList.remove('manual-page-compact');
      var body = page.querySelector('.manual-page-body');
      if (!body) return;
      body.classList.remove('manual-page-body-scroll');
      var size = parseFloat(getComputedStyle(page).fontSize);
      while (body.scrollHeight > body.clientHeight + 1 && size > 7.5) {
        size -= 0.25;
        page.style.fontSize = size + 'px';
      }
      if (body.scrollHeight > body.clientHeight + 1) {
        page.classList.add('manual-page-compact');
        size = 7.5;
        page.style.fontSize = size + 'px';
        while (body.scrollHeight > body.clientHeight + 1 && size > 4.5) {
          size -= 0.15;
          page.style.fontSize = size + 'px';
        }
      }
      // Last-resort accessibility guard for an unusually dense future page:
      // allow that page body to scroll rather than ever hiding manuscript
      // text. Current canonical pages fit before this fallback is needed.
      if (body.scrollHeight > body.clientHeight + 1) body.classList.add('manual-page-body-scroll');
    });
  }

  function bindPageTurns() {
    var previous = root.querySelector('.manual-turn-prev');
    var next = root.querySelector('.manual-turn-next');
    if (!previous || !next) return;
    previous.disabled = currentPage <= 1;
    next.disabled = currentPage >= pageCount;
    previous.onclick = function () { loadPage(Math.max(1, currentPage - 2)); };
    next.onclick = function () { loadPage(Math.min(pageCount, currentPage + 2)); };
  }

  function loadPage(page, highlightText) {
    page = Math.max(1, Math.min(pageCount, Number(page) || 1));
    currentPage = page;
    var input = root.querySelector('#manualPageInput');
    if (input) input.value = page;
    var book = root.querySelector('#manualBook');
    book.classList.remove('flipping');
    book.innerHTML = '<section class="manual-page manual-page-left manual-page-blank manual-page-loading">Opening…</section><section class="manual-page manual-page-right manual-page-blank"></section>' + turnControls();
    bindPageTurns();
    fitBookGeometry();
    return api('/pages/' + page).then(function (data) {
      if (!isMounted()) return;
      pageCount = data.pageCount;
      root.querySelector('#manualPageCount').textContent = 'of ' + pageCount;
      book.innerHTML = pageBody(data.left, 'left', highlightText, page) + pageBody(data.right, 'right', highlightText, page) + turnControls();
      bindPageTurns();
      void book.offsetWidth;
      book.classList.add('flipping');
      requestAnimationFrame(function () {
        fitSpread();
        var highlighted = book.querySelector('.manual-passage-highlight');
        if (highlighted) highlighted.focus({ preventScroll: true });
      });
    }).catch(function (error) {
      if (isMounted()) book.innerHTML = '<section class="manual-page manual-page-left manual-page-blank">' + esc(error.message) + '</section><section class="manual-page manual-page-right manual-page-blank"></section>';
    });
  }

  function renderResults(results) {
    var target = root.querySelector('#manualResults');
    target.innerHTML = (results || []).map(function (result) {
      return '<article class="manual-result" role="button" tabindex="0" data-page="' + result.page + '"><span class="manual-result-head"><span>' + esc(result.title) + '</span><span>p. ' + result.page + '</span></span><p>' + esc(result.relevance) + '</p><blockquote>“' + esc(result.excerpt) + '”</blockquote></article>';
    }).join('');
    target.querySelectorAll('.manual-result').forEach(function (resultCard, index) {
      function openResult() {
        var result = results[index];
        loadPage(Number(result.page), result.excerpt).then(function () {
          var stage = root.querySelector('.manual-stage');
          if (stage) stage.scrollTo({ top: 0, behavior: 'smooth' });
        });
      }
      resultCard.onclick = function () {
        var selection = window.getSelection();
        if (selection && !selection.isCollapsed && selection.toString()) return;
        openResult();
      };
      resultCard.onkeydown = function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openResult();
      };
    });
  }

  function setSearchStatus(message, state) {
    if (!isMounted()) return;
    var status = root.querySelector('#manualSearchStatus');
    status.textContent = message;
    status.className = 'manual-search-status' + (state ? ' ' + state : '');
  }

  function applySearchJob(job) {
    if (!isMounted()) return true;
    if (job.status === 'done') {
      setSearchStatus(job.results.length + ' relevant passage' + (job.results.length === 1 ? '' : 's') + ', ranked by ' + job.provider + '.');
      root.querySelector('#manualSearchButton').disabled = false;
      renderResults(job.results);
      return true;
    }
    if (job.status === 'error') {
      setSearchStatus(job.error || 'Search failed.', 'error');
      root.querySelector('#manualSearchButton').disabled = false;
      return true;
    }
    return false;
  }

  function pollSearch(id) {
    if (!isMounted()) return;
    api('/search/' + id).then(function (job) {
      if (!isMounted()) return;
      if (!applySearchJob(job)) {
        var activity = job.activity && job.activity.length ? ' ' + job.activity[job.activity.length - 1] : '';
        setSearchStatus('Preparing the manuscript index…' + activity, 'working');
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
      setSearchStatus('Searching the pre-indexed manuscript…', 'working');
      api('/search', { method: 'POST', body: JSON.stringify({ query: query }) }).then(function (job) {
        if (!applySearchJob(job)) pollSearch(job.id);
      }).catch(function (error) {
        setSearchStatus(error.message, 'error');
        if (isMounted()) root.querySelector('#manualSearchButton').disabled = false;
      });
    };
    // This finder is a single-query control even though a textarea gives
    // Harvey enough room to see a longer natural-language search. Plain
    // Enter submits immediately; Shift+Enter remains the deliberate way to
    // insert a line break. Ignore IME composition confirmation keystrokes.
    root.querySelector('#manualSearchQuery').onkeydown = function (event) {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      root.querySelector('#manualSearchForm').requestSubmit();
    };
  }

  function mount(container) {
    if (pollTimer) clearTimeout(pollTimer);
    root = container;
    root.innerHTML = '<div class="manual-reader"><aside class="manual-finder"><div class="eyebrow">Intelligent finder</div><h2>Search the Manual</h2><p class="manual-finder-intro">Describe an idea, question, quotation, or section. The pre-indexed semantic finder searches by meaning, ranks the strongest passages instantly, and opens the book at the result you choose.</p><form class="manual-search-form" id="manualSearchForm"><textarea id="manualSearchQuery" placeholder="e.g. What does the Manual say about why people cannot make themselves take action?"></textarea><button id="manualSearchButton" type="submit">Find relevant passages</button></form><div class="manual-search-status" id="manualSearchStatus" role="status" aria-live="polite"></div><div class="manual-results" id="manualResults"></div></aside><section class="manual-stage"><div class="manual-toolbar"><form class="manual-page-controls" id="manualPageForm"><button type="button" id="manualPrev" aria-label="Previous spread">←</button><label for="manualPageInput">Page</label><input id="manualPageInput" type="number" min="1" max="180" value="1" inputmode="numeric"><span class="manual-page-count" id="manualPageCount">of 180</span><button type="submit">Go</button><button type="button" id="manualNext" aria-label="Next spread">→</button></form></div><div class="manual-book" id="manualBook" aria-live="polite"></div></section></div>';
    bind();
    if (!resizeBound) {
      resizeBound = true;
      window.addEventListener('resize', function () { requestAnimationFrame(fitSpread); });
    }
    api('/meta').then(function (meta) {
      pageCount = meta.pageCount;
      if (isMounted()) root.querySelector('#manualPageCount').textContent = 'of ' + pageCount;
    });
    loadPage(currentPage);
  }

  window.RMManuscript = { mount: mount };
})();
