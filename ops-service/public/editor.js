(function () {
  'use strict';

  var root = null;
  var projects = [];
  var project = null;
  var selected = new Set();
  var history = [];
  var pollTimer = null;
  var mountToken = 0;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function api(url, options) {
    options = options || {};
    options.credentials = 'same-origin';
    options.headers = Object.assign({}, options.headers || {});
    if (options.body && typeof options.body === 'string') options.headers['Content-Type'] = 'application/json';
    return fetch(url, options).then(function (response) {
      if (response.status === 401) { location.reload(); throw new Error('Session expired'); }
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) throw new Error(body.message || body.error || 'Request failed');
        return body;
      });
    });
  }

  function formatTime(seconds) {
    seconds = Math.max(0, Number(seconds) || 0);
    var minutes = Math.floor(seconds / 60);
    return minutes + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
  }

  function editedDuration(item) {
    return Math.max(0, Number(item.duration || 0) - (item.cuts || []).reduce(function (sum, cut) {
      return sum + Number(cut.end - cut.start || 0);
    }, 0));
  }

  function statusLabel(item) {
    if (item.transcriptionStatus === 'pending' || item.transcriptionStatus === 'running') return 'Transcribing';
    if (item.transcriptionStatus === 'error') return 'Needs attention';
    if (item.renderStatus === 'running') return 'Rendering';
    if (item.renderStatus === 'ready') return 'Export ready';
    return 'Ready to edit';
  }

  function shell() {
    root.innerHTML =
      '<section class="video-editor">' +
        '<header class="editor-heading"><div><div class="eyebrow">Content production</div><h1>Editor</h1>' +
          '<p>Upload a raw recording, remove dead air, cut mistakes from the transcript, and export a captioned video.</p></div>' +
          '<label class="editor-upload btn-primary"><input id="editorFile" type="file" accept="video/*" hidden>Upload raw video</label></header>' +
        '<div class="editor-upload-progress" id="editorUploadProgress" hidden><span id="editorUploadLabel">Uploading…</span><div><i id="editorUploadBar"></i></div></div>' +
        '<div class="editor-layout"><aside class="editor-projects"><div class="editor-aside-title">Recordings</div><div id="editorProjectList"></div></aside>' +
          '<main class="editor-workspace" id="editorWorkspace"><div class="editor-empty"><strong>No recording selected</strong><span>Upload a raw video to begin.</span></div></main></div>' +
      '</section>';
    root.querySelector('#editorFile').addEventListener('change', function () {
      if (this.files && this.files[0]) upload(this.files[0]);
      this.value = '';
    });
  }

  function renderList() {
    var list = root && root.querySelector('#editorProjectList');
    if (!list) return;
    if (!projects.length) {
      list.innerHTML = '<div class="editor-projects-empty">Your recordings will appear here.</div>';
      return;
    }
    list.innerHTML = projects.map(function (item) {
      return '<button class="editor-project' + (project && item.id === project.id ? ' active' : '') + '" data-id="' + esc(item.id) + '">' +
        '<strong>' + esc(item.name) + '</strong><span>' + esc(statusLabel(item)) + ' · ' + formatTime(item.duration) + '</span></button>';
    }).join('');
    list.querySelectorAll('.editor-project').forEach(function (button) {
      button.addEventListener('click', function () { openProject(button.dataset.id); });
    });
  }

  function upload(file) {
    var progress = root.querySelector('#editorUploadProgress');
    var bar = root.querySelector('#editorUploadBar');
    var label = root.querySelector('#editorUploadLabel');
    progress.hidden = false;
    bar.style.width = '0%';
    label.textContent = 'Uploading ' + file.name + '…';
    var data = new FormData();
    data.append('video', file);
    data.append('name', file.name.replace(/\.[^.]+$/, ''));
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/editor');
    xhr.withCredentials = true;
    xhr.upload.onprogress = function (event) {
      if (event.lengthComputable) bar.style.width = Math.round(event.loaded / event.total * 100) + '%';
    };
    xhr.onload = function () {
      progress.hidden = true;
      var body = {};
      try { body = JSON.parse(xhr.responseText || '{}'); } catch (e) {}
      if (xhr.status < 200 || xhr.status >= 300) return alert(body.message || 'The recording could not be uploaded.');
      projects.unshift(body);
      renderList();
      openProject(body.id);
    };
    xhr.onerror = function () { progress.hidden = true; alert('Upload failed. Check the connection and try again.'); };
    xhr.send(data);
  }

  function loadProjects() {
    return api('/api/editor').then(function (items) {
      projects = items;
      renderList();
      if (!project && projects[0]) return openProject(projects[0].id);
    });
  }

  function openProject(id, quiet) {
    clearTimeout(pollTimer);
    return api('/api/editor/' + encodeURIComponent(id)).then(function (item) {
      project = item;
      projects = projects.map(function (entry) { return entry.id === item.id ? item : entry; });
      selected.clear();
      if (!quiet) history = [];
      renderList();
      renderWorkspace();
      schedulePoll();
    }).catch(function (error) {
      if (!quiet) alert(error.message);
    });
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!project) return;
    var active = ['pending', 'running'].indexOf(project.transcriptionStatus) !== -1 || project.renderStatus === 'running';
    if (!active) return;
    var id = project.id;
    var token = mountToken;
    pollTimer = setTimeout(function () {
      if (token === mountToken && project && project.id === id) openProject(id, true);
    }, 1800);
  }

  function renderWorkspace() {
    var workspace = root.querySelector('#editorWorkspace');
    if (!project) return;
    if (project.transcriptionStatus !== 'ready') {
      var isError = project.transcriptionStatus === 'error';
      workspace.innerHTML = '<div class="editor-processing"><div class="editor-processing-icon' + (isError ? ' error' : '') + '">' + (isError ? '!' : '') + '</div>' +
        '<h2>' + (isError ? 'Transcription needs attention' : 'Building the transcript…') + '</h2><p>' +
        esc(isError ? project.transcriptionError : 'We are finding every spoken word and its exact position in the recording.') + '</p>' +
        (isError ? '<button class="btn-primary" id="editorRetry">Retry transcription</button>' : '') + '</div>';
      if (isError) workspace.querySelector('#editorRetry').onclick = function () {
        api('/api/editor/' + project.id + '/transcribe', { method: 'POST' }).then(function () { project.transcriptionStatus = 'running'; renderWorkspace(); schedulePoll(); });
      };
      return;
    }
    var removed = new Set((project.removedWordIndices || []).map(Number));
    var cutSeconds = Math.max(0, Number(project.duration) - editedDuration(project));
    workspace.innerHTML =
      '<div class="editor-topbar"><div><h2>' + esc(project.name) + '</h2><span>' + formatTime(project.duration) + ' original · ' + formatTime(editedDuration(project)) + ' edited · ' + cutSeconds.toFixed(1) + 's removed</span></div>' +
        '<button class="editor-delete" id="editorDelete">Delete recording</button></div>' +
      '<div class="editor-preview"><video id="editorVideo" controls playsinline preload="metadata" src="/api/editor/' + encodeURIComponent(project.id) + '/source"></video>' +
        '<div class="editor-caption" id="editorCaption"></div></div>' +
      '<div class="editor-controls"><label class="editor-toggle"><input type="checkbox" id="editorAutoSilence" ' + (project.autoSilenceEnabled !== false ? 'checked' : '') + '><span></span>Automatically remove long pauses</label>' +
        '<span class="editor-help">Natural mode leaves a short breath between phrases.</span></div>' +
      '<section class="editor-transcript-panel"><div class="editor-transcript-head"><div><div class="eyebrow">Transcript editor</div><h3>Select words or sentences to cut them from the video</h3></div>' +
        '<div class="editor-transcript-actions"><button class="btn-secondary btn-tiny" id="editorUndo" ' + (!history.length ? 'disabled' : '') + '>Undo</button>' +
        '<button class="btn-secondary btn-tiny" id="editorRestore" disabled>Restore selected</button><button class="btn-primary btn-tiny" id="editorCut" disabled>Cut selected</button></div></div>' +
        '<div class="editor-transcript" id="editorTranscript">' + (project.words || []).map(function (word) {
          return '<span class="editor-word' + (removed.has(word.index) ? ' removed' : '') + '" data-index="' + word.index + '" data-start="' + word.start + '" data-end="' + word.end + '">' + esc(word.text) + '</span> ';
        }).join('') + '</div><p class="editor-selection-hint">Drag across text to select a sentence, or click individual words. Removed words remain visible so you can restore them.</p></section>' +
      '<div class="editor-export"><div><strong>Next: Content Production</strong><span>' +
        (project.productionPieceId ? 'This edit is ready in Content Production for titles, thumbnail, and ambient music.' :
          project.renderStatus === 'ready' ? 'Send the finished edit across without uploading it again.' :
          'Finish the edit first. Yellow captions will be baked in below center.') + '</span>' +
        (project.renderStatus === 'error' ? '<em>' + esc(project.renderError) + '</em>' : '') + '</div><div class="editor-export-actions">' +
        (project.productionPieceId ? '<button class="btn-primary" id="editorOpenProduction">Open Content Production</button>' :
          project.renderStatus === 'ready' ? '<button class="btn-primary" id="editorSendProduction">Send to Production</button>' :
          '<button class="btn-primary" id="editorRender" ' + (project.renderStatus === 'running' ? 'disabled' : '') + '>' + (project.renderStatus === 'running' ? 'Finishing edit…' : 'Finish edit') + '</button>') +
        '</div></div>';
    bindWorkspace();
  }

  function bindWorkspace() {
    var video = root.querySelector('#editorVideo');
    var caption = root.querySelector('#editorCaption');
    var transcript = root.querySelector('#editorTranscript');
    var lastClicked = null;
    var ignoreNextClick = false;
    video.addEventListener('timeupdate', function () {
      var cut = (project.cuts || []).filter(function (item) { return video.currentTime >= item.start && video.currentTime < item.end; })[0];
      if (cut && cut.end < video.duration) { video.currentTime = cut.end + 0.01; return; }
      var group = (project.captionGroups || []).filter(function (item) {
        return video.currentTime >= item.sourceStart && video.currentTime <= item.sourceEnd + 0.18;
      })[0];
      caption.replaceChildren();
      var isLongform = Number(project.width) >= Number(project.height);
      caption.classList.toggle('longform', isLongform);
      caption.classList.toggle('shortform', !isLongform);
      if (group && Array.isArray(group.words) && isLongform) {
        group.words.forEach(function (word, index) {
          var span = document.createElement('span');
          span.textContent = word.text + (index + 1 < group.words.length ? ' ' : '');
          var emphasisEnd = index + 1 < group.words.length ? group.words[index + 1].sourceStart : group.sourceEnd + 0.18;
          span.className = video.currentTime >= word.sourceStart && video.currentTime < emphasisEnd ? 'active' : '';
          caption.appendChild(span);
        });
      } else if (group && Array.isArray(group.words)) {
        var spokenWord = group.words.filter(function (word, index) {
          var wordEnd = index + 1 < group.words.length ? group.words[index + 1].sourceStart : group.sourceEnd + 0.18;
          return video.currentTime >= word.sourceStart && video.currentTime < wordEnd;
        })[0];
        caption.textContent = spokenWord ? spokenWord.text : '';
      } else if (group) caption.textContent = group.text;
      caption.classList.toggle('visible', !!group);
    });
    transcript.addEventListener('click', function (event) {
      if (ignoreNextClick) { ignoreNextClick = false; return; }
      var word = event.target.closest('.editor-word');
      if (!word) return;
      var index = Number(word.dataset.index);
      if (event.shiftKey && lastClicked !== null) {
        var start = Math.min(lastClicked, index); var end = Math.max(lastClicked, index);
        for (var i = start; i <= end; i++) selected.add(i);
      } else if (selected.has(index)) selected.delete(index); else selected.add(index);
      lastClicked = index;
      paintSelection();
    });
    transcript.addEventListener('mouseup', function () {
      var selection = window.getSelection();
      if (!selection || selection.isCollapsed || !transcript.contains(selection.anchorNode) || !transcript.contains(selection.focusNode)) return;
      function spanFor(node) { return (node.nodeType === 1 ? node : node.parentElement).closest('.editor-word'); }
      var first = spanFor(selection.anchorNode); var last = spanFor(selection.focusNode);
      if (!first || !last) return;
      var start = Math.min(Number(first.dataset.index), Number(last.dataset.index));
      var end = Math.max(Number(first.dataset.index), Number(last.dataset.index));
      for (var i = start; i <= end; i++) selected.add(i);
      selection.removeAllRanges();
      ignoreNextClick = true;
      paintSelection();
    });
    root.querySelector('#editorCut').onclick = function () { alterSelected(true); };
    root.querySelector('#editorRestore').onclick = function () { alterSelected(false); };
    root.querySelector('#editorUndo').onclick = undo;
    root.querySelector('#editorAutoSilence').onchange = function () {
      save({ autoSilenceEnabled: this.checked }, true);
    };
    var renderButton = root.querySelector('#editorRender');
    if (renderButton) renderButton.onclick = function () {
        api('/api/editor/' + project.id + '/render', { method: 'POST' }).then(function () {
          project.renderStatus = 'running'; renderWorkspace(); schedulePoll();
        }).catch(function (error) { alert(error.message); });
      };
    var sendButton = root.querySelector('#editorSendProduction');
    if (sendButton) sendButton.onclick = function () {
      sendButton.disabled = true;
      sendButton.textContent = 'Sending…';
      api('/api/editor/' + project.id + '/production', { method: 'POST' }).then(function (result) {
        if (typeof window.__rmOpenContentProduction === 'function') return window.__rmOpenContentProduction(result.pieceId, result.piece);
        location.hash = 'upload-files';
      }).catch(function (error) {
        sendButton.disabled = false;
        sendButton.textContent = 'Send to Production';
        alert(error.message);
      });
    };
    var openButton = root.querySelector('#editorOpenProduction');
    if (openButton) openButton.onclick = function () {
      if (typeof window.__rmOpenContentProduction === 'function') window.__rmOpenContentProduction(project.productionPieceId);
      else location.hash = 'upload-files';
    };
    root.querySelector('#editorDelete').onclick = function () {
      if (!confirm('Delete this recording and its rendered export?')) return;
      var id = project.id;
      api('/api/editor/' + id, { method: 'DELETE' }).then(function () {
        projects = projects.filter(function (item) { return item.id !== id; });
        project = null; history = []; selected.clear(); renderList();
        root.querySelector('#editorWorkspace').innerHTML = '<div class="editor-empty"><strong>Recording deleted</strong><span>Select another recording or upload a new one.</span></div>';
        if (projects[0]) openProject(projects[0].id);
      });
    };
  }

  function paintSelection() {
    root.querySelectorAll('.editor-word').forEach(function (word) {
      word.classList.toggle('selected', selected.has(Number(word.dataset.index)));
    });
    var removed = new Set((project.removedWordIndices || []).map(Number));
    var hasKept = Array.from(selected).some(function (index) { return !removed.has(index); });
    var hasRemoved = Array.from(selected).some(function (index) { return removed.has(index); });
    root.querySelector('#editorCut').disabled = !hasKept;
    root.querySelector('#editorRestore').disabled = !hasRemoved;
  }

  function alterSelected(remove) {
    var prior = (project.removedWordIndices || []).slice();
    var next = new Set(prior.map(Number));
    selected.forEach(function (index) { if (remove) next.add(index); else next.delete(index); });
    history.push(prior);
    selected.clear();
    save({ removedWordIndices: Array.from(next).sort(function (a, b) { return a - b; }) });
  }

  function undo() {
    if (!history.length) return;
    selected.clear();
    save({ removedWordIndices: history.pop() });
  }

  function save(patch, preserveHistory) {
    return api('/api/editor/' + project.id, { method: 'PATCH', body: JSON.stringify(patch) }).then(function (item) {
      project = item;
      projects = projects.map(function (entry) { return entry.id === item.id ? item : entry; });
      if (!preserveHistory && history.length > 100) history.shift();
      renderList(); renderWorkspace();
    }).catch(function (error) { alert(error.message); });
  }

  window.RMEditor = {
    mount: function (element) {
      mountToken++;
      clearTimeout(pollTimer);
      root = element; projects = []; project = null; selected.clear(); history = [];
      shell();
      loadProjects().catch(function (error) {
        root.querySelector('#editorWorkspace').innerHTML = '<div class="editor-empty"><strong>Editor unavailable</strong><span>' + esc(error.message) + '</span></div>';
      });
    }
  };
})();
