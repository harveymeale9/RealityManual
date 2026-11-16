(function () {
  'use strict';
  function mount(root) {
    if (!root || root.dataset.positiveCommentsReady) return root;
    root.dataset.positiveCommentsReady = '1';
    var track = root.querySelector('[data-positive-track]');
    var dots = root.querySelector('[data-positive-dots]');
    var status = root.querySelector('[data-positive-status]');
    var connect = root.querySelector('[data-positive-connect]');
    var count = root.querySelector('[data-positive-count]');
    var rows = [], index = 0, refreshTimer, rotateTimer, paused = false, drag = null, suppressClick = false;
    var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function step() { return track.children.length ? track.children[0].getBoundingClientRect().width + 10 : 1; }
    function maxIndex() { return Math.max(0, Math.min(rows.length - 1, Math.ceil((track.scrollWidth - track.clientWidth) / Math.max(step(), 1)))); }
    function goTo(next, behavior) {
      index = Math.max(0, Math.min(maxIndex(), next));
      if (track.children[index]) track.scrollTo({ left: track.children[index].offsetLeft - track.children[0].offsetLeft, behavior: behavior || 'smooth' });
      paintDots();
    }
    function paintDots() {
      dots.replaceChildren();
      var last = maxIndex();
      if (!last) return;
      var number = Math.min(5, last + 1);
      for (var i = 0; i < number; i++) {
        var target = Math.round(i * last / (number - 1));
        var dot = document.createElement('button');
        dot.type = 'button';
        dot.setAttribute('aria-label', 'Show kind words ' + (target + 1) + ' onward');
        dot.setAttribute('aria-current', String(Math.round(index * (number - 1) / last) === i));
        dot.addEventListener('click', (function (position) { return function () { goTo(position); }; })(target));
        dots.appendChild(dot);
      }
    }
    function safeUrl(value) {
      try { var url = new URL(value); return url.protocol === 'https:' && url.hostname === 'www.youtube.com' ? url.href : null; }
      catch (error) { return null; }
    }
    function relativeAge(value) {
      var elapsed = Math.max(0, Date.now() - Date.parse(value));
      if (!Number.isFinite(elapsed)) return '';
      var minutes = Math.floor(elapsed / 60000);
      if (minutes < 1) return 'just now';
      if (minutes < 60) return minutes + ' minute' + (minutes === 1 ? '' : 's') + ' ago';
      var hours = Math.floor(minutes / 60);
      if (hours < 24) return hours + ' hour' + (hours === 1 ? '' : 's') + ' ago';
      var days = Math.floor(hours / 24);
      if (days < 30) return days + ' day' + (days === 1 ? '' : 's') + ' ago';
      var months = Math.floor(days / 30);
      if (months < 12) return months + ' month' + (months === 1 ? '' : 's') + ' ago';
      var years = Math.floor(days / 365);
      return years + ' year' + (years === 1 ? '' : 's') + ' ago';
    }
    function updateAges() {
      root.querySelectorAll('[data-positive-age]').forEach(function (node) { node.textContent = relativeAge(node.dataset.positiveAge); });
    }
    function render() {
      track.replaceChildren();
      rows.forEach(function (row) {
        var card = document.createElement('article'); card.className = 'positive-comments-card';
        var video = document.createElement('div'); video.className = 'positive-comments-card-video';
        var videoLabel = document.createElement('span'); videoLabel.className = 'positive-comments-video-label'; videoLabel.textContent = 'ON';
        var videoTitle = document.createElement('span'); videoTitle.className = 'positive-comments-video-title'; videoTitle.textContent = row.videoTitle || 'YouTube video'; videoTitle.title = videoTitle.textContent;
        video.append(videoLabel, videoTitle);
        var identity = document.createElement('div'); identity.className = 'positive-comments-card-identity';
        var avatar = document.createElement('span'); avatar.className = 'positive-comments-card-avatar'; avatar.setAttribute('aria-hidden', 'true'); avatar.textContent = (row.author || 'V').replace(/^@/, '').charAt(0).toUpperCase();
        var byline = document.createElement('div'); byline.className = 'positive-comments-card-byline';
        var author = document.createElement('strong'); author.className = 'positive-comments-card-author'; author.textContent = row.author || 'YouTube viewer';
        var date = document.createElement('time'); date.className = 'positive-comments-card-age'; date.dateTime = row.publishedAt; date.title = new Date(row.publishedAt).toLocaleString(); date.dataset.positiveAge = row.publishedAt; date.textContent = relativeAge(row.publishedAt);
        byline.append(author, date); identity.append(avatar, byline);
        var source = document.createElement('span'); source.className = 'positive-comments-card-source'; source.textContent = 'YouTube'; identity.appendChild(source);
        var quote = document.createElement('p'); quote.className = 'positive-comments-card-quote'; quote.textContent = '“' + row.text + '”';
        var meta = document.createElement('div'); meta.className = 'positive-comments-card-meta';
        var url = safeUrl(row.url);
        if (url) { var link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'View on YouTube ↗'; meta.appendChild(link); }
        card.append(video, identity, quote, meta); track.appendChild(card);
      });
      count.textContent = rows.length ? '· ' + rows.length : '';
      requestAnimationFrame(function () { goTo(index, 'instant'); });
    }
    function startRotation() {
      clearInterval(rotateTimer);
      if (reducedMotion || rows.length < 2) return;
      rotateTimer = setInterval(function () { if (!paused && document.visibilityState === 'visible' && maxIndex()) goTo(index >= maxIndex() ? 0 : index + 1); }, 6500);
    }
    root.addEventListener('mouseenter', function () { paused = true; });
    root.addEventListener('mouseleave', function () { paused = false; });
    root.addEventListener('focusin', function () { paused = true; });
    root.addEventListener('focusout', function () { paused = false; });
    track.addEventListener('pointerdown', function (event) {
      if (event.pointerType === 'touch') { paused = true; return; }
      if (event.target.closest('a')) return;
      paused = true; drag = { x: event.clientX, left: track.scrollLeft, moved: false };
      track.classList.add('is-dragging'); track.setPointerCapture(event.pointerId);
    });
    track.addEventListener('pointermove', function (event) {
      if (!drag) return;
      var delta = event.clientX - drag.x;
      if (Math.abs(delta) > 5) drag.moved = true;
      track.scrollLeft = drag.left - delta;
    });
    function endDrag() {
      if (!drag) return;
      suppressClick = drag.moved; drag = null; track.classList.remove('is-dragging');
      paused = root.matches(':hover') || root.contains(document.activeElement);
      goTo(Math.round(track.scrollLeft / Math.max(step(), 1)));
    }
    track.addEventListener('pointerup', endDrag); track.addEventListener('pointercancel', endDrag);
    track.addEventListener('touchend', function () { paused = root.matches(':hover') || root.contains(document.activeElement); }, { passive: true });
    track.addEventListener('click', function (event) { if (suppressClick) { event.preventDefault(); suppressClick = false; } }, true);
    track.addEventListener('scroll', function () { if (track.children.length) { index = Math.min(maxIndex(), Math.max(0, Math.round(track.scrollLeft / Math.max(step(), 1)))); paintDots(); } }, { passive: true });
    track.addEventListener('keydown', function (event) { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); goTo(index + (event.key === 'ArrowRight' ? 1 : -1)); } });
    window.addEventListener('resize', function () { goTo(index, 'instant'); });
    setInterval(updateAges, 60000);
    function refresh() {
      if (document.body.classList.contains('role-reviewer')) return;
      fetch('/api/youtube/positive-comments', { credentials: 'include', cache: 'no-store' })
        .then(function (response) { if (!response.ok) throw new Error('unavailable'); return response.json(); })
        .then(function (data) {
          var selectedId = rows[index] && rows[index].id;
          rows = Array.isArray(data.comments) ? data.comments : [];
          index = selectedId ? Math.max(0, rows.findIndex(function (row) { return row.id === selectedId; })) : 0;
          render(); startRotation();
          if (!data.connected) status.textContent = 'Connect YouTube in Content Settings to see kind comments.';
          else if (data.requiresReconnect || data.error) status.textContent = data.error;
          else if (data.loading && !rows.length) status.textContent = 'Looking through your YouTube comments…';
          else if (!rows.length) status.textContent = 'No direct praise or personal-impact comments found yet.';
          else status.textContent = data.partial ? 'Recent matches shown; older comments are beyond the scan limit.' : 'Praise and personal impact, newest first.';
          connect.hidden = !!data.connected && !data.requiresReconnect;
          connect.textContent = data.connected ? 'Reconnect YouTube ↗' : 'Connect YouTube ↗';
          clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, data.loading ? 3000 : 10 * 60000);
        }).catch(function () { status.textContent = 'Comments are unavailable right now.'; connect.hidden = true; clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 60000); });
    }
    root.refreshPositiveComments = refresh;
    return root;
  }
  window.RMPositiveComments = { mount: mount };
}());
