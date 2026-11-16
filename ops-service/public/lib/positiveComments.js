(function () {
  'use strict';

  function mount(root) {
    if (!root || root.dataset.positiveCommentsReady) return;
    root.dataset.positiveCommentsReady = '1';
    var quote = root.querySelector('[data-positive-quote]');
    var author = root.querySelector('[data-positive-author]');
    var link = root.querySelector('[data-positive-link]');
    var status = root.querySelector('[data-positive-status]');
    var connect = root.querySelector('[data-positive-connect]');
    var count = root.querySelector('[data-positive-count]');
    var previous = root.querySelector('[data-positive-prev]');
    var next = root.querySelector('[data-positive-next]');
    var rows = [];
    var index = 0;
    var timer = null;

    function paint() {
      if (!rows.length) {
        quote.textContent = '';
        author.textContent = '';
        link.hidden = true;
        count.textContent = '';
        previous.disabled = true;
        next.disabled = true;
        return;
      }
      var row = rows[index];
      quote.textContent = '“' + row.text + '”';
      author.textContent = row.author + ' · ' + new Date(row.publishedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
      // API data is never interpolated into markup, and links remain on YouTube.
      var url;
      try { url = new URL(row.url); } catch (error) { url = null; }
      link.hidden = !url || url.hostname !== 'www.youtube.com' || url.protocol !== 'https:';
      if (!link.hidden) link.href = url.href;
      count.textContent = (index + 1) + ' / ' + rows.length;
      previous.disabled = rows.length < 2;
      next.disabled = rows.length < 2;
    }

    previous.addEventListener('click', function () { index = (index - 1 + rows.length) % rows.length; paint(); });
    next.addEventListener('click', function () { index = (index + 1) % rows.length; paint(); });

    function refresh() {
      if (document.body.classList.contains('role-reviewer')) return;
      fetch('/api/youtube/positive-comments', { credentials: 'include', cache: 'no-store' })
        .then(function (response) { if (!response.ok) throw new Error('unavailable'); return response.json(); })
        .then(function (data) {
          var selectedId = rows[index] && rows[index].id;
          rows = Array.isArray(data.comments) ? data.comments : [];
          index = Math.max(0, rows.findIndex(function (row) { return row.id === selectedId; }));
          if (!selectedId || !rows.length) index = 0;
          paint();
          if (!data.connected) status.textContent = 'Connect YouTube in Content Settings to see kind comments.';
          else if (data.requiresReconnect) status.textContent = data.error;
          else if (data.error) status.textContent = data.error;
          else if (data.loading && !rows.length) status.textContent = 'Looking through your YouTube comments…';
          else if (!rows.length) status.textContent = 'No clearly positive comments found yet.';
          else status.textContent = data.partial ? 'Newest matches shown; older comments are still beyond the scan limit.' : 'Clearly positive comments, newest first.';
          connect.hidden = !!data.connected && !data.requiresReconnect;
          connect.textContent = data.connected ? 'Reconnect YouTube ↗' : 'Connect YouTube ↗';
          clearTimeout(timer);
          timer = setTimeout(refresh, data.loading ? 3000 : 10 * 60000);
        }).catch(function () {
          status.textContent = 'Comments are unavailable right now.';
          connect.hidden = true;
          clearTimeout(timer);
          timer = setTimeout(refresh, 60000);
        });
    }
    root.refreshPositiveComments = refresh;
    return root;
  }

  window.RMPositiveComments = { mount: mount };
}());
