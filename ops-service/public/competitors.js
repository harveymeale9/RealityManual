(function () {
  'use strict';

  var root = null;
  var channels = [];
  var busy = false;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function api(path, options) {
    options = options || {};
    options.credentials = 'include';
    options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    return fetch(path, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.message || data.error || 'YouTube request failed.');
        return data;
      });
    });
  }

  function number(value) {
    if (value == null) return '—';
    return new Intl.NumberFormat('en', { notation: Number(value) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(Number(value) || 0);
  }

  function date(value) {
    if (!value) return 'Unknown date';
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
  }

  function duration(seconds) {
    if (seconds == null) return '';
    seconds = Number(seconds) || 0;
    var hours = Math.floor(seconds / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    var secs = seconds % 60;
    return (hours ? hours + ':' + String(minutes).padStart(2, '0') : String(minutes)) + ':' + String(secs).padStart(2, '0');
  }

  function setStatus(message, isError) {
    if (!root) return;
    var target = root.querySelector('#competitorStatus');
    if (!target) return;
    target.textContent = message || '';
    target.className = 'competitor-status' + (isError ? ' error' : '');
  }

  function videoCard(video, total) {
    return '<a class="competitor-video' + (video.viewRank === 1 ? ' is-winner' : '') + '" href="https://www.youtube.com/watch?v=' + encodeURIComponent(video.id) + '" target="_blank" rel="noopener">' +
      '<div class="competitor-thumb">' +
        (video.thumbnailUrl ? '<img src="' + esc(video.thumbnailUrl) + '" alt="" loading="lazy">' : '') +
        '<span class="competitor-rank">#' + video.viewRank + ' of ' + total + '</span>' +
        (video.durationSeconds != null ? '<span class="competitor-duration">' + duration(video.durationSeconds) + '</span>' : '') +
      '</div>' +
      '<div class="competitor-video-body"><h4>' + esc(video.title) + '</h4>' +
        '<div class="competitor-video-date">' + date(video.publishedAt) + '</div>' +
        '<div class="competitor-video-stats"><span><b>' + number(video.views) + '</b> views</span><span><b>' + number(video.likes) + '</b> likes</span><span><b>' + number(video.comments) + '</b> comments</span></div>' +
      '</div></a>';
  }

  function channelCard(record) {
    var snapshot = record.snapshot;
    if (!snapshot) {
      return '<section class="competitor-channel"><div class="competitor-channel-head"><div><h3>' + esc(record.title || record.input) + '</h3><p>' + esc(record.input) + '</p></div><button class="competitor-remove" data-id="' + esc(record.channelId) + '">Remove</button></div>' +
        '<div class="competitor-channel-error">' + esc(record.lastError || 'This channel needs to be refreshed.') + '</div></section>';
    }
    var videos = snapshot.videos || [];
    var ranked = videos.slice().sort(function (a, b) { return a.viewRank - b.viewRank; });
    var winner = ranked[0];
    return '<section class="competitor-channel">' +
      '<div class="competitor-channel-head">' +
        '<div class="competitor-identity">' + (snapshot.thumbnailUrl ? '<img src="' + esc(snapshot.thumbnailUrl) + '" alt="">' : '') +
          '<div><h3>' + esc(snapshot.title) + '</h3><p>' + esc(snapshot.handle || record.input) + ' · refreshed ' + date(record.refreshedAt) + '</p></div></div>' +
        '<button class="competitor-remove" data-id="' + esc(record.channelId) + '">Remove</button>' +
      '</div>' +
      (record.lastError ? '<div class="competitor-channel-error">Latest refresh failed: ' + esc(record.lastError) + '</div>' : '') +
      '<div class="competitor-summary">' +
        '<div><b>' + number(snapshot.subscriberCount) + '</b><span>' + (snapshot.subscriberHidden ? 'Subscribers hidden' : 'Subscribers') + '</span></div>' +
        '<div><b>' + number(snapshot.averageViews) + '</b><span>Average views · latest ' + videos.length + '</span></div>' +
        '<div><b>' + number(snapshot.totalVideoCount) + '</b><span>Public videos</span></div>' +
      '</div>' +
      (winner ? '<div class="competitor-winner"><span>Current winner</span><strong>#1 of ' + videos.length + '</strong><p>' + esc(winner.title) + ' · ' + number(winner.views) + ' views</p></div>' : '') +
      (videos.length ? '<div class="competitor-video-grid">' + ranked.map(function (video) { return videoCard(video, videos.length); }).join('') + '</div>' : '<div class="competitor-empty">No public uploads were returned.</div>') +
    '</section>';
  }

  function renderChannels() {
    if (!root) return;
    var target = root.querySelector('#competitorChannels');
    if (!target) return;
    target.innerHTML = channels.length
      ? channels.map(channelCard).join('')
      : '<div class="competitor-empty"><strong>No competitors added yet.</strong><span>Paste a YouTube @handle or channel URL above to build the watchlist.</span></div>';
    target.querySelectorAll('.competitor-remove').forEach(function (button) {
      button.onclick = function () {
        if (busy || !window.confirm('Remove this competitor from the watchlist?')) return;
        busy = true;
        button.disabled = true;
        api('/api/youtube/competitors/' + encodeURIComponent(button.dataset.id), { method: 'DELETE' })
          .then(load).catch(function (error) { setStatus(error.message, true); }).finally(function () { busy = false; });
      };
    });
  }

  function load() {
    return api('/api/youtube/competitors').then(function (data) {
      channels = data.channels || [];
      renderChannels();
      return channels;
    });
  }

  function refresh() {
    if (busy || !channels.length) return Promise.resolve();
    busy = true;
    var button = root.querySelector('#competitorRefresh');
    if (button) { button.disabled = true; button.textContent = 'Refreshing…'; }
    setStatus('Fetching the latest public YouTube statistics…');
    return api('/api/youtube/competitors/refresh', { method: 'POST', body: '{}' })
      .then(function (data) {
        channels = data.channels || [];
        renderChannels();
        var failures = channels.filter(function (channel) { return !!channel.lastError; }).length;
        setStatus(failures
          ? (failures + ' channel' + (failures === 1 ? '' : 's') + ' could not refresh; the last good results were kept.')
          : 'Up to date. Rankings use current public views across each channel’s latest ten uploads.', failures > 0);
      }).catch(function (error) { setStatus(error.message, true); })
      .finally(function () {
        busy = false;
        if (button) { button.disabled = false; button.textContent = 'Refresh all'; }
      });
  }

  function bind() {
    root.querySelector('#competitorAddForm').onsubmit = function (event) {
      event.preventDefault();
      if (busy) return;
      var input = root.querySelector('#competitorChannelInput');
      var value = input.value.trim();
      if (!value) return;
      busy = true;
      var button = root.querySelector('#competitorAddButton');
      button.disabled = true;
      button.textContent = 'Adding…';
      setStatus('Resolving channel and reading its latest public videos…');
      api('/api/youtube/competitors', { method: 'POST', body: JSON.stringify({ channel: value }) })
        .then(function () { input.value = ''; return load(); })
        .then(function () { setStatus('Channel added.'); })
        .catch(function (error) { setStatus(error.message, true); })
        .finally(function () { busy = false; button.disabled = false; button.textContent = 'Add channel'; });
    };
    root.querySelector('#competitorRefresh').onclick = refresh;
  }

  function mount(container) {
    root = container;
    root.innerHTML = '<div class="competitor-workspace">' +
      '<header class="competitor-hero"><div><div class="eyebrow">YouTube competitor intelligence</div><h2>Find the one-of-ten winners</h2><p>Track selected channels and see which of their latest ten public uploads currently ranks first by views. Uses the YouTube connection already in Content Studio—nothing else to connect.</p></div><button id="competitorRefresh" type="button">Refresh all</button></header>' +
      '<form class="competitor-add" id="competitorAddForm"><label for="competitorChannelInput">YouTube channel</label><div><input id="competitorChannelInput" placeholder="@handle or youtube.com/@handle" autocomplete="off"><button id="competitorAddButton" type="submit">Add channel</button></div><small>Use an @handle or /channel/UC… URL. Requiring an exact channel avoids YouTube search quota entirely.</small></form>' +
      '<div class="competitor-status" id="competitorStatus" role="status" aria-live="polite"></div>' +
      '<div class="competitor-note">Rank is based on current public view counts within the channel’s latest ten available uploads—not private Studio retention or equal-age velocity data.</div>' +
      '<div class="competitor-channels" id="competitorChannels"><div class="competitor-loading"><div class="spinner"></div></div></div>' +
    '</div>';
    bind();
    load().then(function (items) {
      // Refresh on entry when any snapshot is absent or over six hours old;
      // repeated tab visits otherwise remain instant and quota-light.
      var stale = items.some(function (item) {
        return !item.snapshot || !item.refreshedAt || Date.now() - new Date(item.refreshedAt).getTime() > 6 * 60 * 60 * 1000;
      });
      if (stale) refresh();
    }).catch(function (error) { setStatus(error.message, true); });
  }

  window.RMCompetitors = { mount: mount };
})();
