(function () {
  'use strict';

  var root = null;
  var projects = [];
  var project = null;
  var selected = new Set();
  var pollTimer = null;
  var mountToken = 0;
  var openRequestToken = 0;
  var pendingExplicitOpenToken = 0;
  var editorNotice = '';
  var previewModes = {};
  var explicitSourcePreviews = {};
  var previewSeekTimes = {};
  var previewAutoplay = {};
  var previewStopTimes = {};
  var saveQueues = {};
  var saveStates = {};
  var projectDetails = {};
  var renderRefreshTimers = {};
  var localPreviewRebuilds = {};
  var mediaRecoveryChecks = {};
  var audioTracks = [];
  var audioMixVersion = '';
  var audioPreviewBatches = {};
  var activeAudioPanelRefresh = null;
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
    if (!uploadBatchInProgress && !Object.keys(saveQueues).length) return;
    event.preventDefault();
    event.returnValue = '';
  });

  window.addEventListener('beforeunload', function () {
    Object.keys(audioPreviewBatches).forEach(releaseAudioPreviewBatch);
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

  function retryTransientOnce(operation, delayMs) {
    return operation().catch(function (error) {
      var transient = !error.status || error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
      if (!transient) throw error;
      return new Promise(function (resolve) { setTimeout(resolve, Math.max(0, Number(delayMs) || 0)); }).then(operation);
    });
  }

  function formatTime(seconds) {
    seconds = Math.max(0, Number(seconds) || 0);
    var minutes = Math.floor(seconds / 60);
    return minutes + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
  }

  function releaseAudioPreviewBatch(id) {
    var batch = audioPreviewBatches[id];
    if (!batch) return;
    batch.cancelled = true;
    Object.keys(batch.urls || {}).forEach(function (trackId) { URL.revokeObjectURL(batch.urls[trackId]); });
    delete audioPreviewBatches[id];
  }

  function audioPreviewFingerprint(item) {
    return [item && item.renderSha256 || '', audioMixVersion, audioTracks.map(function (track) { return track.id; }).join(',')].join(':');
  }

  function notifyAudioPreviewProgress(id) {
    if (project && project.id === id && typeof activeAudioPanelRefresh === 'function') activeAudioPanelRefresh();
  }

  function ensureAudioPreviewBatch(item) {
    if (!item || item.renderStatus !== 'ready' || !item.renderSha256) return null;
    var fingerprint = audioPreviewFingerprint(item);
    var existing = audioPreviewBatches[item.id];
    if (existing && existing.fingerprint === fingerprint) return existing;
    if (existing) releaseAudioPreviewBatch(item.id);
    var batch = {
      fingerprint: fingerprint, total: audioTracks.length, completed: 0, failed: 0,
      urls: {}, errors: {}, building: audioTracks.length > 0, cancelled: false
    };
    audioPreviewBatches[item.id] = batch;
    if (!audioTracks.length) return batch;
    var queue = audioTracks.slice();
    function worker() {
      var track = queue.shift();
      if (!track || batch.cancelled) return Promise.resolve();
      return fetch('/api/editor/' + encodeURIComponent(item.id) + '/audio-preview/' + encodeURIComponent(track.id), {
        method: 'POST', credentials: 'same-origin'
      }).then(function (response) {
        if (!response.ok) return response.json().catch(function () { return {}; }).then(function (body) { throw new Error(body.message || body.error || 'Preview failed'); });
        return response.blob();
      }).then(function (blob) {
        if (batch.cancelled) return;
        batch.urls[track.id] = URL.createObjectURL(blob);
      }).catch(function (error) {
        if (!batch.cancelled) { batch.failed++; batch.errors[track.id] = error.message || 'Preview failed'; }
      }).finally(function () {
        if (batch.cancelled) return;
        batch.completed++;
        batch.building = batch.completed < batch.total;
        notifyAudioPreviewProgress(item.id);
      }).then(worker);
    }
    Promise.all([worker(), worker()]).then(function () {
      if (!batch.cancelled) { batch.building = false; notifyAudioPreviewProgress(item.id); }
    });
    return batch;
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
    if (mode === 'source' && item.renderStatus === 'ready' && saved.explicitSource) explicitSourcePreviews[item.id] = true;
    else delete explicitSourcePreviews[item.id];
    previewModes[item.id] = mode;
    previewSeekTimes[item.id] = mode === 'final' ? sourceToEditedTime(sourceTime, cutsForClient(item), item) : sourceTime;
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
    var insertedSeconds = (item.insertedClips || []).filter(function (clip) { return clip.status === 'ready'; }).reduce(function (sum, clip) { return sum + Number(clip.duration || 0); }, 0);
    return Math.max(0, Number(item.duration || 0) + insertedSeconds - (item.cuts || []).reduce(function (sum, cut) {
      return sum + Number(cut.end - cut.start || 0);
    }, 0));
  }

  function sourceToEditedTime(sourceTime, cuts, item) {
    var removed = 0;
    sourceTime = Math.max(0, Number(sourceTime) || 0);
    (cuts || []).forEach(function (cut) {
      if (sourceTime >= cut.end) removed += cut.end - cut.start;
      else if (sourceTime > cut.start) removed += sourceTime - cut.start;
    });
    var base = Math.max(0, sourceTime - removed);
    var inserted = (item && item.insertedClips || []).filter(function (clip) { return clip.status === 'ready' && Number(clip.afterSourceTime) <= sourceTime + 0.001; })
      .reduce(function (sum, clip) { return sum + Number(clip.duration || 0); }, 0);
    return base + inserted;
  }

  function cameraMotionState(sourceTime, item) {
    var cuts = cutsForClient(item);
    var editedTime = sourceToEditedTime(sourceTime, cuts);
    var resetAt = 0;
    cuts.forEach(function (cut) {
      if (cut.reason !== 'long_pause' && cut.reason !== 'combined') return;
      if (Number(cut.end) - Number(cut.start) < 1.25) return;
      var boundary = sourceToEditedTime(cut.end, cuts);
      if (boundary <= editedTime + 0.001) resetAt = Math.max(resetAt, boundary);
    });
    return {
      elapsed: Math.max(0, editedTime - resetAt),
      duration: (item.effectiveLayout || 'horizontal') === 'horizontal' && resetAt === 0 ? 5 : 3
    };
  }

  function editedToSourceTime(editedTime, item) {
    var target = Math.max(0, Number(editedTime) || 0);
    var insertedBefore = 0;
    var clips = (item.insertedClips || []).filter(function (clip) { return clip.status === 'ready'; }).sort(function (a, b) { return Number(a.afterSourceTime) - Number(b.afterSourceTime); });
    for (var clipIndex = 0; clipIndex < clips.length; clipIndex++) {
      var clipStart = sourceToEditedTime(clips[clipIndex].afterSourceTime, item.cuts || [], null) + insertedBefore;
      var clipEnd = clipStart + Number(clips[clipIndex].duration || 0);
      if (target >= clipStart && target <= clipEnd) return Number(clips[clipIndex].afterSourceTime) || 0;
      if (target > clipEnd) insertedBefore += Number(clips[clipIndex].duration || 0);
    }
    target = Math.max(0, target - insertedBefore);
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
    if (renderWillChange) delete explicitSourcePreviews[id];
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
    if (item.clipInsertStatus === 'queued' || item.clipInsertStatus === 'preparing') return 'Preparing inserted clip';
    if (item.clipInsertStatus === 'error') return 'Inserted clip needs attention';
    if (item.renderRebuildPending && !item.renderStatus) return 'Preparing preview rebuild';
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
    if (item.transcriptionStatus === 'error' || (item.browserPreviewStatus === 'error' && item.renderStatus !== 'ready') || framingFailureIsBlocking(item) || item.retakeAnalysisStatus === 'error' || item.clipInsertStatus === 'error' || item.renderStatus === 'error' || Number(item.unresolvedRetakeCount) > 0 || item.layoutReviewRequired) return 'attention';
    if (item.workflowWarning) return 'warning';
    if (item.renderStatus === 'ready') return 'ready';
    if (['pending', 'running'].indexOf(item.transcriptionStatus) !== -1 || ['pending', 'running'].indexOf(item.browserPreviewStatus) !== -1 || ['pending', 'running'].indexOf(item.classificationStatus) !== -1 || ['pending', 'running', 'pending_transcript'].indexOf(item.retakeAnalysisStatus) !== -1 || ['pending', 'running', 'pending_transcript'].indexOf(item.planningMatchStatus) !== -1 || ['queued', 'preparing'].indexOf(item.clipInsertStatus) !== -1 || ['queued', 'running'].indexOf(item.renderStatus) !== -1 || item.renderRebuildPending) return 'working';
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
      step(frameState, 'Camera orientation', frameState === 'done' ? (Number(item.height) > Number(item.width) ? 'Portrait detected' : 'Landscape detected') : 'Reading recording dimensions') +
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
      projectDetails[body.id] = body;
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

  function loadProjects(expectedMountToken) {
    return Promise.all([
      retryTransientOnce(function () { return api('/api/editor'); }, 300),
      retryTransientOnce(function () { return api('/api/editor/audio-tracks'); }, 300)
    ]).then(function (results) {
      if (expectedMountToken !== mountToken || !editorMounted()) return;
      projects = results[0];
      audioTracks = Array.isArray(results[1].tracks) ? results[1].tracks : [];
      audioMixVersion = results[1].mixVersion || '';
      if (project && !projects.some(function (item) { return item.id === project.id; })) project = null;
      renderList();
      if (project) return openProject(project.id, true);
      if (projects[0]) {
        var preferred = preferredProjectForFilter(listFilter);
        if (preferred) return openProject(preferred.id);
      }
    });
  }

  function openProject(id, quiet) {
    clearTimeout(pollTimer);
    // A poll/render refresh is allowed to update the current recording, but it
    // must never supersede a deliberate card or Next/Previous click. Quiet
    // requests therefore share the current generation and stand down when an
    // explicit navigation is already in flight.
    var quietBlockedByExplicit = !!(quiet && pendingExplicitOpenToken);
    var requestToken = quiet ? openRequestToken : ++openRequestToken;
    if (!quiet) pendingExplicitOpenToken = requestToken;
    return retryTransientOnce(function () { return api('/api/editor/' + encodeURIComponent(id)); }, 300).then(function (item) {
      if (quietBlockedByExplicit || requestToken !== openRequestToken || !editorMounted()) return;
      if (!quiet && pendingExplicitOpenToken === requestToken) pendingExplicitOpenToken = 0;
      var previousProject = project;
      var progressOnly = !!(quiet && previousProject && previousProject.id === item.id && previousProject.renderStatus === 'running' && item.renderStatus === 'running');
      var unchanged = !!(quiet && previousProject && previousProject.id === item.id &&
        String(previousProject.updatedAt || '') === String(item.updatedAt || '') &&
        String(previousProject.renderSha256 || '') === String(item.renderSha256 || '') &&
        Number(previousProject.editRevision || 0) === Number(item.editRevision || 0));
      if (item.renderStatus === 'ready') delete localPreviewRebuilds[item.id];
      project = item;
      projectDetails[item.id] = item;
      restoreReviewProgress(item);
      localStorage.setItem(rememberedProjectKey(item.productionPieceId ? 'sent' : 'active'), item.id);
      projects = projects.map(function (entry) { return entry.id === item.id ? item : entry; });
      selected.clear();
      renderList();
      // Re-entry paints the cached verified project immediately. If the
      // authoritative record is byte-for-byte the same edit, keep that media
      // element alive instead of replacing it with a second loading player.
      if (unchanged) {
        schedulePoll();
        return;
      }
      if (progressOnly) {
        var percent = Math.round(Number(item.renderProgress) || 0);
        var label = root.querySelector('#editorRenderProgressLabel');
        var bar = root.querySelector('#editorRenderProgressBar');
        var button = root.querySelector('#editorRender');
        if (label) label.textContent = 'Encoding final edit · ' + percent + '%';
        if (bar) bar.style.width = Math.max(2, percent) + '%';
        if (button) button.textContent = 'Building final edit… ' + percent + '%';
        var overlayLabel = root.querySelector('#editorPreviewRebuildLabel');
        var overlayBar = root.querySelector('#editorPreviewRebuildBar');
        if (overlayLabel) overlayLabel.textContent = percent >= 99 ? 'Finalising updated preview…' : 'Rebuilding preview… ' + percent + '%';
        if (overlayBar) overlayBar.style.width = Math.max(2, percent) + '%';
        schedulePoll();
        return;
      }
      renderWorkspace();
      schedulePoll();
    }).catch(function (error) {
      if (!quiet && pendingExplicitOpenToken === requestToken) pendingExplicitOpenToken = 0;
      if (quietBlockedByExplicit || requestToken !== openRequestToken) return;
      if (!quiet) alert(error.message);
      else schedulePoll();
    });
  }

  function projectIsActive(item) {
    return !!item && (['pending', 'running'].indexOf(item.transcriptionStatus) !== -1 ||
      ['pending', 'running'].indexOf(item.browserPreviewStatus) !== -1 ||
      ['pending', 'running'].indexOf(item.classificationStatus) !== -1 ||
      ['pending', 'running', 'pending_transcript'].indexOf(item.retakeAnalysisStatus) !== -1 ||
      ['pending', 'running', 'pending_transcript'].indexOf(item.planningMatchStatus) !== -1 ||
      ['queued', 'preparing'].indexOf(item.clipInsertStatus) !== -1 ||
      ['queued', 'running'].indexOf(item.renderStatus) !== -1 || (item.renderRebuildPending && item.renderStatus !== 'error'));
  }

  function projectPollSignature(item) {
    if (!item) return '';
    return [item.transcriptionStatus, item.browserPreviewStatus, item.classificationStatus, item.retakeAnalysisStatus, item.planningMatchStatus,
      item.clipInsertStatus || '', item.renderStatus, Math.round(Number(item.renderProgress) || 0), item.renderRebuildPending ? 'rebuild' : '', item.productionPieceId || '', item.workflowWarning || ''].join('|');
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
    activeAudioPanelRefresh = null;
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
        var retryButton = workspace.querySelector('#editorRetry');
        var retryProjectId = project.id;
        retryButton.disabled = true;
        retryButton.textContent = 'Starting transcription…';
        retryTransientOnce(function () {
          return api('/api/editor/' + retryProjectId + '/transcribe', { method: 'POST' });
        }, 500).then(function () {
          if (!project || project.id !== retryProjectId) return;
          project.transcriptionStatus = 'running'; renderWorkspace(); schedulePoll();
        }).catch(function (error) {
          if (retryButton.isConnected) { retryButton.disabled = false; retryButton.textContent = 'Retry transcription'; }
          alert(error.message);
        });
      };
      return;
    }
    var removed = new Set((project.removedWordIndices || []).map(Number));
    var clipsByWord = {};
    (project.insertedClips || []).forEach(function (clip) { (clipsByWord[clip.afterWordIndex] || (clipsByWord[clip.afterWordIndex] = [])).push(clip); });
    var reviewProjects = visibleProjectsForCurrentFilter();
    var reviewProjectIndex = reviewProjects.findIndex(function (item) { return item.id === project.id; });
    var cutSeconds = Math.max(0, Number(project.duration) - editedDuration(project));
    var layout = project.effectiveLayout || (Number(project.height) > Number(project.width) ? 'vertical' : 'horizontal');
    var automaticEditRunning = ['pending', 'running', 'pending_transcript'].indexOf(project.retakeAnalysisStatus) !== -1 ||
      ['pending', 'running', 'pending_transcript'].indexOf(project.planningMatchStatus) !== -1 || ['queued', 'preparing'].indexOf(project.clipInsertStatus) !== -1;
    var unresolvedRetakes = Number(project.unresolvedRetakeCount) || 0;
    var appliedRetakes = Number(project.appliedRetakeCount) || 0;
    var automaticRetakeIndices = new Set((project.autoRetakeRemovedWordIndices || []).map(Number));
    var automaticCutsPresent = (project.autoSilenceEnabled !== false && (project.gapDecisions || []).some(function (gap) { return !gap.restored; })) || automaticRetakeIndices.size > 0;
    var framingFailureBlocks = framingFailureIsBlocking(project);
    var failedSafetyCheck = project.retakeAnalysisStatus === 'error' || framingFailureBlocks;
    var renderBlocked = automaticEditRunning || failedSafetyCheck || unresolvedRetakes > 0 || project.layoutReviewRequired;
    var renderButtonText = automaticEditRunning ? 'Preparing automatic edit…' : project.retakeAnalysisStatus === 'error' ? 'Retry failed retake check' : framingFailureBlocks ? 'Retry framing or choose a frame' : project.layoutReviewRequired ? 'Confirm Vertical or Horizontal frame' : unresolvedRetakes ? 'Review ' + unresolvedRetakes + ' possible retake' + (unresolvedRetakes === 1 ? '' : 's') : 'Build final edit';
    var rendering = ['queued', 'running'].indexOf(project.renderStatus) !== -1;
    var previewRebuildPending = !!localPreviewRebuilds[project.id] || !!project.renderRebuildPending;
    var previewLocked = rendering || previewRebuildPending;
    var sentToProduction = !!project.productionPieceId;
    var failures = failedSteps(project);
    var previewMode = project.renderStatus === 'ready' && !(previewModes[project.id] === 'source' && explicitSourcePreviews[project.id]) ? 'final' : 'source';
    var previewingWorkingEdit = previewMode === 'source' && project.renderStatus !== 'ready';
    var browserSafeSource = project.browserPreviewRequired && project.browserPreviewStatus === 'ready';
    var sourcePreviewLabel = browserSafeSource ? 'Browser-safe source copy' : 'Original master';
    var previewVersion = previewMode === 'final'
      ? ((project.renderSha256 || project.lastRenderAt || project.updatedAt || '') + '-preview-' + (project.renderPreviewVersion || 0))
      : (browserSafeSource ? project.updatedAt : project.sourceSha256 || project.updatedAt || '');
    var previewUrl = previewMode === 'final'
      ? '/api/editor/' + encodeURIComponent(project.id) + '/render?inline=1&v=' + encodeURIComponent(previewVersion)
      : '/api/editor/' + encodeURIComponent(project.id) + '/source?v=' + encodeURIComponent(previewVersion);
    var previewSeek = Math.max(0, Number(previewSeekTimes[project.id]) || 0);
    var framingReadiness = '<i class="ready">Orientation detected</i>';
    var retakeReadiness = ['pending', 'running', 'pending_transcript'].indexOf(project.retakeAnalysisStatus) !== -1
      ? '<i class="working">Retakes checking</i>'
      : project.retakeAnalysisStatus === 'error' ? '<i class="error">Retake check failed</i>'
        : unresolvedRetakes ? '<i class="review">' + unresolvedRetakes + ' to review</i>'
          : '<i class="ready">' + (appliedRetakes ? appliedRetakes + ' removed · resolved' : 'Retakes resolved') + '</i>';
    var previewActionsHtml = '<div class="editor-preview-actions"><span class="editor-review-keys">Space play/pause · ←/→ 2s</span><label>Review speed<select id="editorReviewRate"' + (previewLocked ? ' disabled' : '') + '><option value="1"' + (reviewRate === 1 ? ' selected' : '') + '>1×</option><option value="1.25"' + (reviewRate === 1.25 ? ' selected' : '') + '>1.25×</option><option value="1.5"' + (reviewRate === 1.5 ? ' selected' : '') + '>1.5×</option><option value="2"' + (reviewRate === 2 ? ' selected' : '') + '>2×</option></select></label>' +
      (project.renderStatus === 'ready' ? '<button type="button" id="editorPreviewFinal" class="' + (previewMode === 'final' ? 'active' : '') + '"' + (previewLocked ? ' disabled' : '') + '>Final edit</button><button type="button" id="editorPreviewSource" class="' + (previewMode === 'source' ? 'active' : '') + '"' + (previewLocked ? ' disabled' : '') + '>' + sourcePreviewLabel + '</button>' : '') + '</div>';
    var automaticControlsHtml = '<div class="editor-controls"><label class="editor-toggle"><input type="checkbox" id="editorAutoSilence" ' + (project.autoSilenceEnabled !== false ? 'checked' : '') + '><span></span>Remove long pauses</label>' +
      '<label class="editor-toggle"><input type="checkbox" id="editorCaptions" ' + (project.captionsEnabled !== false ? 'checked' : '') + '><span></span>Add yellow captions</label>' +
      '<label class="editor-toggle" title="Starts wide, settles to 110%, and repeats after each removed page-turn pause or inserted clip. Horizontal openings use five seconds; every other move uses three."><input type="checkbox" id="editorOpeningPushIn" ' + (project.openingPushInEnabled !== false ? 'checked' : '') + '><span></span>Page-change camera zooms</label>' +
      '<label class="editor-mode">Pacing<select id="editorPacing"><option value="tight"' + (Number(project.silenceThresholdSeconds) < 0.85 ? ' selected' : '') + '>Tight</option><option value="natural"' + (Number(project.silenceThresholdSeconds || 1) >= 0.85 && Number(project.silenceThresholdSeconds || 1) < 1.3 ? ' selected' : '') + '>Natural</option><option value="gentle"' + (Number(project.silenceThresholdSeconds || 1) >= 1.3 ? ' selected' : '') + '>Gentle</option></select></label>' +
      '<button type="button" class="btn-secondary btn-tiny editor-clear-automation" id="editorClearAutomation" ' + (!automaticCutsPresent ? 'disabled' : '') + ' title="Restore every pause and retake removed automatically. Manual transcript cuts stay intact.">Restore automatic cuts</button></div>';
    var selectedAudioExists = project.audioTrackId === '__none__' || audioTracks.some(function (track) { return track.id === project.audioTrackId; });
    var audioSelectionReady = !!project.audioTrackId && selectedAudioExists;
    var audioPanelHtml = '<section class="editor-audio-panel"><div><div class="eyebrow">Backing audio</div><h3>Choose the soundtrack against this edit</h3><span>Every preview uses the saved production loudness settings. Switching tracks restarts the same video from the beginning.</span></div>' +
      '<div class="editor-audio-picker"><button type="button" class="btn-secondary btn-tiny" id="editorAudioPrevious" disabled>← Previous</button><select id="editorAudioTrack" class="stage-select" ' + (project.renderStatus !== 'ready' || sentToProduction || previewLocked ? 'disabled' : '') + '><option value="">Preparing soundtrack previews…</option></select><button type="button" class="btn-secondary btn-tiny" id="editorAudioNext" disabled>Next →</button></div>' +
      '<div class="editor-audio-progress loading" id="editorAudioProgress"><i></i><span>' + (project.renderStatus === 'ready' ? 'Loading audio previews 0/' + audioTracks.length : 'Available when the final edit is ready') + '</span></div><audio id="editorMixedAudio" preload="auto" hidden></audio></section>';
    var rebuildPercent = Math.max(0, Math.min(99, Math.round(Number(project.renderProgress) || 0)));
    var rebuildLabel = project.renderStatus === 'running'
      ? (rebuildPercent >= 99 ? 'Finalising updated preview…' : 'Rebuilding preview… ' + rebuildPercent + '%')
      : project.renderStatus === 'queued'
        ? (Number(project.renderQueuePosition) > 1 ? 'Preview queued · ' + (Number(project.renderQueuePosition) - 1) + ' recording(s) ahead' : 'Preview queued for rebuild…')
        : project.renderStatus === 'error' ? 'Preview rebuild needs attention' : 'Preparing updated preview…';
    var rebuildFailed = project.renderStatus === 'error';
    var rebuildOverlayHtml = previewLocked
      ? '<div class="editor-preview-rebuild' + (rebuildFailed ? ' error' : '') + '" id="editorPreviewRebuild" role="status" aria-live="polite"><div class="editor-preview-rebuild-spinner">' + (rebuildFailed ? '!' : '') + '</div><strong id="editorPreviewRebuildLabel">' + rebuildLabel + '</strong><span>' + (rebuildFailed ? 'Playback remains locked because this file was not regenerated. Use Retry failed steps above.' : 'Your latest edit is being applied. Playback will unlock when the regenerated preview is ready.') + '</span>' + (rebuildFailed ? '' : '<div><i id="editorPreviewRebuildBar" style="width:' + (project.renderStatus === 'running' ? Math.max(2, rebuildPercent) : 4) + '%"></i></div>') + '</div>'
      : '';
    var initialLoadingOverlayHtml = previewLocked ? '' : '<div class="editor-preview-loading" id="editorPreviewLoading" role="status" aria-live="polite"><div></div><strong>Loading preview…</strong></div>';
    var previewPlayerHtml = '<div class="editor-preview' + (previewLocked ? ' rebuilding' : '') + '" id="editorPreview" tabindex="' + (previewLocked ? '-1' : '0') + '" aria-busy="true" aria-label="Video review. Space plays or pauses. Left and right arrows move two seconds."><div class="editor-video-frame ' + layout + '"><video id="editorVideo" data-preview-mode="' + previewMode + '" data-seek-time="' + previewSeek.toFixed(3) + '" playsinline preload="auto" src="' + previewUrl + '"></video>' +
      '<div class="editor-caption" id="editorCaption"></div>' +
      '<div class="editor-player-controls" id="editorPlayerControls"><button type="button" class="editor-player-icon" id="editorPlayerPlay" aria-label="Play" disabled>▶</button><span id="editorPlayerCurrent">0:00</span><input type="range" id="editorPlayerSeek" min="0" max="1" step="0.01" value="0" aria-label="Video position" disabled><span id="editorPlayerDuration">' + formatTime(previewMode === 'final' ? editedDuration(project) : project.duration) + '</span><i id="editorPlayerBuffering" hidden>Loading</i><button type="button" class="editor-player-icon" id="editorPlayerMute" aria-label="Mute" disabled>VOL</button><button type="button" class="editor-player-icon" id="editorPlayerFullscreen" aria-label="Full screen" disabled>⛶</button></div>' +
      '<div class="editor-video-error" id="editorVideoError" hidden><strong>Preview could not be played</strong><span>Your recording and edit are safe. Reload this review copy without rebuilding anything.</span><button type="button" class="btn-secondary btn-tiny" id="editorReloadVideo">Reload preview</button></div>' + initialLoadingOverlayHtml + rebuildOverlayHtml + '</div></div>';
    var previewStageHtml = layout === 'vertical'
      ? '<div class="editor-preview-stage vertical"><aside class="editor-preview-side editor-preview-side-playback"><div class="eyebrow">Playback</div><h3>Review</h3>' + previewActionsHtml + '</aside>' + previewPlayerHtml + '<aside class="editor-preview-side editor-preview-side-settings"><div class="eyebrow">Edit settings</div><h3>Automatic treatment</h3>' + automaticControlsHtml + '</aside></div>'
      : '<div class="editor-preview-stage horizontal">' + previewPlayerHtml + '</div>';
    workspace.innerHTML =
      '<div class="editor-topbar"><div><h2>' + esc(displayName(project)) + '</h2><span>' + (project.planningPieceTitle ? esc(project.name) + ' · ' : '') + formatTime(project.duration) + ' original · ' + formatTime(editedDuration(project)) + ' edited · ' + cutSeconds.toFixed(1) + 's removed' + (formatBytes(project.sizeBytes) ? ' · ' + formatBytes(project.sizeBytes) + ' source' : '') + '</span></div>' +
        '<div class="editor-topbar-actions"><div class="editor-project-nav"><button type="button" class="btn-secondary btn-tiny" id="editorPreviousProject" ' + (reviewProjectIndex <= 0 ? 'disabled' : '') + '>← Previous</button><span id="editorProjectPosition">' + (reviewProjectIndex >= 0 ? (reviewProjectIndex + 1) + ' of ' + reviewProjects.length : '') + '</span><button type="button" class="btn-secondary btn-tiny" id="editorNextProject" ' + (reviewProjectIndex < 0 || reviewProjectIndex >= reviewProjects.length - 1 ? 'disabled' : '') + '>Next →</button></div>' +
          (!sentToProduction && project.renderStatus === 'ready' && !previewLocked ? '<button type="button" class="btn-primary btn-tiny editor-quick-approve" data-editor-approve ' + (!audioSelectionReady ? 'disabled title="Choose backing audio first"' : '') + '>Approve &amp; next</button>' : '') +
          '<span class="editor-save-state ' + esc(saveStates[project.id] || '') + '" id="editorSaveState">' + ({ saving: 'Saving…', saved: 'Saved', error: 'Save failed' }[saveStates[project.id]] || '') + '</span><button class="editor-delete" id="editorDelete">' + (sentToProduction ? 'Remove Editor files' : 'Delete recording') + '</button></div></div>' +
      (previewLocked ? '<div class="editor-lock-notice"><strong>Preview is rebuilding</strong><span>Playback is locked until the updated file has encoded and passed verification.</span></div>' : '') +
      (project.browserPreviewRequired && ['pending', 'running'].indexOf(project.browserPreviewStatus) !== -1 && previewMode === 'source' ? '<div class="editor-lock-notice"><strong>Preparing a browser-safe source preview</strong><span>The camera master is preserved and final editing continues. This view will switch to H.264 automatically when ready.</span></div>' : '') +
      (sentToProduction ? '<div class="editor-lock-notice approved"><strong>Approved version locked</strong><span>The exact reviewed file is now in Content Production. Source and final previews remain available here.</span></div>' : '') +
      (failures.length ? '<div class="editor-error-recovery"><div><strong>' + failures.join(', ') + ' need' + (failures.length === 1 ? 's' : '') + ' attention</strong><span>Retry the failed automatic work without changing the source recording or your edit decisions.</span></div><button type="button" class="btn-secondary btn-tiny" id="editorRetryFailed">Retry failed steps</button></div>' : '') +
      (project.workflowWarning ? '<div class="editor-workflow-warning"><strong>Video workflow needs attention</strong><span>' + esc(project.workflowWarning) + '</span></div>' : '') +
      (layout === 'horizontal' ? '<div class="editor-preview-toolbar">' + previewActionsHtml + '</div>' : '') +
      previewStageHtml +
      audioPanelHtml +
      '<section class="editor-automation"><div class="editor-automation-head"><div><div class="eyebrow">Automatic edit</div><h3>Speech and pause map</h3></div><div class="editor-legend"><span class="speech">Speech</span><span class="cut">Removed pause</span><span class="pause">Kept pause</span></div></div>' + timelineHtml(project) +
        (layout === 'horizontal' ? automaticControlsHtml : '') + '</section>' +
      '<section class="editor-review"><div class="editor-review-column"><div class="editor-section-title"><div><div class="eyebrow">Pause decisions</div><h3>Every automatic silence cut</h3></div><span>Red means removed</span></div><div id="editorGapReview">' + gapReviewHtml(project) + '</div></div>' +
        '<div class="editor-review-column"><div class="editor-section-title"><div><div class="eyebrow">Smart review</div><h3>Possible retakes</h3></div>' +
          (project.retakeAnalysisStatus !== 'ready' && project.retakeAnalysisStatus !== 'pending' && project.retakeAnalysisStatus !== 'running' ? '<button type="button" class="editor-analyze" id="editorAnalyzeRetakes">Analyze retakes</button>' : '<span>Only clear failed takes are automatic</span>') + '</div><div id="editorRetakeReview">' + retakeReviewHtml(project) + '</div></div></section>' +
      '<section class="editor-transcript-panel"><div class="editor-transcript-head"><div><div class="eyebrow">Transcript editor</div><h3>Select words to cut footage</h3></div>' +
        '<div class="editor-transcript-actions"><button class="btn-secondary btn-tiny" id="editorUndo" ' + (!project.canUndoCut ? 'disabled' : '') + '>Undo last decision</button><button class="btn-secondary btn-tiny" id="editorPlaySelection" disabled>Play selected</button>' +
        '<button class="btn-secondary btn-tiny editor-insert-clip" id="editorInsertClip" disabled>Insert clip here</button>' +
        '<button class="btn-secondary btn-tiny" id="editorCorrect" disabled>Correct word</button><button class="btn-secondary btn-tiny" id="editorRestore" disabled>Restore selected</button><button class="btn-primary btn-tiny" id="editorCut" disabled>Cut selected</button></div></div>' +
        '<div class="editor-correction-tray" id="editorCorrectionTray" hidden><div><strong>Correct caption word</strong><span id="editorCorrectionNote">Timing stays exactly where it is.</span><em id="editorCorrectionError" hidden></em></div><input id="editorCorrectionInput" maxlength="40" autocomplete="off" aria-label="Corrected caption word"><div><button type="button" class="btn-secondary btn-tiny" id="editorCorrectionCancel">Cancel</button><button type="button" class="btn-secondary btn-tiny" id="editorCorrectionOriginal" hidden>Use original</button><button type="button" class="btn-primary btn-tiny" id="editorCorrectionSave">Save correction</button></div></div>' +
        '<div class="editor-transcript' + (rendering || sentToProduction ? ' locked' : '') + '" id="editorTranscript" tabindex="0">' + (project.words || []).map(function (word) {
          var markers = (clipsByWord[word.index] || []).map(function (clip) { return '<span class="editor-clip-marker" title="Inserted from ' + esc(clip.sourceUrl || 'planning clip') + '">CLIP</span> '; }).join('');
          return '<span class="editor-word' + (removed.has(word.index) ? ' removed' : '') + (word.originalText ? ' corrected' : '') + '" data-index="' + word.index + '" data-start="' + word.start + '" data-end="' + word.end + '"' + (word.originalText ? ' title="Originally transcribed as: ' + esc(word.originalText) + '"' : '') + '>' + esc(word.text) + '</span> ' + markers;
        }).join('') + '</div>' +
        ((project.insertedClips || []).length ? '<div class="editor-inserted-clips">' + (project.insertedClips || []).map(function (clip) { return '<div><span><strong>' + (clip.status === 'ready' ? 'Inserted clip' : 'Preparing clip…') + '</strong>' + esc(clip.transcriptText || clip.quote || clip.sourceUrl) + '</span><button type="button" class="btn-secondary btn-tiny editor-remove-clip" data-clip-id="' + esc(clip.id) + '" ' + (clip.status !== 'ready' ? 'disabled' : '') + '>Remove</button></div>'; }).join('') + '</div>' : '') +
        (project.clipInsertStatus === 'error' ? '<div class="editor-clip-error">' + esc(project.clipInsertError || 'The clip could not be prepared.') + '</div>' : '') +
        '<p class="editor-selection-hint">Select the word a clip should follow, or drag across words to cut footage. Press Delete to cut, Ctrl/⌘ Z to undo, or Escape to clear.</p></section>' +
      '<div class="editor-export"><div><strong>Next: Content Production</strong><span>' +
        (project.productionPieceId ? 'This edit is ready in Content Production for titles and thumbnail selection.' :
          project.renderStatus === 'ready' ? (audioSelectionReady ? 'Soundtrack selected. Send the finished edit across without uploading it again.' : 'Choose a backing track or No backing music before approval.') :
          'Build the final edit first. Yellow captions will be baked in below center.') + '</span>' +
        '<div class="editor-readiness"><i class="ready">Transcript ready</i>' + framingReadiness + retakeReadiness + (project.renderStatus === 'ready' ? '<i class="ready">Output verified</i>' : '') + (audioSelectionReady ? '<i class="ready">Soundtrack chosen</i>' : '<i class="review">Soundtrack needed</i>') + '</div>' +
        (['queued', 'running'].indexOf(project.renderStatus) !== -1 ? '<div class="editor-render-progress"><span id="editorRenderProgressLabel">' + (project.renderStatus === 'queued' ? (Number(project.renderQueuePosition) > 1 ? (Number(project.renderQueuePosition) - 1) + ' recording(s) ahead in the render queue' : 'Next in the render queue') : 'Encoding final edit · ' + Math.round(Number(project.renderProgress) || 0) + '%') + '</span><div><i id="editorRenderProgressBar" style="width:' + (project.renderStatus === 'queued' ? 4 : Math.max(2, Number(project.renderProgress) || 0)) + '%"></i></div></div>' : '') +
        (project.renderStatus === 'error' ? '<em>' + esc(project.renderError) + '</em>' : '') + '</div><div class="editor-export-actions">' +
        (project.productionPieceId ? '<button class="btn-primary" id="editorOpenProduction">Open Content Production</button>' :
          project.renderStatus === 'ready' ? '<button class="btn-primary" id="editorSendProduction" data-editor-approve ' + (!audioSelectionReady || previewLocked ? 'disabled title="Wait for the updated preview before approval"' : '') + '>Approve &amp; Send to Production</button>' :
          '<button class="btn-primary" id="editorRender" ' + (['queued', 'running'].indexOf(project.renderStatus) !== -1 || renderBlocked ? 'disabled' : '') + '>' + (project.renderStatus === 'queued' ? 'Waiting in render queue…' : project.renderStatus === 'running' ? 'Building final edit… ' + Math.round(Number(project.renderProgress) || 0) + '%' : renderButtonText) + '</button>') +
        '</div></div>';
    bindWorkspace(previewLocked);
    paintSelection();
  }

  function bindWorkspace(previewLocked) {
    var video = root.querySelector('#editorVideo');
    var videoFrame = root.querySelector('.editor-video-frame');
    var videoProjectId = project.id;
    var caption = root.querySelector('#editorCaption');
    var transcript = root.querySelector('#editorTranscript');
    var previewingFinal = video.dataset.previewMode === 'final';
    var previewingOriginalMaster = !previewingFinal && project.renderStatus === 'ready';
    var previewingWorkingEdit = !previewingFinal && project.renderStatus !== 'ready';
    var rendering = ['queued', 'running'].indexOf(project.renderStatus) !== -1;
    var sentToProduction = !!project.productionPieceId;
    var editingLocked = rendering || sentToProduction;
    var playerPlay = root.querySelector('#editorPlayerPlay');
    var playerSeek = root.querySelector('#editorPlayerSeek');
    var playerCurrent = root.querySelector('#editorPlayerCurrent');
    var playerDuration = root.querySelector('#editorPlayerDuration');
    var playerBuffering = root.querySelector('#editorPlayerBuffering');
    var playerMute = root.querySelector('#editorPlayerMute');
    var playerFullscreen = root.querySelector('#editorPlayerFullscreen');
    var playerLoading = root.querySelector('#editorPreviewLoading');
    var playerRoot = root.querySelector('#editorPreview');
    var mixedAudio = root.querySelector('#editorMixedAudio');
    var audioTrackSelect = root.querySelector('#editorAudioTrack');
    var audioPrevious = root.querySelector('#editorAudioPrevious');
    var audioNext = root.querySelector('#editorAudioNext');
    var audioProgress = root.querySelector('#editorAudioProgress');
    var audioBatch = project.renderStatus === 'ready' && !previewLocked ? ensureAudioPreviewBatch(project) : null;
    var playerScrubbing = false;
    var resumeAfterScrub = false;
    var scrubResumeToken = 0;
    var bufferingTimer = null;
    var synchronizedStartToken = 0;
    var synchronizedStartInProgress = false;
    function setInitialPlayerLoading(loading) {
      if (playerLoading) playerLoading.hidden = !loading;
      if (playerRoot) playerRoot.setAttribute('aria-busy', loading || previewLocked ? 'true' : 'false');
      [playerPlay, playerSeek, playerMute, playerFullscreen].forEach(function (control) {
        if (control) control.disabled = !!(loading || previewLocked);
      });
    }
    function activeMixedPreviewUrl() {
      return previewingFinal && project.audioTrackId && project.audioTrackId !== '__none__' && audioBatch && audioBatch.urls[project.audioTrackId] || '';
    }
    function mixedPreviewActive() {
      return !!(mixedAudio && mixedAudio.src && activeMixedPreviewUrl());
    }
    function playerIsMuted() {
      return mixedPreviewActive() ? mixedAudio.muted : video.muted;
    }
    function startPlayerPlayback() {
      if (previewLocked || video.readyState < 2) return Promise.resolve();
      if (!mixedPreviewActive()) return video.play().catch(function () {});
      // Audio can need a few milliseconds longer than the lightweight video
      // proxy to wake its decoder. Make audio the start clock: hold the
      // picture, start audible playback from the shared timestamp, then
      // release the muted picture at audio's actual position.
      var token = ++synchronizedStartToken;
      var target = Math.max(0, Number(video.currentTime) || 0);
      synchronizedStartInProgress = true;
      video.pause();
      mixedAudio.pause();
      try { video.currentTime = target; mixedAudio.currentTime = target; } catch (error) {}
      showBufferingSoon();
      return mixedAudio.play().then(function () {
        // A newer synchronized start owns the shared audio element now. An
        // older play promise must not pause that newer playback when it settles.
        if (token !== synchronizedStartToken) return;
        if (!mixedPreviewActive()) {
          mixedAudio.pause();
          return;
        }
        try { video.currentTime = mixedAudio.currentTime || target; } catch (error) {}
        return video.play();
      }).catch(function () {
        video.pause();
        mixedAudio.pause();
      }).finally(function () {
        if (token === synchronizedStartToken) synchronizedStartInProgress = false;
      });
    }
    function pausePlayerPlayback() {
      synchronizedStartToken++;
      synchronizedStartInProgress = false;
      video.pause();
      if (mixedAudio) mixedAudio.pause();
    }
    function togglePlayerPlayback() {
      if (video.paused) startPlayerPlayback(); else pausePlayerPlayback();
    }
    function configureSelectedAudio(restart, playNow) {
      var url = activeMixedPreviewUrl();
      if (!url) {
        if (mixedAudio) { mixedAudio.pause(); mixedAudio.removeAttribute('src'); mixedAudio.load(); }
        video.muted = false;
        if (restart) video.currentTime = 0;
        if (playNow) startPlayerPlayback();
        return;
      }
      var sourceChanged = mixedAudio.src !== url;
      if (sourceChanged) mixedAudio.src = url;
      mixedAudio.playbackRate = reviewRate;
      if (restart) video.currentTime = 0;
      try { mixedAudio.currentTime = video.currentTime || 0; } catch (error) {}
      // The selected soundtrack may finish preloading after the user has
      // already started the video. Join it to the running picture without
      // pausing that picture; only mute the video's own audio after the mixed
      // track really starts. If the browser blocks the asynchronous audio
      // start, dialogue playback continues and the next explicit Play click
      // can start the synchronized mix under a fresh user gesture.
      if (playNow && sourceChanged && !restart && !video.paused) {
        var handoffUrl = url;
        mixedAudio.play().then(function () {
          if (video.paused || activeMixedPreviewUrl() !== handoffUrl) {
            mixedAudio.pause();
            return;
          }
          if (Math.abs((mixedAudio.currentTime || 0) - (video.currentTime || 0)) > 0.15) mixedAudio.currentTime = video.currentTime || 0;
          video.muted = true;
          syncPlayerControls();
        }).catch(function () {
          video.muted = false;
          syncPlayerControls();
        });
        return;
      }
      video.muted = true;
      // paintAudioPanel runs once for every soundtrack that finishes
      // preloading. Only the selected soundtrack becoming available should
      // restart an in-progress preview; unrelated completions must be inert.
      if (playNow && (sourceChanged || restart)) startPlayerPlayback();
    }
    function readyAudioTracks() {
      return audioTracks.filter(function (track) { return audioBatch && audioBatch.urls[track.id]; });
    }
    function paintAudioPanel() {
      if (!audioTrackSelect || !audioProgress) return;
      if (!project || project.id !== videoProjectId || !audioTrackSelect.isConnected) return;
      var sent = !!project.productionPieceId;
      var ready = readyAudioTracks();
      var options = [];
      if (!project.audioTrackId) options.push('<option value="">Choose backing audio</option>');
      options.push('<option value="__none__">No backing music</option>');
      ready.forEach(function (track) { options.push('<option value="' + esc(track.id) + '" title="' + esc(track.note || '') + '">' + esc(track.name) + '</option>'); });
      if (project.audioTrackId && project.audioTrackId !== '__none__' && !ready.some(function (track) { return track.id === project.audioTrackId; })) {
        var pendingTrack = audioTracks.find(function (track) { return track.id === project.audioTrackId; });
        options.push('<option value="' + esc(project.audioTrackId) + '" disabled>' + esc(pendingTrack ? pendingTrack.name + ' · preparing…' : 'Selected track unavailable') + '</option>');
      }
      audioTrackSelect.innerHTML = options.join('');
      audioTrackSelect.value = project.audioTrackId || '';
      if (previewLocked) {
        audioTrackSelect.disabled = true;
        audioProgress.className = 'editor-audio-progress loading';
        audioProgress.querySelector('span').textContent = 'Available when the updated preview is ready';
      } else if (project.renderStatus !== 'ready') {
        audioTrackSelect.disabled = true;
        audioProgress.className = 'editor-audio-progress';
        audioProgress.querySelector('span').textContent = 'Available when the final edit is ready';
      } else if (!audioTracks.length) {
        audioTrackSelect.disabled = sent;
        audioProgress.className = 'editor-audio-progress';
        audioProgress.querySelector('span').textContent = 'No backing tracks are currently in the library';
      } else if (audioBatch && audioBatch.building) {
        audioTrackSelect.disabled = true;
        audioProgress.className = 'editor-audio-progress loading';
        audioProgress.querySelector('span').textContent = 'Loading audio previews ' + audioBatch.completed + '/' + audioBatch.total;
      } else {
        audioTrackSelect.disabled = sent;
        audioProgress.className = 'editor-audio-progress ready';
        audioProgress.querySelector('span').textContent = ready.length + ' soundtrack preview' + (ready.length === 1 ? '' : 's') + ' ready' + (audioBatch && audioBatch.failed ? ' · ' + audioBatch.failed + ' failed' : '') + '. Switching is instant.';
      }
      var currentIndex = ready.findIndex(function (track) { return track.id === project.audioTrackId; });
      audioPrevious.disabled = sent || previewLocked || ready.length < 2 || currentIndex < 0;
      audioNext.disabled = sent || previewLocked || ready.length < 2 || currentIndex < 0;
      configureSelectedAudio(false, !video.paused);
      syncPlayerControls();
    }
    activeAudioPanelRefresh = paintAudioPanel;
    paintAudioPanel();
    function selectReadyTrack(offset) {
      var ready = readyAudioTracks();
      if (!ready.length) return;
      var index = ready.findIndex(function (track) { return track.id === project.audioTrackId; });
      index = index < 0 ? 0 : (index + offset + ready.length) % ready.length;
      audioTrackSelect.value = ready[index].id;
      audioTrackSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (audioPrevious) audioPrevious.onclick = function () { selectReadyTrack(-1); };
    if (audioNext) audioNext.onclick = function () { selectReadyTrack(1); };
    if (audioTrackSelect) audioTrackSelect.onchange = function () {
      var selectedTrackId = audioTrackSelect.value;
      if (!selectedTrackId) return;
      project.audioTrackId = selectedTrackId;
      if (!previewingFinal && selectedTrackId !== '__none__') {
        save({ audioTrackId: selectedTrackId }, { skipWorkspaceRender: true });
        previewModes[project.id] = 'final';
        delete explicitSourcePreviews[project.id];
        previewSeekTimes[project.id] = 0;
        renderWorkspace();
        return;
      }
      configureSelectedAudio(true, true);
      paintAudioPanel();
      save({ audioTrackId: selectedTrackId }, { skipWorkspaceRender: true });
    };
    function syncPlayerControls() {
      var duration = Number(video.duration) || Number(previewingFinal ? project.editedDuration : project.duration) || 0;
      if (playerSeek) {
        playerSeek.max = Math.max(0.01, duration);
        if (!playerScrubbing) playerSeek.value = Math.min(duration, Number(video.currentTime) || 0);
        var played = duration ? Math.max(0, Math.min(100, Number(video.currentTime) / duration * 100)) : 0;
        playerSeek.style.setProperty('--editor-played', played.toFixed(3) + '%');
      }
      if (playerCurrent) playerCurrent.textContent = formatTime(video.currentTime || 0);
      if (playerDuration) playerDuration.textContent = formatTime(duration);
      if (playerPlay) {
        playerPlay.textContent = video.paused ? '▶' : '❚❚';
        playerPlay.setAttribute('aria-label', video.paused ? 'Play' : 'Pause');
      }
      if (playerMute) {
        var muted = playerIsMuted();
        playerMute.textContent = muted ? 'MUTED' : 'VOL';
        playerMute.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
      }
    }
    function hideBuffering() {
      if (bufferingTimer) clearTimeout(bufferingTimer);
      bufferingTimer = null;
      if (playerBuffering) playerBuffering.hidden = true;
    }
    function showBufferingSoon() {
      if (!playerBuffering || bufferingTimer) return;
      bufferingTimer = setTimeout(function () {
        bufferingTimer = null;
        if (!video.paused && (video.readyState < 3 || (mixedPreviewActive() && mixedAudio.readyState < 3))) playerBuffering.hidden = false;
      }, 160);
    }
    if (playerPlay) playerPlay.onclick = function () {
      togglePlayerPlayback();
    };
    if (playerSeek) {
      function beginScrub() {
        if (playerScrubbing) return;
        playerScrubbing = true;
        resumeAfterScrub = !video.paused;
        scrubResumeToken++;
        pausePlayerPlayback();
        hideBuffering();
      }
      function moveScrubPlayhead() {
        var target = Math.max(0, Math.min(Number(video.duration) || Infinity, Number(playerSeek.value) || 0));
        try { video.currentTime = target; } catch (error) {}
        if (mixedPreviewActive()) {
          mixedAudio.pause();
          try { mixedAudio.currentTime = target; } catch (error) {}
        }
        if (playerCurrent) playerCurrent.textContent = formatTime(target);
        var duration = Number(video.duration) || 0;
        var played = duration ? target / duration * 100 : 0;
        playerSeek.style.setProperty('--editor-played', played.toFixed(3) + '%');
      }
      function finishScrub() {
        if (!playerScrubbing) return;
        playerScrubbing = false;
        moveScrubPlayhead();
        var shouldResume = resumeAfterScrub;
        resumeAfterScrub = false;
        var token = ++scrubResumeToken;
        function resumeWhenReady() {
          if (token !== scrubResumeToken || !shouldResume || playerScrubbing) return;
          startPlayerPlayback();
        }
        // Seeking against the dense-keyframe review proxy normally resolves
        // immediately. When the media element still has a pending decode,
        // wait silently with both clocks paused rather than allowing the old
        // soundtrack position to keep playing under a stalled picture.
        if (video.seeking || video.readyState < 2) video.addEventListener('seeked', resumeWhenReady, { once: true });
        else resumeWhenReady();
        syncPlayerControls();
      }
      playerSeek.addEventListener('pointerdown', beginScrub);
      playerSeek.addEventListener('input', function () {
        beginScrub();
        moveScrubPlayhead();
      });
      ['pointerup', 'pointercancel', 'change'].forEach(function (name) {
        playerSeek.addEventListener(name, finishScrub);
      });
    }
    if (playerMute) playerMute.onclick = function () {
      if (mixedPreviewActive()) mixedAudio.muted = !mixedAudio.muted;
      else video.muted = !video.muted;
      syncPlayerControls();
    };
    if (playerFullscreen) playerFullscreen.onclick = function () {
      if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
      else if (videoFrame.requestFullscreen) videoFrame.requestFullscreen().catch(function () {});
    };
    video.addEventListener('click', function () {
      togglePlayerPlayback();
    });
    video.addEventListener('waiting', showBufferingSoon);
    video.addEventListener('stalled', showBufferingSoon);
    video.addEventListener('playing', hideBuffering);
    video.addEventListener('canplay', hideBuffering);
    video.addEventListener('durationchange', syncPlayerControls);
    video.addEventListener('volumechange', syncPlayerControls);
    if (mixedAudio) {
      mixedAudio.addEventListener('volumechange', syncPlayerControls);
      mixedAudio.addEventListener('waiting', showBufferingSoon);
      mixedAudio.addEventListener('stalled', showBufferingSoon);
      mixedAudio.addEventListener('playing', hideBuffering);
      mixedAudio.addEventListener('canplay', hideBuffering);
      mixedAudio.addEventListener('ended', function () { video.pause(); });
    }
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
      setInitialPlayerLoading(false);
      if (videoError) videoError.hidden = true;
      if (mediaRecoveryChecks[videoProjectId]) clearTimeout(mediaRecoveryChecks[videoProjectId]);
      delete mediaRecoveryChecks[videoProjectId];
      updatePreviewMotion(previewingFinal ? editedToSourceTime(video.currentTime, project) : video.currentTime);
      syncPlayerControls();
    });
    video.addEventListener('error', function () {
      setInitialPlayerLoading(false);
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
      setInitialPlayerLoading(true);
      video.src = retryUrl.pathname + retryUrl.search;
      video.load();
      if (wasPlaying) video.addEventListener('loadeddata', function () { startPlayerPlayback(); }, { once: true });
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
          startPlayerPlayback();
        }
      };
      if (video.readyState >= 1) resumePreview(); else video.addEventListener('loadedmetadata', resumePreview, { once: true });
    }
    if (video.readyState >= 2) setInitialPlayerLoading(false);
    var lastClicked = null;
    var ignoreNextClick = false;
    var playingWordIndex = null;
    var lastReviewProgressSaveAt = 0;
    function isLongformVideo() {
      return (project.effectiveLayout || 'horizontal') === 'horizontal';
    }
    var motionAnimationFrame = null;
    function updatePreviewMotion(sourcePlayheadTime) {
      var openingScale = 1;
      if (previewingWorkingEdit && project.openingPushInEnabled !== false) {
        var motion = cameraMotionState(sourcePlayheadTime, project);
        var openingProgress = Math.max(0, Math.min(1, motion.elapsed / motion.duration));
        openingScale = 1 + 0.10 * openingProgress * openingProgress * (3 - 2 * openingProgress);
      }
      var width = video.clientWidth || 0;
      var height = video.clientHeight || 0;
      var offsetX = width * (1 - openingScale) / 2;
      var offsetY = height * (1 - openingScale) / 2;
      video.style.transform = openingScale > 1.0001 ? 'matrix(' + openingScale.toFixed(5) + ',0,0,' + openingScale.toFixed(5) + ',' + offsetX.toFixed(3) + ',' + offsetY.toFixed(3) + ')' : '';
      video.style.transformOrigin = '0 0';
    }
    function animatePreviewMotion() {
      if (!video.isConnected || !project || project.id !== videoProjectId) {
        motionAnimationFrame = null;
        return;
      }
      updatePreviewMotion(previewingFinal ? editedToSourceTime(video.currentTime, project) : video.currentTime);
      syncPlayerControls();
      if (!video.paused && !video.ended) motionAnimationFrame = requestAnimationFrame(animatePreviewMotion);
      else motionAnimationFrame = null;
    }
    video.addEventListener('play', function () {
      hideBuffering();
      if (mixedPreviewActive()) {
        // Route any remaining internal direct-play call through the same
        // audio-first gate instead of allowing the picture to escape early.
        if (mixedAudio.paused && !synchronizedStartInProgress) {
          video.pause();
          startPlayerPlayback();
          return;
        }
        if (Math.abs((mixedAudio.currentTime || 0) - (video.currentTime || 0)) > 0.15) mixedAudio.currentTime = video.currentTime || 0;
        if (mixedAudio.paused) mixedAudio.play().catch(function () { video.pause(); });
      }
      syncPlayerControls();
      if (motionAnimationFrame === null) motionAnimationFrame = requestAnimationFrame(animatePreviewMotion);
    });
    video.addEventListener('pause', function () {
      if (mixedPreviewActive()) mixedAudio.pause();
      if (motionAnimationFrame !== null) cancelAnimationFrame(motionAnimationFrame);
      motionAnimationFrame = null;
      updatePreviewMotion(previewingFinal ? editedToSourceTime(video.currentTime, project) : video.currentTime);
      syncPlayerControls();
    });
    video.addEventListener('seeked', function () {
      if (mixedPreviewActive()) {
        try { mixedAudio.currentTime = video.currentTime || 0; } catch (error) {}
      }
      updatePreviewMotion(previewingFinal ? editedToSourceTime(video.currentTime, project) : video.currentTime);
    });
    video.addEventListener('timeupdate', function () {
      if (mixedPreviewActive() && !video.paused && Math.abs((mixedAudio.currentTime || 0) - (video.currentTime || 0)) > 0.25) {
        try { mixedAudio.currentTime = video.currentTime || 0; } catch (error) {}
      }
      if (Number.isFinite(previewStopTimes[project.id]) && video.currentTime >= previewStopTimes[project.id]) {
        video.pause();
        delete previewStopTimes[project.id];
      }
      var sourcePlayheadTime = previewingFinal ? editedToSourceTime(video.currentTime, project) : video.currentTime;
      updatePreviewMotion(sourcePlayheadTime);
      syncPlayerControls();
      var now = Date.now();
      if (sourcePlayheadTime >= 1 && now - lastReviewProgressSaveAt >= 500) {
        lastReviewProgressSaveAt = now;
        try {
          sessionStorage.setItem(reviewProgressKey(videoProjectId), JSON.stringify({
            sourceTime: sourcePlayheadTime,
            mode: previewingFinal ? 'final' : 'source',
            explicitSource: !previewingFinal && !!explicitSourcePreviews[videoProjectId]
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
      if (previewingFinal || previewingOriginalMaster) {
        caption.classList.remove('visible');
        return;
      }
      if (!previewingOriginalMaster) {
        var cut = (project.cuts || []).filter(function (item) { return video.currentTime >= item.start && video.currentTime < item.end; })[0];
        if (cut && cut.end < video.duration - 0.02) { video.currentTime = cut.end + 0.01; return; }
        if (cut) {
          // A trailing cut has no retained timestamp to jump into. Stop on the
          // final kept frame rather than playing silence absent from the render.
          video.pause();
          video.currentTime = Math.max(0, cut.start - 0.01);
          return;
        }
      }
      var group = (project.captionGroups || []).filter(function (item) {
        return video.currentTime >= item.sourceStart && video.currentTime <= item.sourceEnd;
      })[0];
      caption.replaceChildren();
      caption.style.removeProperty('font-size');
      var isLongform = isLongformVideo();
      caption.classList.toggle('longform', isLongform);
      caption.classList.toggle('shortform', !isLongform);
      if (group && Array.isArray(group.words) && isLongform) {
        var phraseCharacters = Array.from(String(group.text || '')).length;
        var phraseScale = Math.max(0.65, Math.min(1, 50 / Math.max(50, phraseCharacters)));
        if (phraseScale < 1) caption.style.fontSize = (2.7 * phraseScale).toFixed(2) + 'cqw';
        group.words.forEach(function (word, index) {
          var span = document.createElement('span');
          span.textContent = word.text + (index + 1 < group.words.length ? ' ' : '');
          var emphasisEnd = index + 1 < group.words.length ? group.words[index + 1].sourceStart : group.sourceEnd;
          span.className = video.currentTime >= word.sourceStart && video.currentTime < emphasisEnd ? 'active' : '';
          caption.appendChild(span);
        });
      } else if (group && Array.isArray(group.words)) {
        var spokenWord = group.words.filter(function (word, index) {
          var wordEnd = index + 1 < group.words.length ? group.words[index + 1].sourceStart : group.sourceEnd;
          return video.currentTime >= word.sourceStart && video.currentTime < wordEnd;
        })[0];
        caption.textContent = spokenWord ? spokenWord.text : '';
        if (spokenWord) {
          var characters = Array.from(String(spokenWord.text || '')).length;
          caption.style.fontSize = (Math.max(3, Math.min(8, 8 * 15 / Math.max(15, characters)))).toFixed(2) + 'cqw';
        }
      } else if (group) caption.textContent = group.text;
      caption.classList.toggle('visible', !!group && project.captionsEnabled !== false);
    });
    video.addEventListener('ended', function () { clearReviewProgress(videoProjectId); syncPlayerControls(); });
    root.querySelectorAll('.editor-timeline-segment').forEach(function (segment) {
      segment.onclick = function () {
        if (previewLocked) return;
        var sourceTime = Number(segment.dataset.time) || 0;
        video.currentTime = previewingFinal ? sourceToEditedTime(sourceTime, project.cuts, project) : sourceTime;
        startPlayerPlayback();
      };
    });
    root.querySelectorAll('.editor-preview-cut').forEach(function (button) {
      button.onclick = function () {
        if (previewLocked) return;
        var time = Number(button.dataset.time) || 0;
        if (project.renderStatus === 'ready' && !previewingFinal) {
          previewModes[project.id] = 'final';
          previewSeekTimes[project.id] = sourceToEditedTime(time, project.cuts, project);
          previewAutoplay[project.id] = true;
          renderWorkspace();
          var replacementVideo = root.querySelector('#editorVideo');
          if (replacementVideo) replacementVideo.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
        var previewTime = previewingFinal ? sourceToEditedTime(time, project.cuts, project) : time;
        var start = function () { video.currentTime = previewTime; startPlayerPlayback(); video.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
        if (video.readyState >= 1) start(); else video.addEventListener('loadedmetadata', start, { once: true });
      };
    });
    var finalPreviewButton = root.querySelector('#editorPreviewFinal');
    if (finalPreviewButton) finalPreviewButton.onclick = function () {
      previewSeekTimes[project.id] = previewingFinal ? video.currentTime : sourceToEditedTime(video.currentTime, project.cuts, project);
      delete explicitSourcePreviews[project.id];
      previewModes[project.id] = 'final'; renderWorkspace();
    };
    var sourcePreviewButton = root.querySelector('#editorPreviewSource');
    if (sourcePreviewButton) sourcePreviewButton.onclick = function () {
      previewSeekTimes[project.id] = previewingFinal ? editedToSourceTime(video.currentTime, project) : video.currentTime;
      explicitSourcePreviews[project.id] = true;
      previewModes[project.id] = 'source'; renderWorkspace();
    };
    root.querySelector('#editorReviewRate').onchange = function () {
      reviewRate = Number(this.value) || 1;
      localStorage.setItem('rmEditorReviewRate', String(reviewRate));
      video.playbackRate = reviewRate;
      if (mixedAudio) mixedAudio.playbackRate = reviewRate;
    };
    root.querySelector('#editorPreview').addEventListener('keydown', function (event) {
      if (previewLocked || video.readyState < 2) return;
      if (event.target.closest('select, button, input')) return;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlayerPlayback();
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
      startPlayerPlayback();
      video.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    root.querySelector('#editorCorrect').onclick = correctSelectedWord;
    root.querySelector('#editorInsertClip').onclick = function () {
      if (selected.size !== 1 || !project) return;
      var insertProjectId = project.id;
      var afterWordIndex = Number(Array.from(selected)[0]);
      var button = root.querySelector('#editorInsertClip');
      button.disabled = true; button.textContent = 'Matching & preparing…';
      rememberPlaybackBeforeEdit(insertProjectId, true); releaseAudioPreviewBatch(insertProjectId); localPreviewRebuilds[insertProjectId] = true;
      project.clipInsertStatus = 'queued'; project.clipInsertError = '';
      projects = projects.map(function (entry) { return entry.id === insertProjectId ? Object.assign({}, entry, { clipInsertStatus: 'queued', clipInsertError: '' }) : entry; });
      selected.clear(); renderWorkspace(); schedulePoll();
      api('/api/editor/' + encodeURIComponent(insertProjectId) + '/insert-clip', { method: 'POST', body: JSON.stringify({ afterWordIndex: afterWordIndex }) }).catch(function (error) {
        delete localPreviewRebuilds[insertProjectId];
        if (project && project.id === insertProjectId) { project.clipInsertStatus = 'error'; project.clipInsertError = error.message; renderWorkspace(); }
        alert(error.message);
      });
    };
    root.querySelectorAll('.editor-remove-clip').forEach(function (button) {
      button.onclick = function () {
        var id = project.id; var clipId = button.dataset.clipId;
        rememberPlaybackBeforeEdit(id, true); localPreviewRebuilds[id] = true; renderWorkspace();
        api('/api/editor/' + encodeURIComponent(id) + '/inserted-clips/' + encodeURIComponent(clipId), { method: 'DELETE' }).then(function (item) {
          if (!project || project.id !== id) return;
          project = item; projectDetails[id] = item; projects = projects.map(function (entry) { return entry.id === id ? item : entry; }); renderList(); renderWorkspace(); schedulePoll();
        }).catch(function (error) { delete localPreviewRebuilds[id]; alert(error.message); openProject(id, true); });
      };
    });
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
    var openingPushIn = root.querySelector('#editorOpeningPushIn');
    if (openingPushIn) openingPushIn.onchange = function () { save({ openingPushInEnabled: this.checked }, true); };
    var analyzeButton = root.querySelector('#editorAnalyze');
    if (analyzeButton) analyzeButton.onclick = function () {
      var analyzeProjectId = project.id;
      analyzeButton.disabled = true;
      analyzeButton.textContent = 'Analyzing…';
      retryTransientOnce(function () {
        return api('/api/editor/' + analyzeProjectId + '/classify', { method: 'POST' });
      }, 500).then(function () {
        if (!project || project.id !== analyzeProjectId) return;
        project.classificationStatus = 'running'; renderWorkspace(); schedulePoll();
      }).catch(function (error) { alert(error.message); renderWorkspace(); });
    };
    var retakeAnalyzeButton = root.querySelector('#editorAnalyzeRetakes');
    if (retakeAnalyzeButton) retakeAnalyzeButton.onclick = function () {
      var analyzeProjectId = project.id;
      retakeAnalyzeButton.disabled = true;
      retakeAnalyzeButton.textContent = 'Analyzing…';
      retryTransientOnce(function () {
        return api('/api/editor/' + analyzeProjectId + '/analyze-retakes', { method: 'POST' });
      }, 500).then(function () {
        if (!project || project.id !== analyzeProjectId) return;
        project.retakeAnalysisStatus = 'running'; renderWorkspace(); schedulePoll();
      }).catch(function (error) { alert(error.message); renderWorkspace(); });
    };
    root.querySelector('#editorPacing').onchange = function () {
      var settings = { tight: [0.7, 0.22], natural: [1, 0.38], gentle: [1.5, 0.55] }[this.value] || [1, 0.38];
      save({ silenceThresholdSeconds: settings[0], retainedPauseSeconds: settings[1] }, true);
    };
    var clearAutomation = root.querySelector('#editorClearAutomation');
    if (clearAutomation) clearAutomation.onclick = function () {
      save(function (latest) {
        var owned = new Set((latest.autoRetakeRemovedWordIndices || []).map(Number));
        var dismissed = new Set((latest.dismissedRetakeIds || []).map(String));
        (latest.retakeCandidates || []).forEach(function (candidate) {
          if (candidate.removeWordIndices && candidate.removeWordIndices.length && candidate.removeWordIndices.every(function (index) { return owned.has(Number(index)); })) dismissed.add(candidate.id);
        });
        return {
          autoSilenceEnabled: false,
          removedWordIndices: (latest.removedWordIndices || []).map(Number).filter(function (index) { return !owned.has(index); }),
          dismissedRetakeIds: Array.from(dismissed)
        };
      }, true).then(function (item) {
        if (!item) return;
        editorNotice = 'Automatic pause and retake cuts were restored. Manual transcript cuts were preserved, and Undo is available.';
        renderNotice();
      });
    };
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
        var renderProjectId = project.id;
        renderButton.disabled = true;
        renderButton.textContent = 'Starting final edit…';
        retryTransientOnce(function () {
          return api('/api/editor/' + renderProjectId + '/render', { method: 'POST' });
        }, 500).then(function () {
          if (!project || project.id !== renderProjectId) return;
          project.renderStatus = 'running'; renderWorkspace(); schedulePoll();
        }).catch(function (error) {
          if (renderButton.isConnected) { renderButton.disabled = false; renderButton.textContent = 'Build final edit'; }
          alert(error.message);
        });
      };
    var retryFailedButton = root.querySelector('#editorRetryFailed');
    if (retryFailedButton) retryFailedButton.onclick = function () {
      var retryProjectId = project.id;
      retryFailedButton.disabled = true;
      retryFailedButton.textContent = 'Retrying…';
      api('/api/editor/' + retryProjectId + '/retry-failed', { method: 'POST' }).then(function () {
        if (project && project.id === retryProjectId) return openProject(retryProjectId, true);
      }).catch(function (error) { retryFailedButton.disabled = false; retryFailedButton.textContent = 'Retry failed steps'; alert(error.message); });
    };
    var approveButtons = Array.from(root.querySelectorAll('[data-editor-approve]'));
    function approveCurrentProject() {
      if (previewLocked) return;
      var approvedId = project.id;
      var approvedName = project.name;
      approveButtons.forEach(function (button) { button.disabled = true; button.textContent = 'Approving…'; });
      retryTransientOnce(function () {
        return api('/api/editor/' + approvedId + '/production', { method: 'POST' });
      }, 500).then(function (result) {
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
      var deleteButton = root.querySelector('#editorDelete');
      if (deleteButton) { deleteButton.disabled = true; deleteButton.textContent = 'Deleting…'; }
      api('/api/editor/' + id, { method: 'DELETE' }).then(function () {
        clearTimeout(renderRefreshTimers[id]); delete renderRefreshTimers[id];
        ['active', 'sent'].forEach(function (filter) {
          var key = rememberedProjectKey(filter);
          if (localStorage.getItem(key) === id) localStorage.removeItem(key);
        });
        projects = projects.filter(function (item) { return item.id !== id; });
        delete projectDetails[id];
        delete localPreviewRebuilds[id];
        delete explicitSourcePreviews[id];
        clearReviewProgress(id);
        project = null; selected.clear(); renderList();
        var workspace = root && root.querySelector('#editorWorkspace');
        if (workspace) workspace.innerHTML = '<div class="editor-empty"><strong>Recording deleted</strong><span>Select another recording or upload a new one.</span></div>';
        var next = listFilter === 'active' ? nextActionableProject() : projects.filter(function (item) { return !!item.productionPieceId; })[0];
        if (next && editorMounted()) openProject(next.id);
      }).catch(function (error) {
        if (deleteButton && deleteButton.isConnected) {
          deleteButton.disabled = false;
          deleteButton.textContent = project && project.productionPieceId ? 'Remove Editor files' : 'Delete recording';
        }
        alert('The recording was not deleted. ' + error.message);
      });
    };
    if (editingLocked) {
      ['#editorAnalyze', '#editorAutoSilence', '#editorCaptions', '#editorOpeningPushIn', '#editorClearAutomation', '#editorPacing', '#editorAnalyzeRetakes', '#editorUndo', '#editorCorrect', '#editorRestore', '#editorCut'].forEach(function (selector) {
        var control = root.querySelector(selector); if (control) control.disabled = true;
      });
      root.querySelectorAll('.editor-gap-toggle,.editor-retake-apply,.editor-retake-dismiss').forEach(function (control) { control.disabled = true; });
    }
    if (previewLocked) {
      root.querySelectorAll('.editor-timeline-segment,.editor-preview-cut,#editorPlaySelection').forEach(function (control) { control.disabled = true; });
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
    root.querySelector('#editorInsertClip').disabled = locked || selected.size !== 1 || ['queued', 'preparing'].indexOf(project.clipInsertStatus) !== -1;
    var previewLocked = project && (!!localPreviewRebuilds[project.id] || !!project.renderRebuildPending || ['queued', 'running'].indexOf(project.renderStatus) !== -1);
    root.querySelector('#editorPlaySelection').disabled = previewLocked || selected.size === 0;
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
    var undoStartedPreviewRebuild = project.renderStatus === 'ready' || project.renderRebuildPending;
    if (undoStartedPreviewRebuild) {
      localPreviewRebuilds[project.id] = true;
      renderWorkspace();
    }
    selected.clear();
    var mutationId = window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : 'undo-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    queueProjectUpdate(project.id, function (id) {
      var latest = project && project.id === id ? project : projectDetails[id] || projects.find(function (item) { return item.id === id; });
      var payload = { expectedEditRevision: Number(latest && latest.editRevision) || 0, mutationId: mutationId };
      function send(canRetryTransport) {
        return api('/api/editor/' + id + '/undo-cut', { method: 'POST', body: JSON.stringify(payload) }).catch(function (error) {
          var transient = !error.status || error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
          if (!canRetryTransport || !transient) throw error;
          return new Promise(function (resolve) { setTimeout(resolve, 350); }).then(function () { return send(false); });
        });
      }
      return send(true).catch(function (error) {
        if (error.code !== 'edit_conflict') throw error;
        return api('/api/editor/' + id).then(function (fresh) {
          projects = projects.map(function (entry) { return entry.id === id ? fresh : entry; });
          if (project && project.id === id) { project = fresh; renderWorkspace(); }
          throw error;
        });
      });
    }, { previewRebuildStarted: undoStartedPreviewRebuild });
  }

  function queueProjectUpdate(id, operation, options) {
    options = options || {};
    saveStates[id] = 'saving';
    var stateNode = root.querySelector('#editorSaveState');
    if (stateNode && project && project.id === id) { stateNode.className = 'editor-save-state saving'; stateNode.textContent = 'Saving…'; }
    var previous = saveQueues[id] || Promise.resolve();
    var request = previous.catch(function () {}).then(function () {
      return operation(id);
    }).then(function (item) {
      saveStates[id] = 'saved';
      projectDetails[id] = item;
      projects = projects.map(function (entry) { return entry.id === item.id ? item : entry; });
      renderList();
      if (project && project.id === id) {
        project = item;
        if (!options.skipWorkspaceRender) renderWorkspace();
        else {
          var stateNode = root.querySelector('#editorSaveState');
          if (stateNode) { stateNode.className = 'editor-save-state saved'; stateNode.textContent = 'Saved'; }
        }
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
      if (options.previewRebuildStarted) delete localPreviewRebuilds[id];
      if (project && project.id === id) renderWorkspace();
      alert(error.message);
    });
    saveQueues[id] = request;
    request.finally(function () { if (saveQueues[id] === request) delete saveQueues[id]; });
    return request;
  }

  function save(patch, options) {
    var id = project.id;
    var mutationId = window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : 'edit-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    var renderKeys = ['removedWordIndices', 'wordCorrection', 'autoSilenceEnabled', 'restoredAutoCutIds', 'captionsEnabled',
      'layoutOverride', 'openingPushInEnabled', 'silenceThresholdSeconds', 'retainedPauseSeconds'];
    var renderWillChange = typeof patch === 'function' || renderKeys.some(function (key) {
      return patch && Object.prototype.hasOwnProperty.call(patch, key);
    });
    if (renderWillChange) releaseAudioPreviewBatch(id);
    rememberPlaybackBeforeEdit(id, renderWillChange);
    var previewRebuildStarted = renderWillChange && project && (project.renderStatus === 'ready' || project.renderRebuildPending);
    if (previewRebuildStarted) {
      localPreviewRebuilds[id] = true;
      renderWorkspace();
    }
    return queueProjectUpdate(id, function () {
      var latest = project && project.id === id ? project : projectDetails[id] || projects.find(function (item) { return item.id === id; });
      function attempt(base, canRetryConflict) {
        var resolvedPatch = typeof patch === 'function' ? patch(base || {}) : patch;
        var payload = Object.assign({}, resolvedPatch, { expectedEditRevision: Number(base && base.editRevision) || 0, mutationId: mutationId });
        function send(canRetryTransport) {
          return api('/api/editor/' + id, { method: 'PATCH', body: JSON.stringify(payload) }).catch(function (error) {
            var transient = !error.status || error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
            if (!canRetryTransport || !transient) throw error;
            return new Promise(function (resolve) { setTimeout(resolve, 350); }).then(function () { return send(false); });
          });
        }
        return send(true).catch(function (error) {
          if (error.code !== 'edit_conflict' || !canRetryConflict) throw error;
          return api('/api/editor/' + id).then(function (fresh) {
            projects = projects.map(function (entry) { return entry.id === id ? fresh : entry; });
            projectDetails[id] = fresh;
            if (project && project.id === id) project = fresh;
            return attempt(fresh, false);
          });
        });
      }
      return attempt(latest || {}, true);
    }, Object.assign({}, options || {}, { previewRebuildStarted: previewRebuildStarted }));
  }

  window.RMEditor = {
    mount: function (element) {
      mountToken++;
      openRequestToken++;
      pendingExplicitOpenToken = 0;
      clearTimeout(pollTimer);
      Object.keys(renderRefreshTimers).forEach(function (id) { clearTimeout(renderRefreshTimers[id]); });
      // Save queues deliberately survive a tab round trip. A PATCH already in
      // flight must remain the predecessor of any new edit made immediately
      // after returning, or two browser requests can race despite serialization
      // within each individual mount.
      root = element; selected.clear(); renderRefreshTimers = {}; restoreTranscriptFocus = false; activeAudioPanelRefresh = null;
      shell();
      // A tab round-trip should feel like returning to an open edit, not like
      // starting the Editor again. Paint the in-memory project immediately,
      // then reconcile it with the server in the background.
      if (projects.length) renderList();
      if (project) renderWorkspace();
      var expectedMountToken = mountToken;
      loadProjects(expectedMountToken).catch(function (error) {
        if (expectedMountToken !== mountToken || !editorMounted()) return;
        var workspace = root && root.querySelector('#editorWorkspace');
        if (workspace) workspace.innerHTML = '<div class="editor-empty"><strong>Editor unavailable</strong><span>' + esc(error.message) + '</span></div>';
      });
    }
  };

})();
