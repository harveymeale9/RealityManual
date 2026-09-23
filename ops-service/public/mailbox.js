(function () {
  'use strict';

  var root = null;
  var state = { folder: 'inbox', query: '', threads: [], selected: null, detail: null, status: null, files: [], draftId: null };
  var pollTimer = null;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function api(path, options) {
    return fetch('/api/mailbox' + path, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) { var error = new Error(body.error || 'request_failed'); error.status = response.status; error.body = body; throw error; }
        return body;
      });
    });
  }
  function when(value) {
    if (!value) return '';
    var date = new Date(value);
    var sameDay = date.toDateString() === new Date().toDateString();
    return sameDay ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  function addressLine(list) {
    return (list || []).map(function (item) { return typeof item === 'string' ? item : (item.name || item.email || ''); }).filter(Boolean).join(', ');
  }
  function updateBadge(status) {
    var badge = document.getElementById('mailUnreadBadge');
    if (!badge) return;
    var count = Number(status && status.unread) || 0;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = count < 1;
    var link = badge.closest('a');
    if (link) link.setAttribute('aria-label', count ? 'Mailbox, ' + count + ' unread' : 'Mailbox');
  }
  function refreshStatus() {
    return api('/status').then(function (status) { state.status = status; updateBadge(status); return status; }).catch(function () {});
  }
  function startBadgePolling() {
    if (pollTimer) return;
    refreshStatus();
    pollTimer = setInterval(refreshStatus, 60000);
  }

  var SHELL =
    '<section class="mail-app">' +
      '<aside class="mail-folders">' +
        '<div class="mail-account"><span class="eyebrow">Mailbox</span><strong>info@realitymanual.com</strong><small id="mailConnection">Checking connection…</small></div>' +
        '<button type="button" class="mail-compose-btn" id="mailCompose">＋ Compose</button>' +
        '<nav aria-label="Mailbox folders">' +
          '<button data-folder="inbox"><span>Inbox</span><b id="mailInboxCount"></b></button>' +
          '<button data-folder="starred"><span>Starred</span></button>' +
          '<button data-folder="drafts"><span>Drafts</span><b id="mailDraftCount"></b></button>' +
          '<button data-folder="sent"><span>Sent</span></button>' +
          '<button data-folder="archive"><span>Archive</span></button>' +
        '</nav>' +
      '</aside>' +
      '<section class="mail-list-column">' +
        '<header class="mail-list-head"><div><span class="eyebrow" id="mailFolderLabel">Inbox</span><h2>Customer email</h2></div><button type="button" id="mailRefresh" title="Refresh">↻</button></header>' +
        '<label class="mail-search"><span>⌕</span><input id="mailSearch" type="search" placeholder="Search people, subjects or messages" /></label>' +
        '<div class="mail-thread-list" id="mailThreadList"><div class="mail-loading">Loading mailbox…</div></div>' +
      '</section>' +
      '<section class="mail-reading" id="mailReading"><div class="mail-reading-empty"><span>✉</span><strong>Select a conversation</strong><p>Incoming customer messages and your replies will appear here.</p></div></section>' +
      '<div class="mail-compose-overlay" id="mailComposer" hidden>' +
        '<form class="mail-composer" id="mailComposeForm">' +
          '<header><div><span class="eyebrow" id="mailComposeKicker">New message</span><strong id="mailComposeTitle">Write an email</strong></div><button type="button" id="mailComposeClose" aria-label="Close">×</button></header>' +
          '<div class="mail-compose-fields"><label>To<input id="mailTo" type="text" autocomplete="off" placeholder="name@example.com" required /></label><label>Cc<input id="mailCc" type="text" autocomplete="off" placeholder="Optional" /></label><label>Subject<input id="mailSubject" type="text" maxlength="500" required /></label></div>' +
          '<div class="mail-formatbar"><button type="button" data-format="bold"><b>B</b></button><button type="button" data-format="italic"><i>I</i></button><button type="button" data-format="createLink">Link</button><button type="button" id="mailEmbedImage">Image</button><button type="button" id="mailAttach">Attach</button></div>' +
          '<div class="mail-editor" id="mailEditor" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="Write your message…"></div>' +
          '<input id="mailFileInput" type="file" multiple hidden /><input id="mailImageInput" type="file" accept="image/*" multiple hidden />' +
          '<div class="mail-file-list" id="mailFileList"></div>' +
          '<footer><span class="mail-compose-status" id="mailComposeStatus" role="status"></span><button type="button" class="mail-save-draft" id="mailSaveDraft">Save draft</button><button type="submit" class="btn-primary">Send</button></footer>' +
        '</form>' +
      '</div>' +
    '</section>';

  function renderConnection() {
    if (!root || !state.status) return;
    var el = root.querySelector('#mailConnection');
    if (!state.status.configured) el.textContent = 'Connection details needed';
    else if (state.status.connected) el.textContent = 'Connected · ' + state.status.provider;
    else el.textContent = state.status.syncError || 'Connecting to ' + state.status.provider + '…';
    el.classList.toggle('connected', !!state.status.connected);
    root.querySelector('#mailInboxCount').textContent = state.status.unread || '';
    root.querySelector('#mailDraftCount').textContent = state.status.drafts || '';
  }
  function participant(thread) {
    var people = thread.participants || [];
    var first = people[0] || {};
    return typeof first === 'string' ? first : (first.name || first.email || 'Unknown sender');
  }
  function renderThreads() {
    var list = root.querySelector('#mailThreadList');
    if (!state.threads.length) {
      var connection = state.status && !state.status.configured
        ? '<div class="mail-connect-note"><strong>Ready for the mailbox connection</strong><p>The interface and local drafts are live. Incoming and outgoing mail will switch on when the provider details are added.</p></div>' : '';
      list.innerHTML = connection + '<div class="mail-empty-list">No messages in ' + esc(state.folder) + '.</div>';
      return;
    }
    list.innerHTML = state.threads.map(function (thread) {
      return '<button type="button" class="mail-thread' + (thread.id === state.selected ? ' selected' : '') + (thread.unreadCount ? ' unread' : '') + '" data-thread="' + esc(thread.id) + '">' +
        '<span class="mail-thread-star" aria-hidden="true">' + (thread.starred ? '★' : '☆') + '</span>' +
        '<span class="mail-thread-main"><span class="mail-thread-from">' + esc(participant(thread)) + '</span><strong>' + esc(thread.subject) + '</strong><small>' + esc(thread.preview) + '</small></span>' +
        '<time>' + esc(when(thread.lastMessageAt)) + '</time>' +
        (thread.unreadCount ? '<i>' + thread.unreadCount + '</i>' : '') + '</button>';
    }).join('');
    list.querySelectorAll('[data-thread]').forEach(function (button) {
      button.addEventListener('click', function () { openThread(button.dataset.thread); });
    });
  }
  function loadThreads() {
    root.querySelector('#mailFolderLabel').textContent = state.folder.charAt(0).toUpperCase() + state.folder.slice(1);
    root.querySelectorAll('.mail-folders [data-folder]').forEach(function (button) { button.classList.toggle('active', button.dataset.folder === state.folder); });
    root.querySelector('#mailThreadList').innerHTML = '<div class="mail-loading">Loading…</div>';
    return api('/threads?folder=' + encodeURIComponent(state.folder) + '&q=' + encodeURIComponent(state.query)).then(function (data) {
      state.threads = data.threads || [];
      if (state.selected && !state.threads.some(function (thread) { return thread.id === state.selected; })) state.selected = null;
      renderThreads();
    }).catch(function () { root.querySelector('#mailThreadList').innerHTML = '<div class="mail-error">Could not load the mailbox.</div>'; });
  }
  function syncMailbox() {
    var button = root && root.querySelector('#mailRefresh');
    if (button) button.disabled = true;
    return api('/sync', { method: 'POST' }).catch(function () {}).then(function () {
      return refreshStatus();
    }).then(function () {
      renderConnection();
      return loadThreads();
    }).finally(function () { if (button) button.disabled = false; });
  }
  function messageBody(message) {
    var body = message.textBody || String(message.htmlBody || '').replace(/<[^>]+>/g, ' ');
    return '<div class="mail-message-body">' + esc(body).replace(/\n/g, '<br>') + '</div>';
  }
  function renderReading() {
    var area = root.querySelector('#mailReading');
    if (!state.detail) return;
    var thread = state.detail.thread;
    var messages = state.detail.messages || [];
    area.innerHTML = '<header class="mail-reading-head"><div><span class="eyebrow">Conversation</span><h2>' + esc(thread.subject) + '</h2><p>' + esc(addressLine(thread.participants)) + '</p></div><div class="mail-reading-actions"><button type="button" data-action="back" class="mail-reading-back" title="Back">←</button>' +
      '<button type="button" data-action="star" title="Star">' + (thread.starred ? '★' : '☆') + '</button>' +
      '<button type="button" data-action="unread" title="Mark unread">●</button>' +
      '<button type="button" data-action="archive" title="Archive">Archive</button></div></header>' +
      '<div class="mail-messages">' + messages.map(function (message) {
        var who = message.direction === 'outbound' ? 'Reality Manual' : (message.from.name || message.from.email);
        return '<article class="mail-message ' + message.direction + '"><header><div><strong>' + esc(who) + '</strong><small>' + esc(message.from.email) + '</small></div><time>' + esc(new Date(message.createdAt).toLocaleString()) + '</time></header>' +
          messageBody(message) + (message.attachments.length ? '<div class="mail-attachments">' + message.attachments.map(function (file) { return '<a href="/api/mailbox/attachments/' + encodeURIComponent(file.id) + '" target="_blank" rel="noopener">' + esc(file.fileName) + '</a>'; }).join('') + '</div>' : '') + '</article>';
      }).join('') + '</div>' +
      '<footer class="mail-reply-bar"><button type="button" class="btn-primary" id="mailReply">Reply</button><button type="button" id="mailReplyAll">Reply all</button></footer>';
    area.querySelector('#mailReply').addEventListener('click', function () { openComposer(true, false); });
    area.querySelector('#mailReplyAll').addEventListener('click', function () { openComposer(true, true); });
    area.querySelector('[data-action="star"]').addEventListener('click', function () { patchThread({ starred: !thread.starred }); });
    area.querySelector('[data-action="unread"]').addEventListener('click', function () { patchThread({ read: false }); });
    area.querySelector('[data-action="archive"]').addEventListener('click', function () { patchThread({ folder: 'archive' }); });
    area.querySelector('[data-action="back"]').addEventListener('click', function () { root.querySelector('.mail-app').classList.remove('thread-open'); });
  }
  function openThread(id) {
    state.selected = id;
    root.querySelector('.mail-app').classList.add('thread-open');
    renderThreads();
    root.querySelector('#mailReading').innerHTML = '<div class="mail-loading">Opening conversation…</div>';
    api('/threads/' + encodeURIComponent(id)).then(function (data) {
      state.detail = data;
      renderReading();
      refreshStatus().then(renderConnection);
      loadThreads();
    });
  }
  function patchThread(body) {
    api('/threads/' + encodeURIComponent(state.selected), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(function () {
      if (body.folder) { state.selected = null; state.detail = null; root.querySelector('#mailReading').innerHTML = '<div class="mail-reading-empty"><span>✉</span><strong>Conversation archived</strong></div>'; }
      else return openThread(state.selected);
      return loadThreads();
    }).then(function () { refreshStatus().then(renderConnection); });
  }

  function splitAddresses(value) { return String(value || '').split(/[,;]+/).map(function (item) { return item.trim(); }).filter(Boolean); }
  function resetComposer() {
    state.files = []; state.draftId = null;
    ['mailTo', 'mailCc', 'mailSubject'].forEach(function (id) { root.querySelector('#' + id).value = ''; });
    root.querySelector('#mailEditor').innerHTML = '';
    root.querySelector('#mailComposeStatus').textContent = '';
    renderFiles();
  }
  function openComposer(reply, replyAll) {
    resetComposer();
    var overlay = root.querySelector('#mailComposer');
    if (reply && state.detail) {
      var messages = state.detail.messages || [];
      var inbound = messages.slice().reverse().find(function (message) { return message.direction === 'inbound'; });
      var recipients = inbound ? [inbound.from.email] : [];
      if (replyAll && inbound) recipients = recipients.concat((inbound.to || []).map(function (item) { return typeof item === 'string' ? item : item.email; }).filter(function (email) { return email && email !== 'info@realitymanual.com'; }));
      root.querySelector('#mailTo').value = recipients.filter(function (item, index, all) { return all.indexOf(item) === index; }).join(', ');
      root.querySelector('#mailSubject').value = /^re:/i.test(state.detail.thread.subject) ? state.detail.thread.subject : 'Re: ' + state.detail.thread.subject;
      root.querySelector('#mailComposeKicker').textContent = 'Reply';
      root.querySelector('#mailComposeTitle').textContent = state.detail.thread.subject;
    } else {
      root.querySelector('#mailComposeKicker').textContent = 'New message';
      root.querySelector('#mailComposeTitle').textContent = 'Write an email';
    }
    overlay.hidden = false;
    setTimeout(function () { (reply ? root.querySelector('#mailEditor') : root.querySelector('#mailTo')).focus(); }, 30);
  }
  function closeComposer() { root.querySelector('#mailComposer').hidden = true; }
  function addFiles(files, inline) {
    Array.from(files || []).forEach(function (file) {
      var token = 'rm-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      state.files.push({ file: file, inline: !!inline, contentId: inline ? token : '' });
      if (inline) {
        var reader = new FileReader();
        reader.onload = function () {
          root.querySelector('#mailEditor').focus();
          document.execCommand('insertHTML', false, '<img src="' + reader.result + '" data-mail-cid="' + token + '" alt="' + esc(file.name) + '">');
        };
        reader.readAsDataURL(file);
      }
    });
    renderFiles();
  }
  function renderFiles() {
    var list = root.querySelector('#mailFileList');
    list.innerHTML = state.files.map(function (item, index) { return '<span>' + (item.inline ? 'Image · ' : '') + esc(item.file.name) + '<button type="button" data-remove-file="' + index + '" aria-label="Remove">×</button></span>'; }).join('');
    list.querySelectorAll('[data-remove-file]').forEach(function (button) { button.addEventListener('click', function () { state.files.splice(Number(button.dataset.removeFile), 1); renderFiles(); }); });
  }
  function formData() {
    var form = new FormData();
    form.append('draftId', state.draftId || '');
    form.append('threadId', state.detail ? state.detail.thread.id : '');
    form.append('inReplyTo', state.detail && state.detail.messages.length ? state.detail.messages[state.detail.messages.length - 1].id : '');
    form.append('to', JSON.stringify(splitAddresses(root.querySelector('#mailTo').value)));
    form.append('cc', JSON.stringify(splitAddresses(root.querySelector('#mailCc').value)));
    form.append('subject', root.querySelector('#mailSubject').value);
    var html = root.querySelector('#mailEditor').innerHTML;
    state.files.filter(function (item) { return item.inline; }).forEach(function (item) {
      html = html.replace(new RegExp('src="data:[^"]+" data-mail-cid="' + item.contentId + '"'), 'src="cid:' + item.contentId + '"');
    });
    form.append('htmlBody', html);
    form.append('textBody', root.querySelector('#mailEditor').innerText);
    form.append('attachmentMeta', JSON.stringify(state.files.map(function (item) { return { inline: item.inline, contentId: item.contentId }; })));
    state.files.forEach(function (item) { form.append('attachments', item.file, item.file.name); });
    return form;
  }
  function submitComposer(send) {
    var status = root.querySelector('#mailComposeStatus');
    status.textContent = send ? 'Sending…' : 'Saving…';
    api(send ? '/send' : '/drafts', { method: 'POST', body: formData() }).then(function (data) {
      var draft = data.draft || data.message;
      state.draftId = draft && draft.id;
      state.files = []; renderFiles();
      status.textContent = send ? 'Sent' : 'Draft saved';
      refreshStatus().then(renderConnection);
      loadThreads();
      if (send) setTimeout(closeComposer, 450);
    }).catch(function (error) {
      if (error.body && error.body.draft) {
        state.draftId = error.body.draft.id;
        state.files = []; renderFiles();
        status.textContent = 'Saved to Drafts — connect the mailbox to send';
        refreshStatus().then(renderConnection); loadThreads();
      } else status.textContent = 'Could not save this message';
    });
  }

  function bind() {
    root.querySelector('#mailCompose').addEventListener('click', function () { openComposer(false, false); });
    root.querySelector('#mailComposeClose').addEventListener('click', closeComposer);
    root.querySelector('#mailComposer').addEventListener('click', function (event) { if (event.target === event.currentTarget) closeComposer(); });
    root.querySelector('#mailRefresh').addEventListener('click', syncMailbox);
    root.querySelector('.mail-folders nav').addEventListener('click', function (event) { var button = event.target.closest('[data-folder]'); if (!button) return; state.folder = button.dataset.folder; state.selected = null; state.detail = null; root.querySelector('.mail-app').classList.remove('thread-open'); root.querySelector('#mailReading').innerHTML = '<div class="mail-reading-empty"><span>✉</span><strong>Select a conversation</strong></div>'; loadThreads(); });
    var searchTimer;
    root.querySelector('#mailSearch').addEventListener('input', function (event) { clearTimeout(searchTimer); state.query = event.target.value; searchTimer = setTimeout(loadThreads, 180); });
    root.querySelector('#mailComposeForm').addEventListener('submit', function (event) { event.preventDefault(); submitComposer(true); });
    root.querySelector('#mailSaveDraft').addEventListener('click', function () { submitComposer(false); });
    root.querySelector('#mailAttach').addEventListener('click', function () { root.querySelector('#mailFileInput').click(); });
    root.querySelector('#mailEmbedImage').addEventListener('click', function () { root.querySelector('#mailImageInput').click(); });
    root.querySelector('#mailFileInput').addEventListener('change', function (event) { addFiles(event.target.files, false); event.target.value = ''; });
    root.querySelector('#mailImageInput').addEventListener('change', function (event) { addFiles(event.target.files, true); event.target.value = ''; });
    root.querySelectorAll('[data-format]').forEach(function (button) { button.addEventListener('click', function () { var value = button.dataset.format === 'createLink' ? prompt('Link URL') : null; if (button.dataset.format !== 'createLink' || value) document.execCommand(button.dataset.format, false, value); root.querySelector('#mailEditor').focus(); }); });
    root.querySelector('#mailEditor').addEventListener('paste', function (event) {
      var images = Array.from(event.clipboardData && event.clipboardData.files || []).filter(function (file) { return /^image\//.test(file.type); });
      if (images.length) { event.preventDefault(); addFiles(images, true); }
    });
  }
  function mount(container) {
    root = container;
    state.folder = 'inbox'; state.query = ''; state.threads = []; state.selected = null; state.detail = null;
    root.innerHTML = SHELL;
    bind();
    refreshStatus().then(function (status) {
      renderConnection();
      return status && status.configured ? syncMailbox() : loadThreads();
    });
  }

  window.RMMailbox = { mount: mount, startBadgePolling: startBadgePolling };
})();
