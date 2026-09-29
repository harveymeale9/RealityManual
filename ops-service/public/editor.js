(function () {
  'use strict';

  var root = null;
  var projects = [];
  var project = null;
  var selected = new Set();
  var history = [];
  var pollTimer = null;
  var mountToken = 0;
  var editorNotice = '';
  var previewModes = {};
  var previewSeekTimes = {};
  var saveQueues = {};
  var saveStates = {};
  var restoreTranscriptFocus = false;
  var listFilter = localStorage.getItem('rmEditorListFilter') === 'sent' ? 'sent' : 'active';
  var reviewRate = Number(localStorage.getItem('rmEditorReviewRate')) || 1;
  if ([1, 1.25, 1.5, 2].indexOf(reviewRate) === -1) reviewRate = 1;

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

  function displayName(item) {
    if (!item || !item.planningPieceTitle) return item && item.name || 'Untitled recording';
    return (item.planningPieceSeq ? '#' + String(item.planningPieceSeq).padStart(3, '0') + ' · ' : '') + item.planningPieceTitle;
  }

  function editedDuration(item) {
    return Math.max(0, Number(item.duration || 0) - (item.cuts || []).reduce(function (sum, cut) {
      return sum + Number(cut.end - cut.start || 0);
    }, 0));
  }

  function sourceToEditedTime(sourceTime, cuts) {
    var removed = 0;
    sourceTime = Math.max(0, Number(sourceTime) || 0);
    (cuts || []).forEach(function (cut) {
      if (sourceTime >= cut.end) removed += cut.end - cut.start;
      else if (sourceTime > cut.start) removed += sourceTime - cut.start;
    });
    return Math.max(0, sourceTime - removed);
  }

  function editedToSourceTime(editedTime, item) {
    var target = Math.max(0, Number(editedTime) || 0);
    var cursor = 0;
    var sourceCursor = 0;
    var cuts = (item.cuts || []).slice().sort(function (a, b) { return a.start - b.start; });
    for (var index = 0; index < cuts.length; index++) {
      var kept = Math.max(0, cuts[index].start - sourceCursor);
      if (target <= cursor + kept) return sourceCursor + (target - cursor);
      cursor += kept;
      sourceCursor = Math.max(sourceCursor, cuts[index].end);
    }
    return Math.min(Number(item.duration) || sourceCursor + target - cursor, sourceCursor + target - cursor);
  }

  function statusLabel(item) {
    function queued(label, position) {
      position = Number(position) || 0;
      return position > 1 ? label + ' · ' + (position - 1) + ' ahead' : position === 1 ? 'Next: ' + label.toLowerCase() : label;
    }
    if (item.productionPieceId) return 'Sent to Production';
    if (item.transcriptionStatus === 'pending') return queued('Waiting for transcript', item.transcriptionQueuePosition);
    if (item.transcriptionStatus === 'running') return 'Transcribing';
    if (item.transcriptionStatus === 'error') return 'Needs attention';
    if (item.classificationStatus === 'error' || item.retakeAnalysisStatus === 'error' || item.planningMatchStatus === 'error' || item.renderStatus === 'error') return 'Needs attention';
    if (item.classificationStatus === 'pending') return queued('Waiting for frame analysis', item.classificationQueuePosition);
    if (item.classificationStatus === 'running') return 'Analyzing frame';
    if (item.retakeAnalysisStatus === 'pending') return queued('Waiting for retake review', item.retakeQueuePosition);
    if (item.retakeAnalysisStatus === 'running') return 'Checking retakes';
    if (item.planningMatchStatus === 'pending') return queued('Waiting for plan match', item.planningQueuePosition);
    if (item.planningMatchStatus === 'running') return 'Matching plan';
    if (item.renderStatus === 'queued') return queued('Waiting to render', item.renderQueuePosition);
    if (item.renderStatus === 'running') return 'Rendering' + (Number(item.renderProgress) > 0 ? ' · ' + Math.round(Number(item.renderProgress)) + '%' : '');
    if (item.renderStatus === 'ready') return 'Ready for approval';
    return 'Ready to edit';
  }

  function sessionBucket(item) {
    if (item.productionPieceId) return 'sent';
    if (item.transcriptionStatus === 'error' || item.classificationStatus === 'error' || item.retakeAnalysisStatus === 'error' || item.planningMatchStatus === 'error' || item.renderStatus === 'error') return 'attention';
    if (item.renderStatus === 'ready') return 'ready';
    if (['pending', 'running'].indexOf(item.transcriptionStatus) !== -1 || ['pending', 'running'].indexOf(item.classificationStatus) !== -1 || ['pending', 'running', 'pending_transcript'].indexOf(item.retakeAnalysisStatus) !== -1 || ['pending', 'running', 'pending_transcript'].indexOf(item.planningMatchStatus) !== -1 || ['queued', 'running'].indexOf(item.renderStatus) !== -1) return 'working';
    return 'prepared';
  }

  function nextActionableProject(excludedId) {
    var priority = { ready: 0, attention: 1, prepared: 2, working: 3 };
    return projects.filter(function (item) {
      return !item.productionPieceId && item.id !== excludedId;
    }).sort(function (a, b) {
      var bucketDifference = priority[sessionBucket(a)] - priority[sessionBucket(b)];
      return bucketDifference || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    })[0] || null;
  }

  function renderSessionSummary() {
    var summary = root && root.querySelector('#editorSessionSummary');
    if (!summary) return;
    if (!projects.length) { summary.hidden = true; summary.innerHTML = ''; return; }
    var counts = { working: 0, ready: 0, attention: 0, prepared: 0, sent: 0 };
    projects.forEach(function (item) { counts[sessionBucket(item)]++; });
    var labels = { working: 'processing', ready: 'ready to approve', attention: 'need attention', prepared: 'prepared', sent: 'sent' };
    summary.innerHTML = '<strong>' + projects.length + ' recording' + (projects.length === 1 ? '' : 's') + '</strong>' + Object.keys(counts).filter(function (key) { return counts[key]; }).map(function (key) {
      return '<span class="' + key + '"><i></i>' + counts[key] + ' ' + labels[key] + '</span>';
    }).join('');
    summary.hidden = false;
  }

  function typeLabel(value) {
    return { ultra_short: 'Ultra-short', short: 'Short', long_short: 'Long-short', longform: 'Longform' }[value] || 'Automatic';
  }

  function planningOptionsHtml(item) {
    var selected = item.planningPieceId || '';
    return '<option value=""' + (!selected ? ' selected' : '') + '>No linked planning card</option>' + (item.planningCandidates || []).map(function (candidate) {
      return '<option value="' + esc(candidate.id) + '"' + (candidate.id === selected ? ' selected' : '') + '>#' + String(candidate.seq || '').padStart(3, '0') + ' · ' + esc(candidate.title || 'Untitled') + ' · ' + esc(candidate.stage || '') + '</option>';
    }).join('');
  }

  function timelineHtml(item) {
    var total = Math.max(0.01, Number(item.duration) || 0.01);
    var cuts = item.cuts || [];
    var words = item.words || [];
    function cutAt(start, end) {
      return cuts.some(function (cut) { return cut.start < end && cut.end > start; });
    }
    var spans = [];
    var cursor = 0;
    words.forEach(function (word) {
      if (word.start > cursor) spans.push({ kind: cutAt(cursor, word.start) ? 'cut' : 'pause', start: cursor, end: word.start, label: 'Pause ' + (word.start - cursor).toFixed(1) + 's' });
      spans.push({ kind: 'speech', start: word.start, end: word.end, label: word.text });
      cursor = Math.max(cursor, word.end);
    });
    if (cursor < total) spans.push({ kind: cutAt(cursor, total) ? 'cut' : 'pause', start: cursor, end: total, label: 'Pause ' + (total - cursor).toFixed(1) + 's' });
    return '<div class="editor-timeline-track" id="editorTimelineTrack">' + spans.map(function (span) {
      var left = span.start / total * 100;
      var width = Math.max(0.18, (span.end - span.start) / total * 100);
      return '<button type="button" class="editor-timeline-segment ' + span.kind + '" style="left:' + left.toFixed(4) + '%;width:' + width.toFixed(4) + '%" data-time="' + span.start + '" title="' + esc(span.label) + '"></button>';
    }).join('') + '<i class="editor-playhead" id="editorPlayhead"></i></div>';
  }

  function gapReviewHtml(item) {
    if (!item.autoSilenceEnabled) return '<div class="editor-review-empty">Pause removal is off. The original timing is preserved.</div>';
    var decisions = item.gapDecisions || [];
    if (!decisions.length) return '<div class="editor-review-empty">No long pauses need attention.</div>';
    return decisions.map(function (gap) {
      return '<div class="editor-decision ' + (gap.restored ? 'kept' : 'removed') + '"><div><strong>' + esc(gap.label) + '</strong><span>' + gap.duration.toFixed(1) + 's ' + (gap.restored ? 'kept in the edit' : 'removed') + '</span></div>' +
        '<div class="editor-decision-actions"><button type="button" class="btn-secondary btn-tiny editor-preview-cut" data-time="' + Math.max(0, gap.start - 1.2) + '">Preview</button><button type="button" class="btn-secondary btn-tiny editor-gap-toggle" data-gap-id="' + esc(gap.id) + '" data-restored="' + (gap.restored ? '1' : '0') + '">' + (gap.restored ? 'Remove pause' : 'Keep pause') + '</button></div></div>';
    }).join('');
  }

  function retakeReviewHtml(item) {
    var dismissed = new Set((item.dismissedRetakeIds || []).map(String));
    var removed = new Set((item.removedWordIndices || []).map(Number));
    var candidates = (item.retakeCandidates || []).filter(function (candidate) {
      return !dismissed.has(candidate.id);
    });
    if (!candidates.length && (item.retakeAnalysisStatus === 'pending' || item.retakeAnalysisStatus === 'running')) return '<div class="editor-review-empty editor-review-loading">Checking for false starts and repeated takes…</div>';
    if (!candidates.length) return '<div class="editor-review-empty">No likely retakes need review.</div>';
    return candidates.map(function (candidate) {
      var applied = candidate.removeWordIndices.every(function (index) { return removed.has(index); });
      var firstWord = (item.words || [])[candidate.removeWordIndices[0]];
      return '<div class="editor-retake-card' + (applied ? ' applied' : '') + '"><div class="editor-retake-badge ' + esc(candidate.confidence) + '">' + (applied ? 'Removed automatically' : candidate.confidence === 'high' ? 'Likely retake' : 'Check repetition') + '</div>' +
        '<p><del>“' + esc(candidate.firstText) + '”</del></p><p class="replacement">Latest take: “' + esc(candidate.replacementText) + '”</p><span>' + esc(candidate.reason) + '</span>' +
        '<div><button type="button" class="btn-secondary btn-tiny editor-preview-cut" data-time="' + Math.max(0, Number(firstWord && firstWord.start) - 1.2) + '">Preview edit</button>' + (applied ? '' : '<button type="button" class="btn-primary btn-tiny editor-retake-apply" data-id="' + esc(candidate.id) + '">Use latest take</button>') + '<button type="button" class="btn-secondary btn-tiny editor-retake-dismiss" data-id="' + esc(candidate.id) + '" data-applied="' + (applied ? '1' : '0') + '">' + (applied ? 'Restore first take' : 'Keep both') + '</button></div></div>';
    }).join('');
  }

  function processingStepsHtml(item) {
    function step(state, label, detail) {
      return '<div class="editor-process-step ' + state + '"><i></i><div><strong>' + esc(label) + '</strong><span>' + esc(detail) + '</span></div></div>';
    }
    var transcriptState = item.transcriptionStatus === 'error' ? 'error' : item.transcriptionStatus === 'ready' ? 'done' : 'active';
    var frameState = item.classificationStatus === 'error' ? 'error' : item.classificationStatus === 'ready' ? 'done' : item.classificationStatus === 'running' || item.classificationStatus === 'pending' ? 'active' : 'waiting';
    var retakeState = item.retakeAnalysisStatus === 'error' ? 'error' : item.retakeAnalysisStatus === 'ready' ? 'done' : item.retakeAnalysisStatus === 'running' || item.retakeAnalysisStatus === 'pending' ? 'active' : 'waiting';
    var planState = item.planningMatchStatus === 'error' ? 'error' : item.planningMatchStatus === 'ready' ? 'done' : item.planningMatchStatus === 'running' || item.planningMatchStatus === 'pending' ? 'active' : 'waiting';
    return '<div class="editor-processing-steps">' + step('done', 'Recording secured', 'Original master preserved') +
      step(transcriptState, 'Word-timed transcript', transcriptState === 'done' ? 'Speech mapped' : transcriptState === 'error' ? 'Needs retry' : item.transcriptionStatus === 'pending' && Number(item.transcriptionQueuePosition) > 1 ? (Number(item.transcriptionQueuePosition) - 1) + ' recording(s) ahead' : 'Listening for every word') +
      step(frameState, 'Publishing frame', frameState === 'done' ? 'Composition detected' : frameState === 'error' ? 'Manual choice available' : item.classificationStatus === 'pending' && Number(item.classificationQueuePosition) > 1 ? (Number(item.classificationQueuePosition) - 1) + ' recording(s) ahead' : frameState === 'active' ? 'Inspecting the book framing' : 'Waiting') +
      step(retakeState, 'Retake review', retakeState === 'done' ? 'Decisions ready' : retakeState === 'error' ? 'Can be retried' : item.retakeAnalysisStatus === 'pending' && Number(item.retakeQueuePosition) > 1 ? (Number(item.retakeQueuePosition) - 1) + ' recording(s) ahead' : retakeState === 'active' ? 'Comparing nearby takes' : 'Starts after transcription') +
      step(planState, 'Planning card', planState === 'done' ? 'Workflow linked' : planState === 'error' ? 'Manual choice available' : item.planningMatchStatus === 'pending' && Number(item.planningQueuePosition) > 1 ? (Number(item.planningQueuePosition) - 1) + ' recording(s) ahead' : planState === 'active' ? 'Matching filmed content' : 'Starts after transcription') + '</div>';
  }

  function failedSteps(item) {
    var labels = [];
    if (item.transcriptionStatus === 'error') labels.push('transcript');
    if (item.classificationStatus === 'error') labels.push('framing');
    if (item.retakeAnalysisStatus === 'error') labels.push('retake review');
    if (item.planningMatchStatus === 'error') labels.push('planning match');
    if (item.renderStatus === 'error') labels.push('final render');
    return labels;
  }

  function shell() {
    root.innerHTML =
      '<section class="video-editor">' +
        '<header class="editor-heading"><div><div class="eyebrow">Content production</div><h1>Editor</h1>' +
          '<p>Drop in a filming session. Each recording is framed, transcribed, cleaned and prepared for your approval.</p></div>' +
          '<label class="editor-upload btn-primary"><input id="editorFile" type="file" accept="video/*" multiple hidden>Upload raw videos</label></header>' +
        '<div class="editor-upload-progress" id="editorUploadProgress" hidden><span id="editorUploadLabel">Uploading…</span><div><i id="editorUploadBar"></i></div></div>' +
        '<div class="editor-notice" id="editorNotice" hidden></div>' +
        '<div class="editor-session-summary" id="editorSessionSummary" hidden></div>' +
        '<div class="editor-layout"><aside class="editor-projects"><div class="editor-aside-head"><div class="editor-aside-title">Recordings</div><div class="editor-list-filters"><button type="button" data-filter="active">Active</button><button type="button" data-filter="sent">Sent</button></div></div><div id="editorProjectList"></div></aside>' +
          '<main class="editor-workspace" id="editorWorkspace"><div class="editor-empty"><strong>No recording selected</strong><span>Upload a raw video to begin.</span></div></main></div>' +
        '<div class="editor-drop-overlay" id="editorDropOverlay"><strong>Drop filming session</strong><span>Every video will enter the automatic edit queue</span></div>' +
      '</section>';
    root.querySelector('#editorFile').addEventListener('change', function () {
      if (this.files && this.files[0]) uploadFiles(this.files);
      this.value = '';
    });
    var shellNode = root.querySelector('.video-editor');
    var overlay = root.querySelector('#editorDropOverlay');
    var dragDepth = 0;
    shellNode.addEventListener('dragenter', function (event) { event.preventDefault(); dragDepth++; overlay.classList.add('visible'); });
    shellNode.addEventListener('dragover', function (event) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; });
    shellNode.addEventListener('dragleave', function (event) { event.preventDefault(); dragDepth--; if (dragDepth <= 0) { dragDepth = 0; overlay.classList.remove('visible'); } });
    shellNode.addEventListener('drop', function (event) {
      event.preventDefault(); dragDepth = 0; overlay.classList.remove('visible');
      if (event.dataTransfer && event.dataTransfer.files) uploadFiles(event.dataTransfer.files);
    });
    root.querySelectorAll('.editor-list-filters button').forEach(function (button) {
      button.addEventListener('click', function () {
        listFilter = button.dataset.filter;
        localStorage.setItem('rmEditorListFilter', listFilter);
        renderList();
      });
    });
  }

  function renderNotice() {
    var notice = root && root.querySelector('#editorNotice');
    if (!notice) return;
    notice.textContent = editorNotice;
    notice.hidden = !editorNotice;
  }

  function renderList() {
    var list = root && root.querySelector('#editorProjectList');
    if (!list) return;
    renderSessionSummary();
    var activeCount = projects.filter(function (item) { return !item.productionPieceId; }).length;
    var sentCount = projects.length - activeCount;
    var visibleProjects = projects.filter(function (item) { return listFilter === 'sent' ? !!item.productionPieceId : !item.productionPieceId; }).sort(function (a, b) {
      if (listFilter === 'sent') return String(b.sentToProductionAt || b.updatedAt || '').localeCompare(String(a.sentToProductionAt || a.updatedAt || ''));
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
    var asideTitle = root.querySelector('.editor-aside-title');
    if (asideTitle) asideTitle.textContent = 'Recordings · ' + (listFilter === 'sent' ? sentCount : activeCount);
    root.querySelectorAll('.editor-list-filters button').forEach(function (button) {
      button.classList.toggle('active', button.dataset.filter === listFilter);
      button.textContent = (button.dataset.filter === 'sent' ? 'Sent ' + sentCount : 'Active ' + activeCount);
    });
    if (!projects.length) {
      list.innerHTML = '<div class="editor-projects-empty">Your recordings will appear here.</div>';
      return;
    }
    if (!visibleProjects.length) {
      list.innerHTML = '<div class="editor-projects-empty">' + (listFilter === 'sent' ? 'No recordings have been sent yet.' : 'All recordings in this session are in Production.') + '</div>';
      return;
    }
    list.innerHTML = visibleProjects.map(function (item) {
      return '<button class="editor-project' + (project && item.id === project.id ? ' active' : '') + '" data-id="' + esc(item.id) + '">' +
        '<strong>' + esc(displayName(item)) + '</strong><span>' + esc(statusLabel(item)) + ' · ' + formatTime(item.duration) + '</span></button>';
    }).join('');
    list.querySelectorAll('.editor-project').forEach(function (button) {
      button.addEventListener('click', function () { openProject(button.dataset.id); });
    });
  }

  function upload(file, queueIndex, queueTotal) {
    return new Promise(function (resolve, reject) {
    var progress = root.querySelector('#editorUploadProgress');
    var bar = root.querySelector('#editorUploadBar');
    var label = root.querySelector('#editorUploadLabel');
    progress.hidden = false;
    bar.style.width = Math.round(queueIndex / queueTotal * 100) + '%';
    label.textContent = 'Uploading ' + (queueIndex + 1) + ' of ' + queueTotal + ' · ' + file.name;
    var data = new FormData();
    data.append('video', file);
    data.append('name', file.name.replace(/\.[^.]+$/, ''));
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/editor');
    xhr.withCredentials = true;
    xhr.upload.onprogress = function (event) {
      if (event.lengthComputable) bar.style.width = Math.round((queueIndex + event.loaded / event.total) / queueTotal * 100) + '%';
    };
    xhr.onload = function () {
      var body = {};
      try { body = JSON.parse(xhr.responseText || '{}'); } catch (e) {}
      if (xhr.status < 200 || xhr.status >= 300) {
        var uploadError = new Error(body.message || 'The recording could not be uploaded.');
        uploadError.duplicate = body.error === 'duplicate_recording';
        return reject(uploadError);
      }
      projects.unshift(body);
      renderList();
      resolve(body);
    };
    xhr.onerror = function () { reject(new Error('Upload failed. Check the connection and try again.')); };
    xhr.send(data);
    });
  }

  function uploadFiles(fileList) {
    var duplicateCount = 0;
    var files = Array.prototype.slice.call(fileList || []).filter(function (file) {
      return String(file.type || '').indexOf('video') === 0;
    });
    if (!files.length) return alert('Drop one or more video files.');
    var created = [];
    var failures = [];
    editorNotice = '';
    renderNotice();
    var sequence = Promise.resolve();
    files.forEach(function (file, index) {
      sequence = sequence.then(function () {
        return upload(file, index, files.length).then(function (item) { created.push(item); }).catch(function (error) {
          if (error.duplicate) duplicateCount++;
          else failures.push(file.name + ': ' + error.message);
        });
      });
    });
    sequence.then(function () {
      var progress = root.querySelector('#editorUploadProgress');
      root.querySelector('#editorUploadBar').style.width = '100%';
      root.querySelector('#editorUploadLabel').textContent = created.length + ' recording' + (created.length === 1 ? '' : 's') + ' added to the edit queue' + (duplicateCount ? ' · ' + duplicateCount + ' duplicate skipped' : '');
      setTimeout(function () { if (progress) progress.hidden = true; }, 1400);
      if (created[0]) openProject(created[0].id);
      if (failures.length) alert('Some recordings could not be uploaded:\n\n' + failures.join('\n'));
    });
  }

  function loadProjects() {
    return api('/api/editor').then(function (items) {
      projects = items;
      renderList();
      if (!project && projects[0]) {
        var preferred = listFilter === 'active' ? nextActionableProject() : projects.filter(function (item) { return !!item.productionPieceId; }).sort(function (a, b) {
          return String(b.sentToProductionAt || b.updatedAt || '').localeCompare(String(a.sentToProductionAt || a.updatedAt || ''));
        })[0];
        if (preferred) return openProject(preferred.id);
      }
    });
  }

  function openProject(id, quiet) {
    clearTimeout(pollTimer);
    return api('/api/editor/' + encodeURIComponent(id)).then(function (item) {
      var progressOnly = !!(quiet && project && project.id === item.id && project.renderStatus === 'running' && item.renderStatus === 'running');
      project = item;
      projects = projects.map(function (entry) { return entry.id === item.id ? item : entry; });
      selected.clear();
      if (!quiet) history = [];
      renderList();
      if (progressOnly) {
        var percent = Math.round(Number(item.renderProgress) || 0);
        var label = root.querySelector('#editorRenderProgressLabel');
        var bar = root.querySelector('#editorRenderProgressBar');
        var button = root.querySelector('#editorRender');
        if (label) label.textContent = 'Encoding final edit · ' + percent + '%';
        if (bar) bar.style.width = Math.max(2, percent) + '%';
        if (button) button.textContent = 'Building final edit… ' + percent + '%';
        schedulePoll();
        return;
      }
      renderWorkspace();
      schedulePoll();
    }).catch(function (error) {
      if (!quiet) alert(error.message);
    });
  }

  function projectIsActive(item) {
    return !!item && (['pending', 'running'].indexOf(item.transcriptionStatus) !== -1 ||
      ['pending', 'running'].indexOf(item.classificationStatus) !== -1 ||
      ['pending', 'running', 'pending_transcript'].indexOf(item.retakeAnalysisStatus) !== -1 ||
      ['pending', 'running', 'pending_transcript'].indexOf(item.planningMatchStatus) !== -1 ||
      ['queued', 'running'].indexOf(item.renderStatus) !== -1);
  }

  function projectPollSignature(item) {
    if (!item) return '';
    return [item.transcriptionStatus, item.classificationStatus, item.retakeAnalysisStatus, item.planningMatchStatus,
      item.renderStatus, Math.round(Number(item.renderProgress) || 0), item.productionPieceId || '', item.workflowWarning || ''].join('|');
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!project || !projects.some(projectIsActive)) return;
    var token = mountToken;
    pollTimer = setTimeout(function () {
      if (token !== mountToken || !project) return;
      var activeId = project.id;
      var before = projectPollSignature(project);
      api('/api/editor').then(function (items) {
        if (token !== mountToken || !project || project.id !== activeId) return;
        projects = items;
        renderList();
        var summary = items.find(function (item) { return item.id === activeId; });
        if (summary && (projectIsActive(summary) || projectPollSignature(summary) !== before)) return openProject(activeId, true);
        schedulePoll();
      }).catch(function () { schedulePoll(); });
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
        processingStepsHtml(project) +
        (isError ? '<button class="btn-primary" id="editorRetry">Retry transcription</button>' : '') + '</div>';
      if (isError) workspace.querySelector('#editorRetry').onclick = function () {
        api('/api/editor/' + project.id + '/transcribe', { method: 'POST' }).then(function () { project.transcriptionStatus = 'running'; renderWorkspace(); schedulePoll(); });
      };
      return;
    }
    var removed = new Set((project.removedWordIndices || []).map(Number));
    var cutSeconds = Math.max(0, Number(project.duration) - editedDuration(project));
    var layout = project.effectiveLayout || (Number(project.height) > Number(project.width) ? 'vertical' : 'horizontal');
    var cropPercent = Math.round((Number(project.cropCenterX) || 0.5) * 100);
    var classificationCopy = project.classificationStatus === 'ready' && project.visualClassification
      ? esc(project.visualClassification.explanation || ('Frame analysis: ' + project.visualClassification.confidence + ' confidence'))
      : project.classificationStatus === 'running' || project.classificationStatus === 'pending'
        ? 'Analyzing three frames to distinguish a single page from an open spread…'
        : 'Using source dimensions until the book framing is analyzed.';
    var automaticEditRunning = ['pending', 'running'].indexOf(project.classificationStatus) !== -1 ||
      ['pending', 'running', 'pending_transcript'].indexOf(project.retakeAnalysisStatus) !== -1 ||
      ['pending', 'running', 'pending_transcript'].indexOf(project.planningMatchStatus) !== -1;
    var unresolvedRetakes = Number(project.unresolvedRetakeCount) || 0;
    var renderBlocked = automaticEditRunning || unresolvedRetakes > 0;
    var renderButtonText = automaticEditRunning ? 'Preparing automatic edit…' : unresolvedRetakes ? 'Review ' + unresolvedRetakes + ' possible retake' + (unresolvedRetakes === 1 ? '' : 's') : 'Build final edit';
    var rendering = ['queued', 'running'].indexOf(project.renderStatus) !== -1;
    var sentToProduction = !!project.productionPieceId;
    var failures = failedSteps(project);
    var previewMode = project.renderStatus === 'ready' && previewModes[project.id] !== 'source' ? 'final' : 'source';
    var previewUrl = previewMode === 'final' ? '/api/editor/' + encodeURIComponent(project.id) + '/render?inline=1' : '/api/editor/' + encodeURIComponent(project.id) + '/source';
    var previewSeek = Math.max(0, Number(previewSeekTimes[project.id]) || 0);
    workspace.innerHTML =
      '<div class="editor-topbar"><div><h2>' + esc(displayName(project)) + '</h2><span>' + (project.planningPieceTitle ? esc(project.name) + ' · ' : '') + formatTime(project.duration) + ' original · ' + formatTime(editedDuration(project)) + ' edited · ' + cutSeconds.toFixed(1) + 's removed</span></div>' +
        '<div class="editor-topbar-actions"><span class="editor-save-state ' + esc(saveStates[project.id] || '') + '" id="editorSaveState">' + ({ saving: 'Saving…', saved: 'Saved', error: 'Save failed' }[saveStates[project.id]] || '') + '</span><button class="editor-delete" id="editorDelete">Delete recording</button></div></div>' +
      (rendering ? '<div class="editor-lock-notice"><strong>Final edit is encoding</strong><span>Review remains available. Editing unlocks as soon as the verified file is ready.</span></div>' : '') +
      (sentToProduction ? '<div class="editor-lock-notice approved"><strong>Approved version locked</strong><span>The exact reviewed file is now in Content Production. Source and final previews remain available here.</span></div>' : '') +
      (failures.length ? '<div class="editor-error-recovery"><div><strong>' + failures.join(', ') + ' need' + (failures.length === 1 ? 's' : '') + ' attention</strong><span>Retry the failed automatic work without changing the source recording or your edit decisions.</span></div><button type="button" class="btn-secondary btn-tiny" id="editorRetryFailed">Retry failed steps</button></div>' : '') +
      (project.workflowWarning ? '<div class="editor-workflow-warning"><strong>Video workflow needs attention</strong><span>' + esc(project.workflowWarning) + '</span></div>' : '') +
      '<section class="editor-classification"><div><div class="eyebrow">Automatic classification</div><strong>' + (layout === 'vertical' ? 'Single page · Vertical' : 'Open spread · Horizontal') + '</strong><span>' + classificationCopy + ' · ' + esc(typeLabel(project.detectedContentType)) + '</span>' +
        (project.classificationStatus !== 'ready' && project.classificationStatus !== 'running' && project.classificationStatus !== 'pending' ? '<button type="button" class="editor-analyze" id="editorAnalyze">Analyze book framing</button>' : '') + '</div>' +
        '<label>Frame<select id="editorLayout"><option value="auto"' + (project.layoutOverride === 'auto' || !project.layoutOverride ? ' selected' : '') + '>Auto detect</option><option value="vertical"' + (project.layoutOverride === 'vertical' ? ' selected' : '') + '>Vertical · single page</option><option value="horizontal"' + (project.layoutOverride === 'horizontal' ? ' selected' : '') + '>Horizontal · open spread</option></select></label>' +
        '<label>Format<select id="editorContentType"><option value="auto"' + (project.contentTypeOverride === 'auto' || !project.contentTypeOverride ? ' selected' : '') + '>Auto · ' + esc(typeLabel(project.detectedContentType)) + '</option><option value="ultra_short"' + (project.contentTypeOverride === 'ultra_short' ? ' selected' : '') + '>Ultra-short</option><option value="short"' + (project.contentTypeOverride === 'short' ? ' selected' : '') + '>Short</option><option value="long_short"' + (project.contentTypeOverride === 'long_short' ? ' selected' : '') + '>Long-short</option><option value="longform"' + (project.contentTypeOverride === 'longform' ? ' selected' : '') + '>Longform</option></select></label></section>' +
      '<section class="editor-plan-link"><div><div class="eyebrow">Planning workflow</div><strong>' + (project.planningPieceId ? 'Linked to ' + esc(displayName(project)) : 'No planning card linked') + '</strong><span>' + esc(project.planningMatch && project.planningMatch.reason || (project.planningMatchStatus === 'running' || project.planningMatchStatus === 'pending' ? 'Matching the transcript to Filmed cards…' : 'Choose a card manually if this recording came from the Kanban.')) + '</span></div><label>Content card<select id="editorPlanningPiece">' + planningOptionsHtml(project) + '</select></label>' +
        (project.planningMatchStatus !== 'running' && project.planningMatchStatus !== 'pending' ? '<button type="button" class="editor-analyze" id="editorMatchPlan">Match again</button>' : '') + '</section>' +
      '<div class="editor-preview-mode"><div><strong>' + (previewMode === 'final' ? 'Final edit' : 'Original master') + '</strong><span>' + (previewMode === 'final' ? 'This is the actual encoded file that will go to production.' : 'Use this view to inspect or restore source material.') + '</span></div>' +
        '<div class="editor-preview-actions"><label>Review speed<select id="editorReviewRate"><option value="1"' + (reviewRate === 1 ? ' selected' : '') + '>1×</option><option value="1.25"' + (reviewRate === 1.25 ? ' selected' : '') + '>1.25×</option><option value="1.5"' + (reviewRate === 1.5 ? ' selected' : '') + '>1.5×</option><option value="2"' + (reviewRate === 2 ? ' selected' : '') + '>2×</option></select></label>' +
        (project.renderStatus === 'ready' ? '<button type="button" id="editorPreviewFinal" class="' + (previewMode === 'final' ? 'active' : '') + '">Final edit</button><button type="button" id="editorPreviewSource" class="' + (previewMode === 'source' ? 'active' : '') + '">Original master</button>' : '') + '</div></div>' +
      '<div class="editor-preview"><div class="editor-video-frame ' + layout + '" style="--crop-x:' + cropPercent + '%"><video id="editorVideo" data-preview-mode="' + previewMode + '" data-seek-time="' + previewSeek.toFixed(3) + '" controls playsinline preload="metadata" src="' + previewUrl + '"></video>' +
        '<div class="editor-caption" id="editorCaption"></div></div></div>' +
      (layout === 'vertical' ? '<div class="editor-crop-control"><label>Horizontal crop position <input id="editorCropX" type="range" min="0" max="100" value="' + cropPercent + '"></label><span>Keep the single page centred inside the vertical frame.</span></div>' : '') +
      '<section class="editor-automation"><div class="editor-automation-head"><div><div class="eyebrow">Automatic edit</div><h3>Speech and pause map</h3></div><div class="editor-legend"><span class="speech">Speech</span><span class="cut">Removed pause</span><span class="pause">Kept pause</span></div></div>' + timelineHtml(project) +
        '<div class="editor-controls"><label class="editor-toggle"><input type="checkbox" id="editorAutoSilence" ' + (project.autoSilenceEnabled !== false ? 'checked' : '') + '><span></span>Remove long pauses</label>' +
          '<label class="editor-toggle"><input type="checkbox" id="editorCaptions" ' + (project.captionsEnabled !== false ? 'checked' : '') + '><span></span>Add yellow captions</label>' +
          '<label class="editor-mode">Pacing<select id="editorPacing"><option value="tight"' + (Number(project.silenceThresholdSeconds) < 0.85 ? ' selected' : '') + '>Tight</option><option value="natural"' + (Number(project.silenceThresholdSeconds || 1) >= 0.85 && Number(project.silenceThresholdSeconds || 1) < 1.3 ? ' selected' : '') + '>Natural</option><option value="gentle"' + (Number(project.silenceThresholdSeconds || 1) >= 1.3 ? ' selected' : '') + '>Gentle</option></select></label></div></section>' +
      '<section class="editor-review"><div class="editor-review-column"><div class="editor-section-title"><div><div class="eyebrow">Pause decisions</div><h3>Every automatic silence cut</h3></div><span>Red means removed</span></div><div id="editorGapReview">' + gapReviewHtml(project) + '</div></div>' +
        '<div class="editor-review-column"><div class="editor-section-title"><div><div class="eyebrow">Smart review</div><h3>Possible retakes</h3></div>' +
          (project.retakeAnalysisStatus !== 'ready' && project.retakeAnalysisStatus !== 'pending' && project.retakeAnalysisStatus !== 'running' ? '<button type="button" class="editor-analyze" id="editorAnalyzeRetakes">Analyze retakes</button>' : '<span>Only clear failed takes are automatic</span>') + '</div><div id="editorRetakeReview">' + retakeReviewHtml(project) + '</div></div></section>' +
      '<section class="editor-transcript-panel"><div class="editor-transcript-head"><div><div class="eyebrow">Transcript editor</div><h3>Select words or sentences to cut them from the video</h3></div>' +
        '<div class="editor-transcript-actions"><button class="btn-secondary btn-tiny" id="editorUndo" ' + (!history.length ? 'disabled' : '') + '>Undo</button>' +
        '<button class="btn-secondary btn-tiny" id="editorRestore" disabled>Restore selected</button><button class="btn-primary btn-tiny" id="editorCut" disabled>Cut selected</button></div></div>' +
        '<div class="editor-transcript' + (rendering || sentToProduction ? ' locked' : '') + '" id="editorTranscript" tabindex="0">' + (project.words || []).map(function (word) {
          return '<span class="editor-word' + (removed.has(word.index) ? ' removed' : '') + '" data-index="' + word.index + '" data-start="' + word.start + '" data-end="' + word.end + '">' + esc(word.text) + '</span> ';
        }).join('') + '</div><p class="editor-selection-hint">Drag across text or click words. Press Delete to cut, Ctrl/⌘ Z to undo, or Escape to clear. Removed words remain visible so you can restore them.</p></section>' +
      '<div class="editor-export"><div><strong>Next: Content Production</strong><span>' +
        (project.productionPieceId ? 'This edit is ready in Content Production for titles, thumbnail, and ambient music.' :
          project.renderStatus === 'ready' ? 'Send the finished edit across without uploading it again.' :
          'Build the final edit first. Yellow captions will be baked in below center.') + '</span>' +
        '<div class="editor-readiness"><i class="ready">Transcript ready</i><i class="' + (['pending', 'running'].indexOf(project.classificationStatus) !== -1 ? 'working' : 'ready') + '">Framing ' + (['pending', 'running'].indexOf(project.classificationStatus) !== -1 ? 'checking' : 'ready') + '</i><i class="' + (['pending', 'running', 'pending_transcript'].indexOf(project.retakeAnalysisStatus) !== -1 ? 'working' : unresolvedRetakes ? 'review' : 'ready') + '">' + (['pending', 'running', 'pending_transcript'].indexOf(project.retakeAnalysisStatus) !== -1 ? 'Retakes checking' : unresolvedRetakes ? unresolvedRetakes + ' to review' : 'Retakes resolved') + '</i><i class="' + (['pending', 'running', 'pending_transcript'].indexOf(project.planningMatchStatus) !== -1 ? 'working' : 'ready') + '">Plan ' + (['pending', 'running', 'pending_transcript'].indexOf(project.planningMatchStatus) !== -1 ? 'matching' : project.planningPieceId ? 'linked' : 'not required') + '</i>' + (project.renderStatus === 'ready' ? '<i class="ready">Output verified</i>' : '') + '</div>' +
        (['queued', 'running'].indexOf(project.renderStatus) !== -1 ? '<div class="editor-render-progress"><span id="editorRenderProgressLabel">' + (project.renderStatus === 'queued' ? (Number(project.renderQueuePosition) > 1 ? (Number(project.renderQueuePosition) - 1) + ' recording(s) ahead in the render queue' : 'Next in the render queue') : 'Encoding final edit · ' + Math.round(Number(project.renderProgress) || 0) + '%') + '</span><div><i id="editorRenderProgressBar" style="width:' + (project.renderStatus === 'queued' ? 4 : Math.max(2, Number(project.renderProgress) || 0)) + '%"></i></div></div>' : '') +
        (project.renderStatus === 'error' ? '<em>' + esc(project.renderError) + '</em>' : '') + '</div><div class="editor-export-actions">' +
        (project.productionPieceId ? '<button class="btn-primary" id="editorOpenProduction">Open Content Production</button>' :
          project.renderStatus === 'ready' ? '<button class="btn-primary" id="editorSendProduction">Approve &amp; Send to Production</button>' :
          '<button class="btn-primary" id="editorRender" ' + (['queued', 'running'].indexOf(project.renderStatus) !== -1 || renderBlocked ? 'disabled' : '') + '>' + (project.renderStatus === 'queued' ? 'Waiting in render queue…' : project.renderStatus === 'running' ? 'Building final edit… ' + Math.round(Number(project.renderProgress) || 0) + '%' : renderButtonText) + '</button>') +
        '</div></div>';
    bindWorkspace();
  }

  function bindWorkspace() {
    var video = root.querySelector('#editorVideo');
    var caption = root.querySelector('#editorCaption');
    var transcript = root.querySelector('#editorTranscript');
    var previewingFinal = video.dataset.previewMode === 'final';
    var rendering = ['queued', 'running'].indexOf(project.renderStatus) !== -1;
    var sentToProduction = !!project.productionPieceId;
    var editingLocked = rendering || sentToProduction;
    video.playbackRate = reviewRate;
    if (restoreTranscriptFocus && !editingLocked) {
      restoreTranscriptFocus = false;
      transcript.focus({ preventScroll: true });
    }
    var resumeTime = Number(video.dataset.seekTime) || 0;
    if (resumeTime > 0) {
      var resumePreview = function () {
        video.currentTime = Math.min(resumeTime, Math.max(0, Number(video.duration) || resumeTime));
        delete previewSeekTimes[project.id];
      };
      if (video.readyState >= 1) resumePreview(); else video.addEventListener('loadedmetadata', resumePreview, { once: true });
    }
    var lastClicked = null;
    var ignoreNextClick = false;
    function isLongformVideo() {
      return (project.effectiveLayout || 'horizontal') === 'horizontal';
    }
    video.addEventListener('timeupdate', function () {
      var playhead = root.querySelector('#editorPlayhead');
      if (playhead && project.duration) {
        var sourcePlayheadTime = previewingFinal ? editedToSourceTime(video.currentTime, project) : video.currentTime;
        playhead.style.left = Math.min(100, sourcePlayheadTime / project.duration * 100) + '%';
      }
      if (previewingFinal) {
        caption.classList.remove('visible');
        return;
      }
      var cut = (project.cuts || []).filter(function (item) { return video.currentTime >= item.start && video.currentTime < item.end; })[0];
      if (cut && cut.end < video.duration) { video.currentTime = cut.end + 0.01; return; }
      var group = (project.captionGroups || []).filter(function (item) {
        return video.currentTime >= item.sourceStart && video.currentTime <= item.sourceEnd + 0.18;
      })[0];
      caption.replaceChildren();
      caption.style.removeProperty('font-size');
      var isLongform = isLongformVideo();
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
        if (spokenWord) {
          var characters = Array.from(String(spokenWord.text || '')).length;
          caption.style.fontSize = (Math.max(7.1, Math.min(11.1, 11.1 * 18 / Math.max(18, characters)))).toFixed(2) + 'cqw';
        }
      } else if (group) caption.textContent = group.text;
      caption.classList.toggle('visible', !!group && project.captionsEnabled !== false);
    });
    root.querySelectorAll('.editor-timeline-segment').forEach(function (segment) {
      segment.onclick = function () {
        var sourceTime = Number(segment.dataset.time) || 0;
        video.currentTime = previewingFinal ? sourceToEditedTime(sourceTime, project.cuts) : sourceTime;
        video.play().catch(function () {});
      };
    });
    root.querySelectorAll('.editor-preview-cut').forEach(function (button) {
      button.onclick = function () {
        var time = Number(button.dataset.time) || 0;
        var previewTime = previewingFinal ? sourceToEditedTime(time, project.cuts) : time;
        var start = function () { video.currentTime = previewTime; video.play().catch(function () {}); video.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
        if (video.readyState >= 1) start(); else video.addEventListener('loadedmetadata', start, { once: true });
      };
    });
    var finalPreviewButton = root.querySelector('#editorPreviewFinal');
    if (finalPreviewButton) finalPreviewButton.onclick = function () {
      previewSeekTimes[project.id] = previewingFinal ? video.currentTime : sourceToEditedTime(video.currentTime, project.cuts);
      previewModes[project.id] = 'final'; renderWorkspace();
    };
    var sourcePreviewButton = root.querySelector('#editorPreviewSource');
    if (sourcePreviewButton) sourcePreviewButton.onclick = function () {
      previewSeekTimes[project.id] = previewingFinal ? editedToSourceTime(video.currentTime, project) : video.currentTime;
      previewModes[project.id] = 'source'; renderWorkspace();
    };
    root.querySelector('#editorReviewRate').onchange = function () {
      reviewRate = Number(this.value) || 1;
      localStorage.setItem('rmEditorReviewRate', String(reviewRate));
      video.playbackRate = reviewRate;
    };
    transcript.addEventListener('click', function (event) {
      if (editingLocked) return;
      if (ignoreNextClick) { ignoreNextClick = false; return; }
      var word = event.target.closest('.editor-word');
      if (!word) return;
      var index = Number(word.dataset.index);
      if (event.shiftKey && lastClicked !== null) {
        var start = Math.min(lastClicked, index); var end = Math.max(lastClicked, index);
        for (var i = start; i <= end; i++) selected.add(i);
      } else if (selected.has(index)) selected.delete(index); else selected.add(index);
      lastClicked = index;
      transcript.focus({ preventScroll: true });
      paintSelection();
    });
    transcript.addEventListener('mouseup', function () {
      if (editingLocked) return;
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
      transcript.focus({ preventScroll: true });
      paintSelection();
    });
    transcript.addEventListener('keydown', function (event) {
      if (editingLocked) return;
      if (history.length && (event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'z') {
        event.preventDefault(); restoreTranscriptFocus = true; undo(); return;
      }
      if (event.key === 'Escape') {
        event.preventDefault(); selected.clear(); paintSelection(); return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && Array.from(selected).some(function (index) {
        return (project.removedWordIndices || []).indexOf(index) === -1;
      })) {
        event.preventDefault(); restoreTranscriptFocus = true; alterSelected(true);
      }
    });
    root.querySelector('#editorCut').onclick = function () { alterSelected(true); };
    root.querySelector('#editorRestore').onclick = function () { alterSelected(false); };
    root.querySelector('#editorUndo').onclick = undo;
    root.querySelector('#editorAutoSilence').onchange = function () {
      save({ autoSilenceEnabled: this.checked }, true);
    };
    root.querySelector('#editorCaptions').onchange = function () { save({ captionsEnabled: this.checked }, true); };
    root.querySelector('#editorLayout').onchange = function () { save({ layoutOverride: this.value }, true); };
    root.querySelector('#editorContentType').onchange = function () { save({ contentTypeOverride: this.value }, true); };
    root.querySelector('#editorPlanningPiece').onchange = function () { save({ planningPieceId: this.value }, true); };
    var analyzeButton = root.querySelector('#editorAnalyze');
    if (analyzeButton) analyzeButton.onclick = function () {
      analyzeButton.disabled = true;
      analyzeButton.textContent = 'Analyzing…';
      api('/api/editor/' + project.id + '/classify', { method: 'POST' }).then(function () {
        project.classificationStatus = 'running'; renderWorkspace(); schedulePoll();
      }).catch(function (error) { alert(error.message); renderWorkspace(); });
    };
    var retakeAnalyzeButton = root.querySelector('#editorAnalyzeRetakes');
    if (retakeAnalyzeButton) retakeAnalyzeButton.onclick = function () {
      retakeAnalyzeButton.disabled = true;
      retakeAnalyzeButton.textContent = 'Analyzing…';
      api('/api/editor/' + project.id + '/analyze-retakes', { method: 'POST' }).then(function () {
        project.retakeAnalysisStatus = 'running'; renderWorkspace(); schedulePoll();
      }).catch(function (error) { alert(error.message); renderWorkspace(); });
    };
    var matchPlanButton = root.querySelector('#editorMatchPlan');
    if (matchPlanButton) matchPlanButton.onclick = function () {
      matchPlanButton.disabled = true;
      matchPlanButton.textContent = 'Matching…';
      api('/api/editor/' + project.id + '/match-planning-piece', { method: 'POST' }).then(function () {
        project.planningMatchStatus = 'running'; renderWorkspace(); schedulePoll();
      }).catch(function (error) { alert(error.message); renderWorkspace(); });
    };
    root.querySelector('#editorPacing').onchange = function () {
      var settings = { tight: [0.7, 0.22], natural: [1, 0.38], gentle: [1.5, 0.55] }[this.value] || [1, 0.38];
      save({ silenceThresholdSeconds: settings[0], retainedPauseSeconds: settings[1] }, true);
    };
    var crop = root.querySelector('#editorCropX');
    if (crop) {
      crop.oninput = function () {
        var frame = root.querySelector('.editor-video-frame');
        if (frame) frame.style.setProperty('--crop-x', crop.value + '%');
      };
      crop.onchange = function () { save({ cropCenterX: Number(crop.value) / 100 }, true); };
    }
    root.querySelectorAll('.editor-gap-toggle').forEach(function (button) {
      button.onclick = function () {
        var next = new Set((project.restoredAutoCutIds || []).map(String));
        if (button.dataset.restored === '1') next.delete(button.dataset.gapId); else next.add(button.dataset.gapId);
        save({ restoredAutoCutIds: Array.from(next) }, true);
      };
    });
    root.querySelectorAll('.editor-retake-apply').forEach(function (button) {
      button.onclick = function () {
        var candidate = (project.retakeCandidates || []).find(function (item) { return item.id === button.dataset.id; });
        if (!candidate) return;
        var next = new Set((project.removedWordIndices || []).map(Number));
        candidate.removeWordIndices.forEach(function (index) { next.add(index); });
        history.push((project.removedWordIndices || []).slice());
        save({ removedWordIndices: Array.from(next).sort(function (a, b) { return a - b; }) });
      };
    });
    root.querySelectorAll('.editor-retake-dismiss').forEach(function (button) {
      button.onclick = function () {
        var next = new Set((project.dismissedRetakeIds || []).map(String));
        next.add(button.dataset.id);
        var patch = { dismissedRetakeIds: Array.from(next) };
        if (button.dataset.applied === '1') {
          var candidate = (project.retakeCandidates || []).find(function (item) { return item.id === button.dataset.id; });
          var removed = new Set((project.removedWordIndices || []).map(Number));
          if (candidate) candidate.removeWordIndices.forEach(function (index) { removed.delete(index); });
          patch.removedWordIndices = Array.from(removed).sort(function (a, b) { return a - b; });
          history.push((project.removedWordIndices || []).slice());
        }
        save(patch, true);
      };
    });
    var renderButton = root.querySelector('#editorRender');
    if (renderButton) renderButton.onclick = function () {
        api('/api/editor/' + project.id + '/render', { method: 'POST' }).then(function () {
          project.renderStatus = 'running'; renderWorkspace(); schedulePoll();
        }).catch(function (error) { alert(error.message); });
      };
    var retryFailedButton = root.querySelector('#editorRetryFailed');
    if (retryFailedButton) retryFailedButton.onclick = function () {
      retryFailedButton.disabled = true;
      retryFailedButton.textContent = 'Retrying…';
      api('/api/editor/' + project.id + '/retry-failed', { method: 'POST' }).then(function () {
        return openProject(project.id, true);
      }).catch(function (error) { retryFailedButton.disabled = false; retryFailedButton.textContent = 'Retry failed steps'; alert(error.message); });
    };
    var sendButton = root.querySelector('#editorSendProduction');
    if (sendButton) sendButton.onclick = function () {
      var approvedId = project.id;
      var approvedName = project.name;
      sendButton.disabled = true;
      sendButton.textContent = 'Approving…';
      api('/api/editor/' + project.id + '/production', { method: 'POST' }).then(function (result) {
        project.productionPieceId = result.pieceId;
        project.sentToProductionAt = new Date().toISOString();
        project.workflowWarning = result.workflowWarning || '';
        projects = projects.map(function (item) { return item.id === approvedId ? Object.assign({}, item, { productionPieceId: result.pieceId, sentToProductionAt: project.sentToProductionAt, workflowWarning: project.workflowWarning }) : item; });
        editorNotice = approvedName + ' was approved and sent to Content Production.' + (project.workflowWarning ? ' The video is safe; check its planning-card warning when convenient.' : '');
        var next = nextActionableProject(approvedId);
        if (next) return openProject(next.id).then(renderNotice);
        renderList();
        renderWorkspace();
        renderNotice();
      }).catch(function (error) {
        sendButton.disabled = false;
        sendButton.textContent = 'Approve & Send to Production';
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
        var next = listFilter === 'active' ? nextActionableProject() : projects.filter(function (item) { return !!item.productionPieceId; })[0];
        if (next) openProject(next.id);
      });
    };
    if (editingLocked) {
      ['#editorAnalyze', '#editorLayout', '#editorContentType', '#editorPlanningPiece', '#editorMatchPlan', '#editorCropX', '#editorAutoSilence', '#editorCaptions', '#editorPacing', '#editorAnalyzeRetakes', '#editorUndo', '#editorRestore', '#editorCut'].forEach(function (selector) {
        var control = root.querySelector(selector); if (control) control.disabled = true;
      });
      root.querySelectorAll('.editor-gap-toggle,.editor-retake-apply,.editor-retake-dismiss').forEach(function (control) { control.disabled = true; });
    }
    if (rendering) root.querySelector('#editorDelete').disabled = true;
  }

  function paintSelection() {
    root.querySelectorAll('.editor-word').forEach(function (word) {
      word.classList.toggle('selected', selected.has(Number(word.dataset.index)));
    });
    var removed = new Set((project.removedWordIndices || []).map(Number));
    var hasKept = Array.from(selected).some(function (index) { return !removed.has(index); });
    var hasRemoved = Array.from(selected).some(function (index) { return removed.has(index); });
    var locked = project && (project.productionPieceId || ['queued', 'running'].indexOf(project.renderStatus) !== -1);
    root.querySelector('#editorCut').disabled = locked || !hasKept;
    root.querySelector('#editorRestore').disabled = locked || !hasRemoved;
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
    var id = project.id;
    saveStates[id] = 'saving';
    var stateNode = root.querySelector('#editorSaveState');
    if (stateNode && project && project.id === id) { stateNode.className = 'editor-save-state saving'; stateNode.textContent = 'Saving…'; }
    var previous = saveQueues[id] || Promise.resolve();
    var request = previous.catch(function () {}).then(function () {
      return api('/api/editor/' + id, { method: 'PATCH', body: JSON.stringify(patch) });
    }).then(function (item) {
      saveStates[id] = 'saved';
      projects = projects.map(function (entry) { return entry.id === item.id ? item : entry; });
      if (!preserveHistory && history.length > 100) history.shift();
      renderList();
      if (project && project.id === id) {
        project = item; renderWorkspace();
        // The server starts a replacement render immediately after an edit.
        // Its PATCH response can arrive just before that queued status is
        // persisted, so fetch once more rather than leaving a hands-off
        // rebuild invisible until the page is revisited.
        if (!item.renderStatus && !item.productionPieceId) setTimeout(function () {
          if (project && project.id === id && !project.renderStatus) openProject(id, true);
        }, 950);
      }
      return item;
    }).catch(function (error) {
      saveStates[id] = 'error';
      if (project && project.id === id) renderWorkspace();
      alert(error.message);
    });
    saveQueues[id] = request;
    request.finally(function () { if (saveQueues[id] === request) delete saveQueues[id]; });
    return request;
  }

  window.RMEditor = {
    mount: function (element) {
      mountToken++;
      clearTimeout(pollTimer);
      root = element; projects = []; project = null; selected.clear(); history = []; saveQueues = {}; saveStates = {}; previewSeekTimes = {}; restoreTranscriptFocus = false;
      shell();
      loadProjects().catch(function (error) {
        root.querySelector('#editorWorkspace').innerHTML = '<div class="editor-empty"><strong>Editor unavailable</strong><span>' + esc(error.message) + '</span></div>';
      });
    }
  };
})();
