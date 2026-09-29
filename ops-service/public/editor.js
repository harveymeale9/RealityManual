(function () {
  'use strict';

  var root = null;
  var projects = [];
  var project = null;
  var selected = new Set();
  var pollTimer = null;
  var mountToken = 0;
  var editorNotice = '';
  var previewModes = {};
  var previewSeekTimes = {};
  var previewAutoplay = {};
  var previewStopTimes = {};
  var saveQueues = {};
  var saveStates = {};
  var renderRefreshTimers = {};
  var mediaRecoveryChecks = {};
  var restoreTranscriptFocus = false;
  var uploadBatchInProgress = false;
  var uploadBatchCancelled = false;
  var currentUploadXhr = null;
  var uploadStatusText = '';
  var uploadStatusPercent = 0;
  var MAX_RECORDING_BYTES = 2 * 1024 * 1024 * 1024;
  var listFilter = localStorage.getItem('rmEditorListFilter') === 'sent' ? 'sent' : 'active';
  var reviewRate = Number(localStorage.getItem('rmEditorReviewRate')) || 1;
  if ([1, 1.25, 1.5, 2].indexOf(reviewRate) === -1) reviewRate = 1;

  window.addEventListener('beforeunload', function (event) {
    if (!uploadBatchInProgress) return;
    event.preventDefault();
    event.returnValue = '';
  });

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
        if (!response.ok) {
          var error = new Error(body.message || body.error || 'Request failed');
          error.code = body.error || '';
          error.status = response.status;
          error.body = body;
          throw error;
        }
        return body;
      });
    });
  }

  function formatTime(seconds) {
    seconds = Math.max(0, Number(seconds) || 0);
    var minutes = Math.floor(seconds / 60);
    return minutes + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
  }

  function formatBytes(bytes) {
    var value = Math.max(0, Number(bytes) || 0);
    if (!value) return '';
    if (value >= 1024 * 1024 * 1024) return (value / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
    if (value >= 1024 * 1024) return Math.round(value / (1024 * 1024)) + ' MB';
    return Math.max(1, Math.round(value / 1024)) + ' KB';
  }

  function displayName(item) {
    if (!item || !item.planningPieceTitle) return item && item.name || 'Untitled recording';
    return (item.planningPieceSeq ? '#' + String(item.planningPieceSeq).padStart(3, '0') + ' · ' : '') + item.planningPieceTitle;
  }

  function isVideoFile(file) {
    var mime = String(file && file.type || '').toLowerCase();
    if (mime.indexOf('video/') === 0) return true;
    return (!mime || mime === 'application/octet-stream') && /\.(?:mp4|mov|m4v|webm|mkv|avi)$/i.test(String(file && file.name || ''));
  }

  function editorMounted() {
    return !!(root && root.querySelector('.video-editor'));
  }

  function paintUploadStatus() {
    if (!editorMounted()) return;
    var progress = root.querySelector('#editorUploadProgress');
    var bar = root.querySelector('#editorUploadBar');
    var label = root.querySelector('#editorUploadLabel');
    var input = root.querySelector('#editorFile');
    var control = root.querySelector('.editor-upload');
    var cancel = root.querySelector('#editorCancelUpload');
    if (progress) progress.hidden = !uploadStatusText;
    if (bar) bar.style.width = Math.max(0, Math.min(100, uploadStatusPercent)) + '%';
    if (label && uploadStatusText) label.textContent = uploadStatusText;
    if (input) input.disabled = uploadBatchInProgress;
    if (control) control.classList.toggle('disabled', uploadBatchInProgress);
    if (cancel) cancel.hidden = !uploadBatchInProgress;
  }

  function rememberedProjectKey(filter) {
    return filter === 'sent' ? 'rmEditorSentProjectId' : 'rmEditorActiveProjectId';
  }

  function reviewProgressKey(id) {
    return 'rmEditorReviewProgress:' + String(id || '');
  }

  function restoreReviewProgress(item) {
    if (!item || Object.prototype.hasOwnProperty.call(previewSeekTimes, item.id)) return;
    var saved;
    try { saved = JSON.parse(sessionStorage.getItem(reviewProgressKey(item.id)) || 'null'); } catch (error) {}
    var sourceTime = Number(saved && saved.sourceTime);
    var duration = Number(item.duration) || 0;
    if (!Number.isFinite(sourceTime) || sourceTime < 1 || (duration > 0 && sourceTime >= duration - 1)) return;
    var mode = saved.mode === 'source' || item.renderStatus !== 'ready' ? 'source' : 'final';
    previewModes[item.id] = mode;
    previewSeekTimes[item.id] = mode === 'final' ? sourceToEditedTime(sourceTime, cutsForClient(item)) : sourceTime;
  }

  function cutsForClient(item) {
    return Array.isArray(item && item.cuts) ? item.cuts : [];
  }

  function clearReviewProgress(id) {
    try { sessionStorage.removeItem(reviewProgressKey(id)); } catch (error) {}
  }

  function preferredProjectForFilter(filter) {
    var rememberedId = localStorage.getItem(rememberedProjectKey(filter)) || '';
    var remembered = projects.find(function (item) {
      return item.id === rememberedId && (filter === 'sent' ? !!item.productionPieceId : !item.productionPieceId);
    });
    if (remembered) return remembered;
    if (filter === 'active') return nextActionableProject();
    return projects.filter(function (item) { return !!item.productionPieceId; }).sort(function (a, b) {
      return String(b.sentToProductionAt || b.updatedAt || '').localeCompare(String(a.sentToProductionAt || a.updatedAt || ''));
    })[0] || null;
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

  function rememberPlaybackBeforeEdit(id, renderWillChange) {
    if (!editorMounted() || !project || project.id !== id) return;
    var video = root.querySelector('#editorVideo');
    if (!video || !Number.isFinite(Number(video.currentTime))) return;
    var time = Math.max(0, Number(video.currentTime) || 0);
    var mode = video.dataset.previewMode === 'final' ? 'final' : 'source';
    if (!video.paused && !video.ended) previewAutoplay[id] = true;
    if (mode === 'final' && renderWillChange) {
      previewSeekTimes[id] = editedToSourceTime(time, project);
      previewModes[id] = 'source';
    } else {
      previewSeekTimes[id] = time;
      previewModes[id] = mode;
    }
  }

  function statusLabel(item) {
    function queued(label, position) {
      position = Number(position) || 0;
      return position > 1 ? label + ' · ' + (position - 1) + ' ahead' : position === 1 ? 'Next: ' + label.toLowerCase() : label;
    }
    if (item.productionPieceId) return item.workflowWarning ? 'Sent · workflow warning' : 'Sent to Production';
    if (item.transcriptionStatus === 'pending') return queued('Waiting for transcript', item.transcriptionQueuePosition);
    if (item.transcriptionStatus === 'running') return 'Transcribing';
    if (item.transcriptionStatus === 'error') return 'Needs attention';
    if (['pending', 'running'].indexOf(item.browserPreviewStatus) !== -1 && item.renderStatus !== 'ready') return queued('Preparing browser preview', item.previewQueuePosition);
    if (item.browserPreviewStatus === 'error' && item.renderStatus !== 'ready') return 'Needs attention';
    if ((item.classificationStatus === 'error' && framingFailureIsBlocking(item)) || item.retakeAnalysisStatus === 'error' || item.renderStatus === 'error') return 'Needs attention';
    if (item.classificationStatus === 'pending') return queued('Waiting for frame analysis', item.classificationQueuePosition);
    if (item.classificationStatus === 'running') return 'Analyzing frame';
    if (item.layoutReviewRequired) return 'Review framing';
    if (item.retakeAnalysisStatus === 'pending') return queued('Waiting for retake review', item.retakeQueuePosition);
    if (item.retakeAnalysisStatus === 'running') return 'Checking retakes';
    if (Number(item.unresolvedRetakeCount) > 0) return 'Review ' + Number(item.unresolvedRetakeCount) + ' possible retake' + (Number(item.unresolvedRetakeCount) === 1 ? '' : 's');
    if (item.workflowWarning) return item.renderStatus === 'ready' ? 'Ready · workflow warning' : 'Workflow warning';
    if (item.planningMatchStatus === 'pending') return queued('Waiting for plan match', item.planningQueuePosition);
    if (item.planningMatchStatus === 'running') return 'Matching plan';
    if (item.renderStatus === 'queued') return queued('Waiting to render', item.renderQueuePosition);
    if (item.renderStatus === 'running') return 'Rendering' + (Number(item.renderProgress) > 0 ? ' · ' + Math.round(Number(item.renderProgress)) + '%' : '');
    if (item.renderStatus === 'ready') return Number(item.appliedRetakeCount) > 0 ? 'Ready · ' + Number(item.appliedRetakeCount) + ' retake' + (Number(item.appliedRetakeCount) === 1 ? '' : 's') + ' removed' : 'Ready for approval';
    return 'Ready to edit';
  }

  function framingFailureIsBlocking(item) {
    return !!item && item.classificationStatus === 'error' &&
      (item.layoutOverride === 'auto' || !item.layoutOverride) && Number(item.width) >= Number(item.height);
  }

  function sessionBucket(item) {
    if (item.productionPieceId) return item.workflowWarning ? 'warning' : 'sent';
    if (item.transcriptionStatus === 'error' || (item.browserPreviewStatus === 'error' && item.renderStatus !== 'ready') || framingFailureIsBlocking(item) || item.retakeAnalysisStatus === 'error' || item.renderStatus === 'error' || Number(item.unresolvedRetakeCount) > 0 || item.layoutReviewRequired) return 'attention';
    if (item.workflowWarning) return 'warning';
    if (item.renderStatus === 'ready') return 'ready';
    if (['pending', 'running'].indexOf(item.transcriptionStatus) !== -1 || ['pending', 'running'].indexOf(item.browserPreviewStatus) !== -1 || ['pending', 'running'].indexOf(item.classificationStatus) !== -1 || ['pending', 'running', 'pending_transcript'].indexOf(item.retakeAnalysisStatus) !== -1 || ['pending', 'running', 'pending_transcript'].indexOf(item.planningMatchStatus) !== -1 || ['queued', 'running'].indexOf(item.renderStatus) !== -1) return 'working';
    return 'prepared';
  }

  function nextActionableProject(excludedId) {
    var priority = { ready: 0, warning: 1, attention: 2, prepared: 3, working: 4 };
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
    var counts = { working: 0, ready: 0, warning: 0, attention: 0, prepared: 0, sent: 0 };
    projects.forEach(function (item) { counts[sessionBucket(item)]++; });
    var labels = { working: 'processing', ready: 'ready to approve', warning: 'workflow warning', attention: 'need attention', prepared: 'prepared', sent: 'sent' };
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
    var previewState = item.browserPreviewStatus === 'error' ? 'error' : item.browserPreviewStatus === 'ready' ? 'done' : item.browserPreviewRequired ? 'active' : '';
    return '<div class="editor-processing-steps">' + step('done', 'Recording secured', 'Original master preserved') +
      (item.browserPreviewRequired ? step(previewState, 'Browser review copy', previewState === 'done' ? 'H.264 preview ready' : previewState === 'error' ? 'Can be retried' : Number(item.previewQueuePosition) > 1 ? (Number(item.previewQueuePosition) - 1) + ' recording(s) ahead' : 'Converting camera codec') : '') +
      step(transcriptState, 'Word-timed transcript', transcriptState === 'done' ? 'Speech mapped' : transcriptState === 'error' ? 'Needs retry' : item.transcriptionStatus === 'pending' && Number(item.transcriptionQueuePosition) > 1 ? (Number(item.transcriptionQueuePosition) - 1) + ' recording(s) ahead' : 'Listening for every word') +
      step(frameState, 'Publishing frame', frameState === 'done' ? 'Composition detected' : frameState === 'error' ? 'Manual choice available' : item.classificationStatus === 'pending' && Number(item.classificationQueuePosition) > 1 ? (Number(item.classificationQueuePosition) - 1) + ' recording(s) ahead' : frameState === 'active' ? 'Inspecting the book framing' : 'Waiting') +
      step(retakeState, 'Retake review', retakeState === 'done' ? 'Decisions ready' : retakeState === 'error' ? 'Can be retried' : item.retakeAnalysisStatus === 'pending' && Number(item.retakeQueuePosition) > 1 ? (Number(item.retakeQueuePosition) - 1) + ' recording(s) ahead' : retakeState === 'active' ? 'Comparing nearby takes' : 'Starts after transcription') +
      step(planState, 'Planning card', planState === 'done' ? 'Workflow linked' : planState === 'error' ? 'Manual choice available' : item.planningMatchStatus === 'pending' && Number(item.planningQueuePosition) > 1 ? (Number(item.planningQueuePosition) - 1) + ' recording(s) ahead' : planState === 'active' ? 'Matching filmed content' : 'Starts after transcription') + '</div>';
  }

  function failedSteps(item) {
    var labels = [];
    if (item.transcriptionStatus === 'error') labels.push('transcript');
    if (item.browserPreviewStatus === 'error') labels.push('browser preview');
    if (framingFailureIsBlocking(item)) labels.push('framing');
    if (item.retakeAnalysisStatus === 'error') labels.push('retake review');
    if (item.renderStatus === 'error') labels.push('final render');
    return labels;
  }

  function shell() {
    root.innerHTML =
      '<section class="video-editor">' +
        '<header class="editor-heading"><div><div class="eyebrow">Content production</div><h1>Editor</h1>' +
          '<p>Drop in a filming session. Each recording is framed, transcribed, cleaned and prepared for your approval.</p></div>' +
          '<div class="editor-heading-actions"><a href="voice-mobile.html" class="editor-pm-mobile btn-secondary">Project Manager</a><label class="editor-upload btn-primary"><input id="editorFile" type="file" accept="video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi" multiple hidden>Upload raw videos</label></div></header>' +
        '<div class="editor-upload-progress" id="editorUploadProgress" hidden><div class="editor-upload-progress-head"><span id="editorUploadLabel">Uploading…</span><button type="button" class="btn-secondary btn-tiny" id="editorCancelUpload" hidden>Cancel batch</button></div><div><i id="editorUploadBar"></i></div></div>' +
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
    root.querySelector('#editorCancelUpload').addEventListener('click', function () {
      if (!uploadBatchInProgress) return;
      uploadBatchCancelled = true;
      uploadStatusText = 'Cancelling upload…';
      paintUploadStatus();
      if (currentUploadXhr) currentUploadXhr.abort();
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
        var currentBelongs = project && (listFilter === 'sent' ? !!project.productionPieceId : !project.productionPieceId);
        if (currentBelongs) return;
        project = null; selected.clear();
        var preferred = preferredProjectForFilter(listFilter);
        if (preferred) openProject(preferred.id);
        else {
          var workspace = root.querySelector('#editorWorkspace');
          if (workspace) workspace.innerHTML = '<div class="editor-empty"><strong>No ' + (listFilter === 'sent' ? 'sent' : 'active') + ' recordings</strong><span>' + (listFilter === 'sent' ? 'Approved edits will appear here.' : 'Upload a raw video to begin.') + '</span></div>';
        }
      });
    });
    paintUploadStatus();
  }

  function renderNotice() {
    var notice = root && root.querySelector('#editorNotice');
    if (!notice) return;
    notice.textContent = editorNotice;
    notice.hidden = !editorNotice;
  }

  function visibleProjectsForCurrentFilter() {
    return projects.filter(function (item) { return listFilter === 'sent' ? !!item.productionPieceId : !item.productionPieceId; }).sort(function (a, b) {
      if (listFilter === 'sent') return String(b.sentToProductionAt || b.updatedAt || '').localeCompare(String(a.sentToProductionAt || a.updatedAt || ''));
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
  }

  function paintProjectNavigation() {
    if (!root || !project) return;
    var items = visibleProjectsForCurrentFilter();
    var index = items.findIndex(function (item) { return item.id === project.id; });
    var previous = root.querySelector('#editorPreviousProject');
    var next = root.querySelector('#editorNextProject');
    var position = root.querySelector('#editorProjectPosition');
    if (previous) previous.disabled = index <= 0;
    if (next) next.disabled = index < 0 || index >= items.length - 1;
    if (position) position.textContent = index >= 0 ? (index + 1) + ' of ' + items.length : '';
  }

  function renderList() {
    var list = root && root.querySelector('#editorProjectList');
    if (!list) return;
    renderSessionSummary();
    var activeCount = projects.filter(function (item) { return !item.productionPieceId; }).length;
    var sentCount = projects.length - activeCount;
    var visibleProjects = visibleProjectsForCurrentFilter();
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
        '<strong>' + esc(displayName(item)) + '</strong><span>' + esc(statusLabel(item)) + ' · ' + formatTime(item.duration) + (formatBytes(item.sizeBytes) ? ' · ' + formatBytes(item.sizeBytes) : '') + '</span></button>';
    }).join('');
    list.querySelectorAll('.editor-project').forEach(function (button) {
      button.addEventListener('click', function () { openProject(button.dataset.id); });
    });
    if (window.innerWidth <= 800) {
      var activeCard = list.querySelector('.editor-project.active');
      if (activeCard) requestAnimationFrame(function () {
        if (!editorMounted() || !activeCard.isConnected) return;
        list.scrollTo({ left: Math.max(0, activeCard.offsetLeft - (list.clientWidth - activeCard.offsetWidth) / 2), behavior: 'smooth' });
      });
    }
    paintProjectNavigation();
  }

  function upload(file, queueIndex, queueTotal, completedBytes, totalBytes) {
    return new Promise(function (resolve, reject) {
    uploadStatusPercent = Math.round(completedBytes / Math.max(1, totalBytes) * 100);
    uploadStatusText = 'Uploading ' + (queueIndex + 1) + ' of ' + queueTotal + ' · ' + file.name + (formatBytes(file.size) ? ' · ' + formatBytes(file.size) : '');
    paintUploadStatus();
    var data = new FormData();
    data.append('video', file);
    data.append('name', file.name.replace(/\.[^.]+$/, ''));
    var xhr = new XMLHttpRequest();
    currentUploadXhr = xhr;
    xhr.open('POST', '/api/editor');
    xhr.withCredentials = true;
    xhr.upload.onprogress = function (event) {
      if (event.lengthComputable) {
        uploadStatusPercent = Math.round((completedBytes + Math.min(Number(file.size) || event.loaded, event.loaded)) / Math.max(1, totalBytes) * 100);
        paintUploadStatus();
      }
    };
    xhr.onload = function () {
      if (currentUploadXhr === xhr) currentUploadXhr = null;
      var body = {};
      try { body = JSON.parse(xhr.responseText || '{}'); } catch (e) {}
      if (xhr.status < 200 || xhr.status >= 300) {
        var uploadError = new Error(body.message || (xhr.status === 413 ? 'This recording is larger than the 2 GB upload limit. Split or trim the raw take, then try again.' : 'The recording could not be uploaded.'));
        uploadError.duplicate = body.error === 'duplicate_recording';
        uploadError.existingProjectId = body.existingProjectId || '';
        uploadError.transient = xhr.status === 408 || xhr.status === 425 || xhr.status === 429 || xhr.status >= 500;
        return reject(uploadError);
      }
      projects.unshift(body);
      renderList();
      resolve(body);
    };
    xhr.onerror = function () {
      if (currentUploadXhr === xhr) currentUploadXhr = null;
      var error = new Error('Upload failed. Check the connection and try again.');
      error.transient = true;
      reject(error);
    };
    xhr.onabort = function () {
      if (currentUploadXhr === xhr) currentUploadXhr = null;
      var error = new Error('Upload cancelled.');
      error.cancelled = true;
      reject(error);
    };
    xhr.send(data);
    });
  }

  function uploadWithRetry(file, queueIndex, queueTotal, completedBytes, totalBytes) {
    return upload(file, queueIndex, queueTotal, completedBytes, totalBytes).catch(function (firstError) {
      if (firstError.cancelled || firstError.duplicate || !firstError.transient) throw firstError;
      uploadStatusText = 'Connection interrupted · retrying ' + file.name + ' once…';
      paintUploadStatus();
      return new Promise(function (resolve) { setTimeout(resolve, 600); }).then(function () {
        if (uploadBatchCancelled) {
          var cancelled = new Error('Upload cancelled.');
          cancelled.cancelled = true;
          throw cancelled;
        }
        return upload(file, queueIndex, queueTotal, completedBytes, totalBytes);
      }).catch(function (retryError) {
        // The first request can finish server-side after the connection drops.
        // Byte identity makes the retry a duplicate; recover that existing
        // project as success instead of asking Harvey to upload it again.
        if (!retryError.duplicate || !retryError.existingProjectId) throw retryError;
        return api('/api/editor/' + encodeURIComponent(retryError.existingProjectId)).then(function (item) {
          if (!projects.some(function (entry) { return entry.id === item.id; })) projects.unshift(item);
          renderList();
          return item;
        });
      });
    });
  }

  function uploadFiles(fileList) {
    if (uploadBatchInProgress) {
      editorNotice = 'A filming batch is already uploading. Let it finish before adding another batch.';
      renderNotice();
      return;
    }
    var duplicateCount = 0;
    var oversized = [];
    var unsupported = [];
    var files = Array.prototype.slice.call(fileList || []).filter(function (file) {
      if (!isVideoFile(file)) { unsupported.push(file.name || 'Unnamed file'); return false; }
      if (Number(file.size) > MAX_RECORDING_BYTES) { oversized.push(file.name); return false; }
      return true;
    });
    if (!files.length) {
      if (oversized.length) return alert('These recordings are larger than the 2 GB per-file limit:\n\n' + oversized.join('\n') + '\n\nSplit or trim each raw take, then try again.');
      if (unsupported.length) return alert('These files do not look like supported recordings:\n\n' + unsupported.join('\n') + '\n\nUse MP4, MOV, M4V, WebM, MKV, or AVI.');
      return alert('Drop one or more video files.');
    }
    var created = [];
    var projectAtBatchStart = project && project.id || '';
    var failures = oversized.map(function (name) { return name + ': larger than the 2 GB per-file limit'; });
    unsupported.forEach(function (name) { failures.push(name + ': unsupported file type'); });
    editorNotice = '';
    renderNotice();
    uploadBatchInProgress = true;
    uploadBatchCancelled = false;
    uploadStatusText = 'Preparing ' + files.length + ' recording' + (files.length === 1 ? '' : 's') + '…';
    uploadStatusPercent = 0;
    paintUploadStatus();
    var sequence = Promise.resolve();
    var totalBytes = files.reduce(function (sum, file) { return sum + Math.max(0, Number(file.size) || 0); }, 0);
    var completedBytes = 0;
    files.forEach(function (file, index) {
      sequence = sequence.then(function () {
        if (uploadBatchCancelled) return;
        return uploadWithRetry(file, index, files.length, completedBytes, totalBytes).then(function (item) {
          created.push(item);
          // A fresh session can start showing automatic work as soon as its
          // first file is secured. Never steal selection from an edit Harvey
          // was already reviewing when he added a background batch.
          if (created.length === 1 && !projectAtBatchStart && !project && editorMounted()) openProject(item.id);
        }).catch(function (error) {
          if (error.cancelled) return;
          if (error.duplicate) duplicateCount++;
          else failures.push(file.name + ': ' + error.message);
        }).then(function () {
          completedBytes += Math.max(0, Number(file.size) || 0);
        });
      });
    });
    sequence.then(function () {
      var wasCancelled = uploadBatchCancelled;
      uploadBatchInProgress = false;
      uploadBatchCancelled = false;
      currentUploadXhr = null;
      uploadStatusPercent = wasCancelled ? uploadStatusPercent : 100;
      uploadStatusText = wasCancelled
        ? 'Batch cancelled' + (created.length ? ' · ' + created.length + ' recording' + (created.length === 1 ? '' : 's') + ' safely added before cancellation' : ' · no recordings added')
        : created.length + ' recording' + (created.length === 1 ? '' : 's') + ' added to the edit queue' + (duplicateCount ? ' · ' + duplicateCount + ' duplicate skipped' : '');
      paintUploadStatus();
      setTimeout(function () { uploadStatusText = ''; uploadStatusPercent = 0; paintUploadStatus(); }, 1400);
      if (created[0] && !project && editorMounted()) openProject(created[0].id);
      if (failures.length) alert('Some recordings could not be uploaded:\n\n' + failures.join('\n'));
    });
  }

  function loadProjects() {
    return api('/api/editor').then(function (items) {
      projects = items;
      renderList();
      if (!project && projects[0]) {
        var preferred = preferredProjectForFilter(listFilter);
        if (preferred) return openProject(preferred.id);
      }
    });
  }

  function openProject(id, quiet) {
    clearTimeout(pollTimer);
    return api('/api/editor/' + encodeURIComponent(id)).then(function (item) {
      var progressOnly = !!(quiet && project && project.id === item.id && project.renderStatus === 'running' && item.renderStatus === 'running');
      project = item;
      restoreReviewProgress(item);
      localStorage.setItem(rememberedProjectKey(item.productionPieceId ? 'sent' : 'active'), item.id);
      projects = projects.map(function (entry) { return entry.id === item.id ? item : entry; });
      selected.clear();
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
      ['pending', 'running'].indexOf(item.browserPreviewStatus) !== -1 ||
      ['pending', 'running'].indexOf(item.classificationStatus) !== -1 ||
      ['pending', 'running', 'pending_transcript'].indexOf(item.retakeAnalysisStatus) !== -1 ||
      ['pending', 'running', 'pending_transcript'].indexOf(item.planningMatchStatus) !== -1 ||
      ['queued', 'running'].indexOf(item.renderStatus) !== -1);
  }

  function projectPollSignature(item) {
    if (!item) return '';
    return [item.transcriptionStatus, item.browserPreviewStatus, item.classificationStatus, item.retakeAnalysisStatus, item.planningMatchStatus,
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
    if (!workspace || !project) return;
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
    var reviewProjects = visibleProjectsForCurrentFilter();
    var reviewProjectIndex = reviewProjects.findIndex(function (item) { return item.id === project.id; });
    var cutSeconds = Math.max(0, Number(project.duration) - editedDuration(project));
    var layout = project.effectiveLayout || (Number(project.height) > Number(project.width) ? 'vertical' : 'horizontal');
    var cropPercent = Math.round((Number(project.cropCenterX) || 0.5) * 100);
    var classificationCopy = project.classificationStatus === 'ready' && project.visualClassification
      ? (project.layoutReviewRequired ? 'Low-confidence detection. Confirm Frame once. ' : '') + esc(project.visualClassification.explanation || ('Frame analysis: ' + project.visualClassification.confidence + ' confidence'))
      : project.classificationStatus === 'running' || project.classificationStatus === 'pending'
        ? 'Analyzing three frames to distinguish a single page from an open spread…'
        : project.classificationStatus === 'error'
          ? (framingFailureIsBlocking(project) ? 'Automatic framing was unavailable. Choose Vertical or Horizontal once to continue.' : 'Automatic framing was unavailable. Your manual frame choice is being used.')
          : 'Using source dimensions until the book framing is analyzed.';
    var automaticEditRunning = ['pending', 'running'].indexOf(project.classificationStatus) !== -1 ||
      ['pending', 'running', 'pending_transcript'].indexOf(project.retakeAnalysisStatus) !== -1 ||
      ['pending', 'running', 'pending_transcript'].indexOf(project.planningMatchStatus) !== -1;
    var unresolvedRetakes = Number(project.unresolvedRetakeCount) || 0;
    var appliedRetakes = Number(project.appliedRetakeCount) || 0;
    var framingFailureBlocks = framingFailureIsBlocking(project);
    var failedSafetyCheck = project.retakeAnalysisStatus === 'error' || framingFailureBlocks;
    var renderBlocked = automaticEditRunning || failedSafetyCheck || unresolvedRetakes > 0 || project.layoutReviewRequired;
    var renderButtonText = automaticEditRunning ? 'Preparing automatic edit…' : project.retakeAnalysisStatus === 'error' ? 'Retry failed retake check' : framingFailureBlocks ? 'Retry framing or choose a frame' : project.layoutReviewRequired ? 'Confirm Vertical or Horizontal frame' : unresolvedRetakes ? 'Review ' + unresolvedRetakes + ' possible retake' + (unresolvedRetakes === 1 ? '' : 's') : 'Build final edit';
    var rendering = ['queued', 'running'].indexOf(project.renderStatus) !== -1;
    var sentToProduction = !!project.productionPieceId;
    var failures = failedSteps(project);
    var previewMode = project.renderStatus === 'ready' && previewModes[project.id] !== 'source' ? 'final' : 'source';
    var previewingWorkingEdit = previewMode === 'source' && project.renderStatus !== 'ready';
    var browserSafeSource = project.browserPreviewRequired && project.browserPreviewStatus === 'ready';
    var sourcePreviewLabel = browserSafeSource ? 'Browser-safe source copy' : 'Original master';
    var previewVersion = previewMode === 'final'
      ? (project.renderSha256 || project.lastRenderAt || project.updatedAt || '')
      : (browserSafeSource ? project.updatedAt : project.sourceSha256 || project.updatedAt || '');
    var previewUrl = previewMode === 'final'
      ? '/api/editor/' + encodeURIComponent(project.id) + '/render?inline=1&v=' + encodeURIComponent(previewVersion)
      : '/api/editor/' + encodeURIComponent(project.id) + '/source?v=' + encodeURIComponent(previewVersion);
    var previewSeek = Math.max(0, Number(previewSeekTimes[project.id]) || 0);
    var framingReadiness = ['pending', 'running'].indexOf(project.classificationStatus) !== -1
      ? '<i class="working">Framing checking</i>'
      : framingFailureBlocks ? '<i class="error">Framing failed</i>'
        : project.layoutReviewRequired ? '<i class="review">Framing confirm once</i>' : '<i class="ready">Framing ready</i>';
    var retakeReadiness = ['pending', 'running', 'pending_transcript'].indexOf(project.retakeAnalysisStatus) !== -1
      ? '<i class="working">Retakes checking</i>'
      : project.retakeAnalysisStatus === 'error' ? '<i class="error">Retake check failed</i>'
        : unresolvedRetakes ? '<i class="review">' + unresolvedRetakes + ' to review</i>'
          : '<i class="ready">' + (appliedRetakes ? appliedRetakes + ' removed · resolved' : 'Retakes resolved') + '</i>';
    var planReadiness = ['pending', 'running', 'pending_transcript'].indexOf(project.planningMatchStatus) !== -1
      ? '<i class="working">Plan matching</i>'
      : project.planningMatchStatus === 'error' ? '<i>Plan not linked · optional</i>'
        : '<i class="ready">Plan ' + (project.planningPieceId ? 'linked' : 'not required') + '</i>';
    var planningCopy = project.planningMatch && project.planningMatch.reason ||
      (project.planningMatchStatus === 'running' || project.planningMatchStatus === 'pending'
        ? 'Matching the transcript to Filmed cards…'
        : project.planningMatchStatus === 'error'
          ? 'Automatic matching was unavailable. Pick a card manually or retry when convenient; this does not block the edit.'
          : 'Choose a card manually if this recording came from the Kanban.');
    workspace.innerHTML =
      '<div class="editor-topbar"><div><h2>' + esc(displayName(project)) + '</h2><span>' + (project.planningPieceTitle ? esc(project.name) + ' · ' : '') + formatTime(project.duration) + ' original · ' + formatTime(editedDuration(project)) + ' edited · ' + cutSeconds.toFixed(1) + 's removed' + (formatBytes(project.sizeBytes) ? ' · ' + formatBytes(project.sizeBytes) + ' source' : '') + '</span></div>' +
        '<div class="editor-topbar-actions"><div class="editor-project-nav"><button type="button" class="btn-secondary btn-tiny" id="editorPreviousProject" ' + (reviewProjectIndex <= 0 ? 'disabled' : '') + '>← Previous</button><span id="editorProjectPosition">' + (reviewProjectIndex >= 0 ? (reviewProjectIndex + 1) + ' of ' + reviewProjects.length : '') + '</span><button type="button" class="btn-secondary btn-tiny" id="editorNextProject" ' + (reviewProjectIndex < 0 || reviewProjectIndex >= reviewProjects.length - 1 ? 'disabled' : '') + '>Next →</button></div>' +
          (!sentToProduction && project.renderStatus === 'ready' ? '<button type="button" class="btn-primary btn-tiny editor-quick-approve" data-editor-approve>Approve &amp; next</button>' : '') +
          '<span class="editor-save-state ' + esc(saveStates[project.id] || '') + '" id="editorSaveState">' + ({ saving: 'Saving…', saved: 'Saved', error: 'Save failed' }[saveStates[project.id]] || '') + '</span><button class="editor-delete" id="editorDelete">' + (sentToProduction ? 'Remove Editor files' : 'Delete recording') + '</button></div></div>' +
      (rendering ? '<div class="editor-lock-notice"><strong>Final edit is encoding</strong><span>Review remains available. Editing unlocks as soon as the verified file is ready.</span></div>' : '') +
      (project.browserPreviewRequired && ['pending', 'running'].indexOf(project.browserPreviewStatus) !== -1 && previewMode === 'source' ? '<div class="editor-lock-notice"><strong>Preparing a browser-safe source preview</strong><span>The camera master is preserved and final editing continues. This view will switch to H.264 automatically when ready.</span></div>' : '') +
      (sentToProduction ? '<div class="editor-lock-notice approved"><strong>Approved version locked</strong><span>The exact reviewed file is now in Content Production. Source and final previews remain available here.</span></div>' : '') +
      (failures.length ? '<div class="editor-error-recovery"><div><strong>' + failures.join(', ') + ' need' + (failures.length === 1 ? 's' : '') + ' attention</strong><span>Retry the failed automatic work without changing the source recording or your edit decisions.</span></div><button type="button" class="btn-secondary btn-tiny" id="editorRetryFailed">Retry failed steps</button></div>' : '') +
      (project.workflowWarning ? '<div class="editor-workflow-warning"><strong>Video workflow needs attention</strong><span>' + esc(project.workflowWarning) + '</span></div>' : '') +
      '<section class="editor-classification"><div><div class="eyebrow">Automatic classification</div><strong>' + (layout === 'vertical' ? 'Single page · Vertical' : 'Open spread · Horizontal') + '</strong><span>' + classificationCopy + ' · ' + esc(typeLabel(project.detectedContentType)) + '</span>' +
        (project.classificationStatus !== 'ready' && project.classificationStatus !== 'running' && project.classificationStatus !== 'pending' ? '<button type="button" class="editor-analyze" id="editorAnalyze">Analyze book framing</button>' : '') + '</div>' +
        '<label>Frame<select id="editorLayout"><option value="auto"' + (project.layoutOverride === 'auto' || !project.layoutOverride ? ' selected' : '') + '>Auto detect</option><option value="vertical"' + (project.layoutOverride === 'vertical' ? ' selected' : '') + '>Vertical · single page</option><option value="horizontal"' + (project.layoutOverride === 'horizontal' ? ' selected' : '') + '>Horizontal · open spread</option></select></label>' +
        '<label>Format<select id="editorContentType"><option value="auto"' + (project.contentTypeOverride === 'auto' || !project.contentTypeOverride ? ' selected' : '') + '>Auto · ' + esc(typeLabel(project.detectedContentType)) + '</option><option value="ultra_short"' + (project.contentTypeOverride === 'ultra_short' ? ' selected' : '') + '>Ultra-short</option><option value="short"' + (project.contentTypeOverride === 'short' ? ' selected' : '') + '>Short</option><option value="long_short"' + (project.contentTypeOverride === 'long_short' ? ' selected' : '') + '>Long-short</option><option value="longform"' + (project.contentTypeOverride === 'longform' ? ' selected' : '') + '>Longform</option></select></label></section>' +
      '<section class="editor-plan-link"><div><div class="eyebrow">Planning workflow</div><strong>' + (project.planningPieceId ? 'Linked to ' + esc(displayName(project)) : 'No planning card linked') + '</strong><span>' + esc(planningCopy) + '</span></div><label>Content card<select id="editorPlanningPiece">' + planningOptionsHtml(project) + '</select></label>' +
        (project.planningMatchStatus !== 'running' && project.planningMatchStatus !== 'pending' ? '<button type="button" class="editor-analyze" id="editorMatchPlan">Match again</button>' : '') + '</section>' +
      '<div class="editor-preview-mode"><div><strong>' + (previewMode === 'final' ? 'Final edit' : previewingWorkingEdit ? 'Working preview' : sourcePreviewLabel) + '</strong><span>' + (previewMode === 'final' ? 'This is the actual encoded file that will go to production.' : previewingWorkingEdit ? 'Cuts and caption timing are previewed instantly while the verified edit builds.' : browserSafeSource ? 'H.264 review copy of the untouched take. The original ' + esc(String(project.videoCodec || 'camera').toUpperCase()) + ' master remains preserved for final rendering.' : 'Untouched source playback for checking anything the edit removed.') + '</span></div>' +
        '<div class="editor-preview-actions"><span class="editor-review-keys">Space play/pause · ←/→ 2s</span><label>Review speed<select id="editorReviewRate"><option value="1"' + (reviewRate === 1 ? ' selected' : '') + '>1×</option><option value="1.25"' + (reviewRate === 1.25 ? ' selected' : '') + '>1.25×</option><option value="1.5"' + (reviewRate === 1.5 ? ' selected' : '') + '>1.5×</option><option value="2"' + (reviewRate === 2 ? ' selected' : '') + '>2×</option></select></label>' +
        (project.renderStatus === 'ready' ? '<button type="button" id="editorPreviewFinal" class="' + (previewMode === 'final' ? 'active' : '') + '">Final edit</button><button type="button" id="editorPreviewSource" class="' + (previewMode === 'source' ? 'active' : '') + '">' + sourcePreviewLabel + '</button>' : '') + '</div></div>' +
      '<div class="editor-preview" id="editorPreview" tabindex="0" aria-label="Video review. Space plays or pauses. Left and right arrows move two seconds."><div class="editor-video-frame ' + layout + '" style="--crop-x:' + cropPercent + '%"><video id="editorVideo" data-preview-mode="' + previewMode + '" data-seek-time="' + previewSeek.toFixed(3) + '" controls playsinline preload="metadata" src="' + previewUrl + '"></video>' +
        '<div class="editor-caption" id="editorCaption"></div><div class="editor-video-error" id="editorVideoError" hidden><strong>Preview could not be played</strong><span>Your recording and edit are safe. Reload this review copy without rebuilding anything.</span><button type="button" class="btn-secondary btn-tiny" id="editorReloadVideo">Reload preview</button></div></div></div>' +
      (layout === 'vertical' ? '<div class="editor-crop-control"><label>Horizontal crop position <input id="editorCropX" type="range" min="0" max="100" value="' + cropPercent + '"></label><span>Keep the single page centred inside the vertical frame.</span></div>' : '') +
      '<section class="editor-automation"><div class="editor-automation-head"><div><div class="eyebrow">Automatic edit</div><h3>Speech and pause map</h3></div><div class="editor-legend"><span class="speech">Speech</span><span class="cut">Removed pause</span><span class="pause">Kept pause</span></div></div>' + timelineHtml(project) +
        '<div class="editor-controls"><label class="editor-toggle"><input type="checkbox" id="editorAutoSilence" ' + (project.autoSilenceEnabled !== false ? 'checked' : '') + '><span></span>Remove long pauses</label>' +
          '<label class="editor-toggle"><input type="checkbox" id="editorCaptions" ' + (project.captionsEnabled !== false ? 'checked' : '') + '><span></span>Add yellow captions</label>' +
          '<label class="editor-mode">Pacing<select id="editorPacing"><option value="tight"' + (Number(project.silenceThresholdSeconds) < 0.85 ? ' selected' : '') + '>Tight</option><option value="natural"' + (Number(project.silenceThresholdSeconds || 1) >= 0.85 && Number(project.silenceThresholdSeconds || 1) < 1.3 ? ' selected' : '') + '>Natural</option><option value="gentle"' + (Number(project.silenceThresholdSeconds || 1) >= 1.3 ? ' selected' : '') + '>Gentle</option></select></label></div></section>' +
      '<section class="editor-review"><div class="editor-review-column"><div class="editor-section-title"><div><div class="eyebrow">Pause decisions</div><h3>Every automatic silence cut</h3></div><span>Red means removed</span></div><div id="editorGapReview">' + gapReviewHtml(project) + '</div></div>' +
        '<div class="editor-review-column"><div class="editor-section-title"><div><div class="eyebrow">Smart review</div><h3>Possible retakes</h3></div>' +
          (project.retakeAnalysisStatus !== 'ready' && project.retakeAnalysisStatus !== 'pending' && project.retakeAnalysisStatus !== 'running' ? '<button type="button" class="editor-analyze" id="editorAnalyzeRetakes">Analyze retakes</button>' : '<span>Only clear failed takes are automatic</span>') + '</div><div id="editorRetakeReview">' + retakeReviewHtml(project) + '</div></div></section>' +
      '<section class="editor-transcript-panel"><div class="editor-transcript-head"><div><div class="eyebrow">Transcript editor</div><h3>Select words or sentences to cut them from the video</h3></div>' +
        '<div class="editor-transcript-actions"><button class="btn-secondary btn-tiny" id="editorUndo" ' + (!project.canUndoCut ? 'disabled' : '') + '>Undo last decision</button><button class="btn-secondary btn-tiny" id="editorPlaySelection" disabled>Play selected</button>' +
        '<button class="btn-secondary btn-tiny" id="editorCorrect" disabled>Correct word</button><button class="btn-secondary btn-tiny" id="editorRestore" disabled>Restore selected</button><button class="btn-primary btn-tiny" id="editorCut" disabled>Cut selected</button></div></div>' +
        '<div class="editor-correction-tray" id="editorCorrectionTray" hidden><div><strong>Correct caption word</strong><span id="editorCorrectionNote">Timing stays exactly where it is.</span><em id="editorCorrectionError" hidden></em></div><input id="editorCorrectionInput" maxlength="40" autocomplete="off" aria-label="Corrected caption word"><div><button type="button" class="btn-secondary btn-tiny" id="editorCorrectionCancel">Cancel</button><button type="button" class="btn-secondary btn-tiny" id="editorCorrectionOriginal" hidden>Use original</button><button type="button" class="btn-primary btn-tiny" id="editorCorrectionSave">Save correction</button></div></div>' +
        '<div class="editor-transcript' + (rendering || sentToProduction ? ' locked' : '') + '" id="editorTranscript" tabindex="0">' + (project.words || []).map(function (word) {
          return '<span class="editor-word' + (removed.has(word.index) ? ' removed' : '') + (word.originalText ? ' corrected' : '') + '" data-index="' + word.index + '" data-start="' + word.start + '" data-end="' + word.end + '"' + (word.originalText ? ' title="Originally transcribed as: ' + esc(word.originalText) + '"' : '') + '>' + esc(word.text) + '</span> ';
        }).join('') + '</div><p class="editor-selection-hint">Drag across text or click words. Press Delete to cut, Ctrl/⌘ Z to undo, or Escape to clear. Removed words remain visible so you can restore them.</p></section>' +
      '<div class="editor-export"><div><strong>Next: Content Production</strong><span>' +
        (project.productionPieceId ? 'This edit is ready in Content Production for titles, thumbnail, and ambient music.' :
          project.renderStatus === 'ready' ? 'Send the finished edit across without uploading it again.' :
          'Build the final edit first. Yellow captions will be baked in below center.') + '</span>' +
        '<div class="editor-readiness"><i class="ready">Transcript ready</i>' + framingReadiness + retakeReadiness + planReadiness + (project.renderStatus === 'ready' ? '<i class="ready">Output verified</i>' : '') + '</div>' +
        (['queued', 'running'].indexOf(project.renderStatus) !== -1 ? '<div class="editor-render-progress"><span id="editorRenderProgressLabel">' + (project.renderStatus === 'queued' ? (Number(project.renderQueuePosition) > 1 ? (Number(project.renderQueuePosition) - 1) + ' recording(s) ahead in the render queue' : 'Next in the render queue') : 'Encoding final edit · ' + Math.round(Number(project.renderProgress) || 0) + '%') + '</span><div><i id="editorRenderProgressBar" style="width:' + (project.renderStatus === 'queued' ? 4 : Math.max(2, Number(project.renderProgress) || 0)) + '%"></i></div></div>' : '') +
        (project.renderStatus === 'error' ? '<em>' + esc(project.renderError) + '</em>' : '') + '</div><div class="editor-export-actions">' +
        (project.productionPieceId ? '<button class="btn-primary" id="editorOpenProduction">Open Content Production</button>' :
          project.renderStatus === 'ready' ? '<button class="btn-primary" id="editorSendProduction" data-editor-approve>Approve &amp; Send to Production</button>' :
          '<button class="btn-primary" id="editorRender" ' + (['queued', 'running'].indexOf(project.renderStatus) !== -1 || renderBlocked ? 'disabled' : '') + '>' + (project.renderStatus === 'queued' ? 'Waiting in render queue…' : project.renderStatus === 'running' ? 'Building final edit… ' + Math.round(Number(project.renderProgress) || 0) + '%' : renderButtonText) + '</button>') +
        '</div></div>';
    bindWorkspace();
    paintSelection();
  }

  function bindWorkspace() {
    var video = root.querySelector('#editorVideo');
    var videoProjectId = project.id;
    var caption = root.querySelector('#editorCaption');
    var transcript = root.querySelector('#editorTranscript');
    var previewingFinal = video.dataset.previewMode === 'final';
    var previewingOriginalMaster = !previewingFinal && project.renderStatus === 'ready';
    var rendering = ['queued', 'running'].indexOf(project.renderStatus) !== -1;
    var sentToProduction = !!project.productionPieceId;
    var editingLocked = rendering || sentToProduction;
    var previousProjectButton = root.querySelector('#editorPreviousProject');
    var nextProjectButton = root.querySelector('#editorNextProject');
    if (previousProjectButton) previousProjectButton.onclick = function () {
      var items = visibleProjectsForCurrentFilter();
      var index = items.findIndex(function (item) { return item.id === project.id; });
      if (index > 0) openProject(items[index - 1].id);
    };
    if (nextProjectButton) nextProjectButton.onclick = function () {
      var items = visibleProjectsForCurrentFilter();
      var index = items.findIndex(function (item) { return item.id === project.id; });
      if (index >= 0 && index + 1 < items.length) openProject(items[index + 1].id);
    };
    video.playbackRate = reviewRate;
    var videoError = root.querySelector('#editorVideoError');
    video.addEventListener('loadeddata', function () {
      if (videoError) videoError.hidden = true;
      if (mediaRecoveryChecks[videoProjectId]) clearTimeout(mediaRecoveryChecks[videoProjectId]);
      delete mediaRecoveryChecks[videoProjectId];
    });
    video.addEventListener('error', function () {
      if (videoError) videoError.hidden = false;
      if (!mediaRecoveryChecks[videoProjectId]) {
        mediaRecoveryChecks[videoProjectId] = setTimeout(function () {
          if (!editorMounted() || !project || project.id !== videoProjectId) {
            delete mediaRecoveryChecks[videoProjectId];
            return;
          }
          openProject(videoProjectId, true);
        }, 800);
      }
    });
    root.querySelector('#editorReloadVideo').onclick = function () {
      var wasPlaying = !video.paused && !video.ended;
      var retryUrl = new URL(video.currentSrc || video.src, window.location.href);
      retryUrl.searchParams.set('retry', String(Date.now()));
      if (videoError) videoError.hidden = true;
      if (mediaRecoveryChecks[videoProjectId]) clearTimeout(mediaRecoveryChecks[videoProjectId]);
      delete mediaRecoveryChecks[videoProjectId];
      video.src = retryUrl.pathname + retryUrl.search;
      video.load();
      if (wasPlaying) video.addEventListener('loadeddata', function () { video.play().catch(function () {}); }, { once: true });
    };
    if (restoreTranscriptFocus && !editingLocked) {
      restoreTranscriptFocus = false;
      transcript.focus({ preventScroll: true });
    }
    var resumeTime = Number(video.dataset.seekTime) || 0;
    var shouldAutoplay = !!previewAutoplay[project.id];
    if (resumeTime > 0 || shouldAutoplay) {
      var resumePreview = function () {
        video.currentTime = Math.min(resumeTime, Math.max(0, Number(video.duration) || resumeTime));
        delete previewSeekTimes[project.id];
        if (previewAutoplay[project.id]) {
          delete previewAutoplay[project.id];
          video.play().catch(function () {});
        }
      };
      if (video.readyState >= 1) resumePreview(); else video.addEventListener('loadedmetadata', resumePreview, { once: true });
    }
    var lastClicked = null;
    var ignoreNextClick = false;
    var playingWordIndex = null;
    var lastReviewProgressSaveAt = 0;
    function isLongformVideo() {
      return (project.effectiveLayout || 'horizontal') === 'horizontal';
    }
    video.addEventListener('timeupdate', function () {
      if (Number.isFinite(previewStopTimes[project.id]) && video.currentTime >= previewStopTimes[project.id]) {
        video.pause();
        delete previewStopTimes[project.id];
      }
      var sourcePlayheadTime = previewingFinal ? editedToSourceTime(video.currentTime, project) : video.currentTime;
      var now = Date.now();
      if (sourcePlayheadTime >= 1 && now - lastReviewProgressSaveAt >= 500) {
        lastReviewProgressSaveAt = now;
        try {
          sessionStorage.setItem(reviewProgressKey(videoProjectId), JSON.stringify({
            sourceTime: sourcePlayheadTime,
            mode: previewingFinal ? 'final' : 'source'
          }));
        } catch (error) {}
      }
      var currentWord = (project.words || []).find(function (word) {
        return sourcePlayheadTime >= Number(word.start) && sourcePlayheadTime <= Number(word.end) + 0.08;
      });
      var nextPlayingWordIndex = currentWord ? Number(currentWord.index) : null;
      if (playingWordIndex !== nextPlayingWordIndex) {
        if (playingWordIndex !== null) {
          var priorWord = transcript.querySelector('.editor-word[data-index="' + playingWordIndex + '"]');
          if (priorWord) priorWord.classList.remove('playing');
        }
        if (nextPlayingWordIndex !== null) {
          var nextWord = transcript.querySelector('.editor-word[data-index="' + nextPlayingWordIndex + '"]');
          if (nextWord) nextWord.classList.add('playing');
        }
        playingWordIndex = nextPlayingWordIndex;
      }
      var playhead = root.querySelector('#editorPlayhead');
      if (playhead && project.duration) {
        playhead.style.left = Math.min(100, sourcePlayheadTime / project.duration * 100) + '%';
      }
      if (previewingFinal) {
        caption.classList.remove('visible');
        return;
      }
      if (!previewingOriginalMaster) {
        var cut = (project.cuts || []).filter(function (item) { return video.currentTime >= item.start && video.currentTime < item.end; })[0];
        if (cut && cut.end < video.duration) { video.currentTime = cut.end + 0.01; return; }
      }
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
          caption.style.fontSize = (Math.max(4, Math.min(11.1, 11.1 * 15 / Math.max(15, characters)))).toFixed(2) + 'cqw';
        }
      } else if (group) caption.textContent = group.text;
      caption.classList.toggle('visible', !!group && project.captionsEnabled !== false);
    });
    video.addEventListener('ended', function () { clearReviewProgress(videoProjectId); });
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
        if (project.renderStatus === 'ready' && !previewingFinal) {
          previewModes[project.id] = 'final';
          previewSeekTimes[project.id] = sourceToEditedTime(time, project.cuts);
          previewAutoplay[project.id] = true;
          renderWorkspace();
          var replacementVideo = root.querySelector('#editorVideo');
          if (replacementVideo) replacementVideo.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
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
    root.querySelector('#editorPreview').addEventListener('keydown', function (event) {
      if (event.target.closest('select, button, input')) return;
      if (event.code === 'Space') {
        event.preventDefault();
        if (video.paused) video.play().catch(function () {}); else video.pause();
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        var direction = event.key === 'ArrowLeft' ? -1 : 1;
        video.currentTime = Math.max(0, Math.min(Number(video.duration) || Infinity, video.currentTime + direction * 2));
      }
    });
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
      if (project.canUndoCut && (event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'z') {
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
    root.querySelector('#editorPlaySelection').onclick = function () {
      var chosen = Array.from(selected).sort(function (a, b) { return a - b; });
      var firstWord = chosen.length ? (project.words || [])[chosen[0]] : null;
      var lastWord = chosen.length ? (project.words || [])[chosen[chosen.length - 1]] : null;
      if (!firstWord) return;
      var sourceTime = Math.max(0, Number(firstWord.start) - 0.8);
      previewStopTimes[project.id] = Math.min(Number(project.duration) || Infinity, Number(lastWord && lastWord.end || firstWord.end) + 0.8);
      if (previewingFinal) {
        previewModes[project.id] = 'source';
        previewSeekTimes[project.id] = sourceTime;
        previewAutoplay[project.id] = true;
        renderWorkspace();
        return;
      }
      video.currentTime = sourceTime;
      video.play().catch(function () {});
      video.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    root.querySelector('#editorCorrect').onclick = correctSelectedWord;
    root.querySelector('#editorCorrectionCancel').onclick = closeWordCorrection;
    root.querySelector('#editorCorrectionOriginal').onclick = function () {
      var index = Number(root.querySelector('#editorCorrectionTray').dataset.index);
      var word = Number.isInteger(index) ? (project.words || [])[index] : null;
      if (!word || !word.originalText) return;
      root.querySelector('#editorCorrectionInput').value = word.originalText;
      saveWordCorrection();
    };
    root.querySelector('#editorCorrectionSave').onclick = saveWordCorrection;
    root.querySelector('#editorCorrectionInput').onkeydown = function (event) {
      if (event.key === 'Enter') { event.preventDefault(); saveWordCorrection(); }
      if (event.key === 'Escape') { event.preventDefault(); closeWordCorrection(); }
    };
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
        var gapId = button.dataset.gapId;
        save(function (latest) {
          var next = new Set((latest.restoredAutoCutIds || []).map(String));
          if (next.has(gapId)) next.delete(gapId); else next.add(gapId);
          return { restoredAutoCutIds: Array.from(next) };
        }, true);
      };
    });
    root.querySelectorAll('.editor-retake-apply').forEach(function (button) {
      button.onclick = function () {
        var candidateId = button.dataset.id;
        save(function (latest) {
          var candidate = (latest.retakeCandidates || []).find(function (item) { return item.id === candidateId; });
          var next = new Set((latest.removedWordIndices || []).map(Number));
          if (candidate) candidate.removeWordIndices.forEach(function (index) { next.add(index); });
          return { removedWordIndices: Array.from(next).sort(function (a, b) { return a - b; }) };
        });
      };
    });
    root.querySelectorAll('.editor-retake-dismiss').forEach(function (button) {
      button.onclick = function () {
        var candidateId = button.dataset.id;
        var restoreAppliedTake = button.dataset.applied === '1';
        save(function (latest) {
          var next = new Set((latest.dismissedRetakeIds || []).map(String));
          next.add(candidateId);
          var patch = { dismissedRetakeIds: Array.from(next) };
          if (restoreAppliedTake) {
            var candidate = (latest.retakeCandidates || []).find(function (item) { return item.id === candidateId; });
            var removed = new Set((latest.removedWordIndices || []).map(Number));
            if (candidate) candidate.removeWordIndices.forEach(function (index) { removed.delete(index); });
            patch.removedWordIndices = Array.from(removed).sort(function (a, b) { return a - b; });
          }
          return patch;
        }, true);
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
    var approveButtons = Array.from(root.querySelectorAll('[data-editor-approve]'));
    function approveCurrentProject() {
      var approvedId = project.id;
      var approvedName = project.name;
      approveButtons.forEach(function (button) { button.disabled = true; button.textContent = 'Approving…'; });
      api('/api/editor/' + project.id + '/production', { method: 'POST' }).then(function (result) {
        project.productionPieceId = result.pieceId;
        clearReviewProgress(approvedId);
        project.sentToProductionAt = new Date().toISOString();
        project.workflowWarning = result.workflowWarning || '';
        projects = projects.map(function (item) { return item.id === approvedId ? Object.assign({}, item, { productionPieceId: result.pieceId, sentToProductionAt: project.sentToProductionAt, workflowWarning: project.workflowWarning }) : item; });
        editorNotice = approvedName + ' was approved and sent to Content Production.' + (project.workflowWarning ? ' The video is safe; check its planning-card warning when convenient.' : '');
        if (!editorMounted()) return;
        var next = nextActionableProject(approvedId);
        if (next) return openProject(next.id).then(renderNotice);
        renderList();
        renderWorkspace();
        renderNotice();
      }).catch(function (error) {
        approveButtons.forEach(function (button) {
          button.disabled = false;
          button.textContent = button.id === 'editorSendProduction' ? 'Approve & Send to Production' : 'Approve & next';
        });
        alert(error.message);
        if (editorMounted()) openProject(approvedId, true);
      });
    }
    approveButtons.forEach(function (button) { button.onclick = approveCurrentProject; });
    var openButton = root.querySelector('#editorOpenProduction');
    if (openButton) openButton.onclick = function () {
      if (typeof window.__rmOpenContentProduction === 'function') window.__rmOpenContentProduction(project.productionPieceId);
      else location.hash = 'upload-files';
    };
    root.querySelector('#editorDelete').onclick = function () {
      var message = project.productionPieceId
        ? 'Remove this Editor source and render? The approved Content Production copy will remain safe.'
        : 'Permanently delete this original recording and its rendered edit? This cannot be undone.';
      if (!confirm(message)) return;
      var id = project.id;
      api('/api/editor/' + id, { method: 'DELETE' }).then(function () {
        clearTimeout(renderRefreshTimers[id]); delete renderRefreshTimers[id];
        ['active', 'sent'].forEach(function (filter) {
          var key = rememberedProjectKey(filter);
          if (localStorage.getItem(key) === id) localStorage.removeItem(key);
        });
        projects = projects.filter(function (item) { return item.id !== id; });
        clearReviewProgress(id);
        project = null; selected.clear(); renderList();
        var workspace = root && root.querySelector('#editorWorkspace');
        if (workspace) workspace.innerHTML = '<div class="editor-empty"><strong>Recording deleted</strong><span>Select another recording or upload a new one.</span></div>';
        var next = listFilter === 'active' ? nextActionableProject() : projects.filter(function (item) { return !!item.productionPieceId; })[0];
        if (next && editorMounted()) openProject(next.id);
      });
    };
    if (editingLocked) {
      ['#editorAnalyze', '#editorLayout', '#editorContentType', '#editorPlanningPiece', '#editorMatchPlan', '#editorCropX', '#editorAutoSilence', '#editorCaptions', '#editorPacing', '#editorAnalyzeRetakes', '#editorUndo', '#editorCorrect', '#editorRestore', '#editorCut'].forEach(function (selector) {
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
    root.querySelector('#editorCorrect').disabled = locked || selected.size !== 1;
    root.querySelector('#editorPlaySelection').disabled = selected.size === 0;
  }

  function correctSelectedWord() {
    if (selected.size !== 1 || !project || project.productionPieceId) return;
    var index = Array.from(selected)[0];
    var word = (project.words || [])[index];
    if (!word) return;
    var tray = root.querySelector('#editorCorrectionTray');
    var input = root.querySelector('#editorCorrectionInput');
    tray.dataset.index = String(index);
    root.querySelector('#editorCorrectionNote').textContent = word.originalText ? 'Originally transcribed as “' + word.originalText + '”. Timing stays unchanged.' : 'Timing stays exactly where it is.';
    root.querySelector('#editorCorrectionError').hidden = true;
    root.querySelector('#editorCorrectionOriginal').hidden = !word.originalText;
    input.value = word.text;
    tray.hidden = false;
    input.focus();
    input.select();
  }

  function closeWordCorrection() {
    var tray = root.querySelector('#editorCorrectionTray');
    tray.hidden = true;
    delete tray.dataset.index;
    var transcript = root.querySelector('#editorTranscript');
    if (transcript) transcript.focus({ preventScroll: true });
  }

  function saveWordCorrection() {
    var tray = root.querySelector('#editorCorrectionTray');
    var input = root.querySelector('#editorCorrectionInput');
    var index = Number(tray.dataset.index);
    var word = Number.isInteger(index) ? (project.words || [])[index] : null;
    var replacement = String(input.value || '').replace(/[\r\n]+/g, ' ').trim();
    var correctionError = root.querySelector('#editorCorrectionError');
    if ((project.effectiveLayout || 'horizontal') === 'vertical' && /\s/.test(replacement)) {
      correctionError.textContent = 'Vertical captions allow one word here, without spaces.';
      correctionError.hidden = false;
      input.focus();
      return;
    }
    if (!word || !replacement || replacement === word.text) return closeWordCorrection();
    tray.hidden = true;
    selected.clear();
    save({ wordCorrection: { index: index, text: replacement } }, true);
  }

  function alterSelected(remove) {
    var chosen = Array.from(selected).map(Number);
    selected.clear();
    save(function (latest) {
      var next = new Set((latest.removedWordIndices || []).map(Number));
      chosen.forEach(function (index) { if (remove) next.add(index); else next.delete(index); });
      return { removedWordIndices: Array.from(next).sort(function (a, b) { return a - b; }) };
    });
  }

  function undo() {
    if (!project || !project.canUndoCut) return;
    rememberPlaybackBeforeEdit(project.id, true);
    selected.clear();
    queueProjectUpdate(project.id, function (id) {
      var latest = project && project.id === id ? project : projects.find(function (item) { return item.id === id; });
      return api('/api/editor/' + id + '/undo-cut', { method: 'POST', body: JSON.stringify({ expectedEditRevision: Number(latest && latest.editRevision) || 0 }) }).catch(function (error) {
        if (error.code !== 'edit_conflict') throw error;
        return api('/api/editor/' + id).then(function (fresh) {
          projects = projects.map(function (entry) { return entry.id === id ? fresh : entry; });
          if (project && project.id === id) { project = fresh; renderWorkspace(); }
          throw error;
        });
      });
    });
  }

  function queueProjectUpdate(id, operation) {
    saveStates[id] = 'saving';
    var stateNode = root.querySelector('#editorSaveState');
    if (stateNode && project && project.id === id) { stateNode.className = 'editor-save-state saving'; stateNode.textContent = 'Saving…'; }
    var previous = saveQueues[id] || Promise.resolve();
    var request = previous.catch(function () {}).then(function () {
      return operation(id);
    }).then(function (item) {
      saveStates[id] = 'saved';
      projects = projects.map(function (entry) { return entry.id === item.id ? item : entry; });
      renderList();
      if (project && project.id === id) {
        project = item; renderWorkspace();
        // The server starts a replacement render immediately after an edit.
        // Its PATCH response can arrive just before that queued status is
        // persisted, so fetch once more rather than leaving a hands-off
        // rebuild invisible until the page is revisited.
        if (!item.renderStatus && !item.productionPieceId) {
          clearTimeout(renderRefreshTimers[id]);
          renderRefreshTimers[id] = setTimeout(function () {
            delete renderRefreshTimers[id];
            if (editorMounted() && project && project.id === id && !project.renderStatus) openProject(id, true);
          }, 2900);
        }
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

  function save(patch) {
    var id = project.id;
    var renderKeys = ['removedWordIndices', 'wordCorrection', 'autoSilenceEnabled', 'restoredAutoCutIds', 'captionsEnabled',
      'layoutOverride', 'cropCenterX', 'silenceThresholdSeconds', 'retainedPauseSeconds'];
    var renderWillChange = typeof patch === 'function' || renderKeys.some(function (key) {
      return patch && Object.prototype.hasOwnProperty.call(patch, key);
    });
    rememberPlaybackBeforeEdit(id, renderWillChange);
    return queueProjectUpdate(id, function () {
      var latest = project && project.id === id ? project : projects.find(function (item) { return item.id === id; });
      function attempt(base, canRetryConflict) {
        var resolvedPatch = typeof patch === 'function' ? patch(base || {}) : patch;
        var payload = Object.assign({}, resolvedPatch, { expectedEditRevision: Number(base && base.editRevision) || 0 });
        return api('/api/editor/' + id, { method: 'PATCH', body: JSON.stringify(payload) }).catch(function (error) {
          if (error.code !== 'edit_conflict' || !canRetryConflict) throw error;
          return api('/api/editor/' + id).then(function (fresh) {
            projects = projects.map(function (entry) { return entry.id === id ? fresh : entry; });
            if (project && project.id === id) project = fresh;
            return attempt(fresh, false);
          });
        });
      }
      return attempt(latest || {}, true);
    });
  }

  window.RMEditor = {
    mount: function (element) {
      mountToken++;
      clearTimeout(pollTimer);
      Object.keys(renderRefreshTimers).forEach(function (id) { clearTimeout(renderRefreshTimers[id]); });
      // Save queues deliberately survive a tab round trip. A PATCH already in
      // flight must remain the predecessor of any new edit made immediately
      // after returning, or two browser requests can race despite serialization
      // within each individual mount.
      root = element; projects = []; project = null; selected.clear(); renderRefreshTimers = {}; previewSeekTimes = {}; restoreTranscriptFocus = false;
      shell();
      loadProjects().catch(function (error) {
        var workspace = root && root.querySelector('#editorWorkspace');
        if (workspace) workspace.innerHTML = '<div class="editor-empty"><strong>Editor unavailable</strong><span>' + esc(error.message) + '</span></div>';
      });
    }
  };

  window.addEventListener('beforeunload', function (event) {
    if (!uploadBatchInProgress) return;
    event.preventDefault();
    event.returnValue = '';
  });
})();
