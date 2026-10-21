(function () {
  'use strict';

  var root = null;
  var projects = [];
  var project = null;
  var selected = new Set();
  var pollTimer = null;
  var desktopUploaderPollTimer = null;
  var desktopUploaderDevices = [];
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
  var manualTimelineOpen = {};
  var manualTimelineZoom = {};
  var manualTimelineSelections = {};
  var manualTimelineViewStates = {};
  var editorActionFeedbackTimer = null;
  var restoreTranscriptFocus = false;
  var uploadBatchInProgress = false;
  var uploadBatchCancelled = false;
  var currentUploadXhr = null;
  var currentUploadSessionId = '';
  var manualRevisionRecorder = null;
  var manualRevisionStream = null;
  var uploadStatusText = '';
  var uploadStatusPercent = 0;
  var MAX_RECORDING_BYTES = 128 * 1024 * 1024 * 1024;
  var RESTING_CAMERA_SCALE = 1.25;
  var VERTICAL_OPENING_CAMERA_SCALE = 1.125;
  var HORIZONTAL_OPENING_CAMERA_SCALE = 1.125;
  var VERTICAL_REVEAL_CAMERA_SCALE = 1.125;
  var PAGE_CHANGE_FADE_SECONDS = 0.28;
  var listFilter = localStorage.getItem('rmEditorListFilter') === 'sent' ? 'sent' : 'active';
  var reviewRate = Number(localStorage.getItem('rmEditorReviewRate')) || 1;
  if ([1, 1.25, 1.5, 2].indexOf(reviewRate) === -1) reviewRate = 1;

  window.addEventListener('beforeunload', function (event) {
    if (!uploadBatchInProgress && !Object.keys(saveQueues).length) return;
    event.preventDefault();
    event.returnValue = '';
  });

  window.addEventListener('beforeunload', function () {
    persistCurrentReviewProgress();
    Object.keys(audioPreviewBatches).forEach(releaseAudioPreviewBatch);
  });

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function stopManualRevisionDictation() {
    if (manualRevisionRecorder) {
      manualRevisionRecorder.ondataavailable = null;
      manualRevisionRecorder.onstop = null;
      try { if (manualRevisionRecorder.state === 'recording') manualRevisionRecorder.stop(); } catch (error) {}
    }
    if (manualRevisionStream) manualRevisionStream.getTracks().forEach(function (track) { track.stop(); });
    manualRevisionRecorder = null;
    manualRevisionStream = null;
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

  function audioPreviewUrl(item, trackId) {
    return '/api/editor/' + encodeURIComponent(item.id) + '/audio-preview/' + encodeURIComponent(trackId) +
      '?v=' + encodeURIComponent(audioPreviewFingerprint(item));
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
      return fetch(audioPreviewUrl(item, track.id), {
        method: 'GET', credentials: 'same-origin', cache: 'force-cache'
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

  function projectFormat(item) {
    var layout = item && (item.effectiveLayout || item.layoutOverride);
    if (layout === 'vertical' || layout === 'horizontal') return layout;
    return Number(item && item.height) > Number(item && item.width) ? 'vertical' : 'horizontal';
  }

  function projectFormatIcon(item) {
    var layout = projectFormat(item);
    var label = layout === 'vertical' ? 'Vertical video' : 'Horizontal video';
    return '<i class="editor-format-icon ' + layout + '" role="img" aria-label="' + label + '" title="' + label + '"></i>';
  }

  function projectWorkStateIcon(item) {
    var started = item && item.editStarted === true;
    var label = started ? 'Edit started' : 'Untouched';
    return '<i class="editor-work-icon ' + (started ? 'started' : 'untouched') + '" role="img" aria-label="' + label + '" title="' + label + '"></i>';
  }

  function projectRenderIndicator(item) {
    if (!item) return '';
    var status = item.renderStatus || '';
    if (status === 'ready' || status === 'error') return '';
    var rebuilding = !!localPreviewRebuilds[item.id] || !!item.renderRebuildPending;
    if (!rebuilding && status !== 'queued' && status !== 'running') return '';
    var progress = status === 'running' ? Math.max(0, Math.min(100, Math.round(Number(item.renderProgress) || 0))) : 0;
    var label = rebuilding ? 'Rebuilding preview' : 'Building preview';
    if (status === 'queued') label += ' · queued';
    else if (status === 'running') label += ' · ' + progress + '%';
    else label += ' · preparing';
    return '<span class="editor-project-render-state ' + (status === 'running' ? 'running' : 'queued') + '" role="status" aria-label="' + esc(label) + '" title="' + esc(label) + '">' +
      '<i aria-hidden="true"></i><b aria-hidden="true"><em style="width:' + progress + '%"></em></b>' +
      (status === 'running' ? '<small>' + progress + '%</small>' : '<small>•••</small>') + '</span>';
  }

  function activeManualRevision(item) {
    return ((item && item.manualRevisions) || []).find(function (entry) {
      return entry && (entry.status === 'queued' || entry.status === 'running');
    }) || null;
  }

  function manualRevisionLogHtml(item) {
    var entries = ((item && item.manualRevisions) || []).filter(function (entry) {
      return entry && entry.status !== 'queued' && entry.status !== 'running';
    }).slice().reverse();
    if (!entries.length) return '';
    return '<div class="editor-manual-log"><div class="eyebrow">Manual change log</div>' + entries.map(function (entry) {
      var failed = entry.status === 'error';
      var detail = failed ? entry.error : entry.summary;
      return '<article class="editor-manual-log-entry ' + (failed ? 'error' : 'done') + '"><div><strong>' + (failed ? 'Revision needs attention' : 'Revision completed') + '</strong><time>' + esc(new Date(entry.completedAt || entry.requestedAt).toLocaleString()) + '</time></div>' +
        '<p class="request"><b>Requested:</b> ' + esc(entry.request || '').replace(/\n/g, '<br>') + '</p>' +
        '<p><b>' + (failed ? 'What happened:' : 'Changed:') + '</b> ' + esc(detail || (failed ? 'The task did not complete.' : 'Manual revision completed.')).replace(/\n/g, '<br>') + '</p></article>';
    }).join('') + '</div>';
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

  function storeReviewProgress(id, sourceTime) {
    if (!id || !Number.isFinite(Number(sourceTime))) return;
    var timelineViewport = root && root.querySelector('#editorManualTimelineViewport');
    var value = {
      sourceTime: Math.max(0, Number(sourceTime) || 0),
      timelineOpen: !!manualTimelineOpen[id],
      timelineZoom: Number(manualTimelineZoom[id]) || 0,
      timelineScrollLeft: timelineViewport ? Number(timelineViewport.scrollLeft) || 0 : null
    };
    try { localStorage.setItem(reviewProgressKey(id), JSON.stringify(value)); } catch (error) {}
    // Keep the old tab-scoped value current during the rollout so a browser
    // with an older cached Editor script can still resume this recording.
    try { sessionStorage.setItem(reviewProgressKey(id), JSON.stringify(value)); } catch (error) {}
  }

  function persistCurrentReviewProgress() {
    if (!editorMounted() || !project) return;
    var video = root.querySelector('#editorVideo');
    if (!video || !video.getAttribute('src') || !Number.isFinite(Number(video.currentTime))) return;
    var sourceTime = video.dataset.previewMode === 'final'
      ? editedToSourceTime(video.currentTime, project)
      : Number(video.currentTime) || 0;
    storeReviewProgress(project.id, sourceTime);
  }

  function restoreReviewProgress(item) {
    if (!item || Object.prototype.hasOwnProperty.call(previewSeekTimes, item.id)) return;
    var saved;
    try {
      saved = JSON.parse(localStorage.getItem(reviewProgressKey(item.id)) || sessionStorage.getItem(reviewProgressKey(item.id)) || 'null');
    } catch (error) {}
    var sourceTime = saved && typeof saved === 'object' ? Number(saved.sourceTime) : NaN;
    var duration = Number(item.duration) || 0;
    if (!Number.isFinite(sourceTime) || sourceTime < 0 || (duration > 0 && sourceTime > duration)) return;
    // A clean ready recording reopens on its actual rendered preview. A dirty
    // one reopens on the live working preview so every newer decision is shown
    // without falling back to either the stale render or the raw master.
    var mode = item.renderStatus === 'ready' && !item.renderDirty ? 'final' : 'source';
    delete explicitSourcePreviews[item.id];
    previewModes[item.id] = mode;
    previewSeekTimes[item.id] = mode === 'final' ? sourceToEditedTime(sourceTime, cutsForClient(item), item) : sourceTime;
    if (saved.timelineOpen) manualTimelineOpen[item.id] = true;
    if (Number(saved.timelineZoom) > 0) manualTimelineZoom[item.id] = Number(saved.timelineZoom);
    if (saved.timelineOpen) {
      manualTimelineViewStates[item.id] = {
        sourceTime: sourceTime,
        scrollLeft: Number.isFinite(Number(saved.timelineScrollLeft)) ? Number(saved.timelineScrollLeft) : null
      };
    }
  }

  function cutsForClient(item) {
    return Array.isArray(item && item.cuts) ? item.cuts : [];
  }

  function clearReviewProgress(id) {
    try { localStorage.removeItem(reviewProgressKey(id)); } catch (error) {}
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
    var confirmedPageChanges = new Set((item.pageChangeCutIds || []).map(String));
    cuts.forEach(function (cut) {
      if (cut.reason !== 'long_pause' && cut.reason !== 'combined') return;
      if (Number(cut.end) - Number(cut.start) < 3) return;
      if (!confirmedPageChanges.has(pageChangeCutKey(cut))) return;
      var boundary = sourceToEditedTime(cut.end, cuts);
      if (boundary <= editedTime + 0.001) resetAt = Math.max(resetAt, boundary);
    });
    return {
      resetAt: resetAt,
      elapsed: Math.max(0, editedTime - resetAt),
      duration: (item.effectiveLayout || 'horizontal') === 'horizontal' && resetAt === 0 ? 5 : 3
    };
  }

  function pageChangeCutKey(cut) {
    return String(cut && cut.id || '') || 'merged-' + Number(cut.start).toFixed(3) + '-' + Number(cut.end).toFixed(3);
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
    if (item.cloudQueueStatus === 'preparing') return 'R2 secured · entering Editor';
    if (item.cloudQueueStatus === 'error') return 'R2 secured · needs attention';
    if (item.cloudQueueStatus === 'queued') return 'R2 secured · waiting for workspace';
    var manualRevision = activeManualRevision(item);
    if (manualRevision) return manualRevision.status === 'running' ? 'Updating manually' : 'Manual revision queued';
    if (item.oversizedSource && item.sourcePreparationStatus === 'queued') return 'Waiting to secure large recording';
    if (item.oversizedSource && item.sourcePreparationStatus === 'archiving') return 'Archiving original to R2';
    if (item.oversizedSource && item.sourcePreparationStatus === 'compacting') return 'Building editing master';
    if (item.oversizedSource && item.sourcePreparationStatus === 'error') return 'Large recording needs attention';
    if (item.transcriptionStatus === 'pending') return queued('Waiting for transcript', item.transcriptionQueuePosition);
    if (item.transcriptionStatus === 'running') return 'Transcribing';
    if (item.transcriptionStatus === 'error') return 'Needs attention';
    if (['pending', 'running'].indexOf(item.browserPreviewStatus) !== -1 && item.renderStatus !== 'ready') return queued('Preparing browser preview', item.previewQueuePosition);
    if (item.browserPreviewStatus === 'error' && item.renderStatus !== 'ready') return 'Needs attention';
    if ((item.classificationStatus === 'error' && framingFailureIsBlocking(item)) || item.renderStatus === 'error') return 'Needs attention';
    if (item.classificationStatus === 'pending') return queued('Waiting for frame analysis', item.classificationQueuePosition);
    if (item.classificationStatus === 'running') return 'Analyzing frame';
    if (item.layoutReviewRequired) return 'Review framing';
    if (item.workflowWarning) return item.renderStatus === 'ready' ? 'Ready · workflow warning' : 'Workflow warning';
    if (item.planningMatchStatus === 'pending') return queued('Waiting for plan match', item.planningQueuePosition);
    if (item.planningMatchStatus === 'running') return 'Matching plan';
    if (item.clipInsertStatus === 'queued' || item.clipInsertStatus === 'preparing') return 'Preparing inserted clip';
    if (item.clipInsertStatus === 'error') return 'Inserted clip needs attention';
    if (item.renderRebuildPending && !item.renderStatus) return 'Preparing preview rebuild';
    if (item.renderStatus === 'queued') return queued('Waiting to render', item.renderQueuePosition);
    if (item.renderStatus === 'running') return 'Rendering' + (Number(item.renderProgress) > 0 ? ' · ' + Math.round(Number(item.renderProgress)) + '%' : '');
    if (item.renderStatus === 'ready') return item.renderDirty ? 'Edits saved · rebuild preview' : 'Ready for approval';
    return 'Ready to edit';
  }

  function framingFailureIsBlocking(item) {
    return !!item && item.classificationStatus === 'error' &&
      (item.layoutOverride === 'auto' || !item.layoutOverride) && Number(item.width) >= Number(item.height);
  }

  function audioUnavailableMessage(item) {
    var automaticEditRunning = ['pending', 'running', 'pending_transcript'].indexOf(item && item.planningMatchStatus) !== -1 ||
      ['queued', 'preparing'].indexOf(item && item.clipInsertStatus) !== -1;
    if (automaticEditRunning) return 'Available when the automatic edit is ready';
    if (item && item.renderStatus === 'error') return 'Retry the failed editing preview to unlock audio';
    return 'Available when the editing preview is ready';
  }

  function sessionBucket(item) {
    if (item.productionPieceId) return item.workflowWarning ? 'warning' : 'sent';
    if (item.cloudQueueStatus) return item.cloudQueueStatus === 'error' ? 'attention' : 'working';
    if (activeManualRevision(item)) return 'working';
    if (item.oversizedSource && item.sourcePreparationStatus === 'error') return 'attention';
    if (item.transcriptionStatus === 'error' || (item.browserPreviewStatus === 'error' && item.renderStatus !== 'ready') || framingFailureIsBlocking(item) || item.clipInsertStatus === 'error' || item.renderStatus === 'error' || item.layoutReviewRequired) return 'attention';
    if (item.workflowWarning) return 'warning';
    if (item.renderStatus === 'ready' && !item.renderDirty) return 'ready';
    if (['queued', 'archiving', 'compacting'].indexOf(item.sourcePreparationStatus) !== -1 || ['pending', 'running'].indexOf(item.transcriptionStatus) !== -1 || ['pending', 'running'].indexOf(item.browserPreviewStatus) !== -1 || ['pending', 'running'].indexOf(item.classificationStatus) !== -1 || ['pending', 'running', 'pending_transcript'].indexOf(item.planningMatchStatus) !== -1 || ['queued', 'preparing'].indexOf(item.clipInsertStatus) !== -1 || ['queued', 'running'].indexOf(item.renderStatus) !== -1 || item.renderRebuildPending) return 'working';
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
    var now = Date.now();
    var laptopUploads = desktopUploaderDevices.filter(function (device) {
      var heartbeatAt = new Date(device.lastSeenAt || 0).getTime();
      return !device.revokedAt && device.status === 'uploading' && heartbeatAt && now - heartbeatAt < 120000;
    });
    if (!projects.length && !laptopUploads.length) { summary.hidden = true; summary.innerHTML = ''; return; }
    var counts = { working: 0, ready: 0, warning: 0, attention: 0, prepared: 0, sent: 0 };
    projects.forEach(function (item) { counts[sessionBucket(item)]++; });
    var labels = { working: 'processing', ready: 'ready to approve', warning: 'workflow warning', attention: 'need attention', prepared: 'prepared', sent: 'sent' };
    var uploadBadges = laptopUploads.map(function (device) {
      var percent = Math.max(0, Math.min(100, Math.round(Number(device.uploadProgress) || 0)));
      var fileName = device.currentFileName || 'recording';
      return '<span class="uploading" title="' + esc('Uploading ' + fileName + ' from ' + (device.name || 'laptop')) + '"><i></i>Uploading · ' + percent + '%</span>';
    }).join('');
    summary.innerHTML = '<strong>' + projects.length + ' recording' + (projects.length === 1 ? '' : 's') + '</strong>' + uploadBadges + Object.keys(counts).filter(function (key) { return counts[key]; }).map(function (key) {
      return '<span class="' + key + '"><i></i>' + counts[key] + ' ' + labels[key] + '</span>';
    }).join('');
    summary.hidden = false;
  }

  function pollDesktopUploaderStatus(expectedMountToken) {
    clearTimeout(desktopUploaderPollTimer);
    var wasUploading = desktopUploaderDevices.some(function (device) { return device.status === 'uploading'; });
    fetch('/api/desktop-uploader/devices', { credentials: 'include' }).then(function (response) {
      if (!response.ok) throw new Error('uploader_status_unavailable');
      return response.json();
    }).then(function (result) {
      if (expectedMountToken !== mountToken || !editorMounted()) return;
      desktopUploaderDevices = (result.devices || []).filter(function (device) { return !device.revokedAt; });
      renderSessionSummary();
      var isUploading = desktopUploaderDevices.some(function (device) { return device.status === 'uploading'; });
      if (wasUploading && !isUploading) loadProjects(expectedMountToken).catch(function () {});
    }).catch(function () {
      if (expectedMountToken === mountToken && editorMounted()) renderSessionSummary();
    }).finally(function () {
      if (expectedMountToken === mountToken && editorMounted()) {
        desktopUploaderPollTimer = setTimeout(function () { pollDesktopUploaderStatus(expectedMountToken); }, 2000);
      }
    });
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

  function manualTimelineSplitKey(id) {
    return 'rmEditorTimelineSplits:' + id;
  }

  function manualTimelineSplitsFor(item) {
    var duration = Math.max(0, Number(item && item.duration) || 0);
    var values = [];
    try { values = JSON.parse(localStorage.getItem(manualTimelineSplitKey(item.id)) || '[]'); } catch (error) {}
    return Array.from(new Set((Array.isArray(values) ? values : []).map(Number).filter(function (time) {
      return Number.isFinite(time) && time > 0.02 && time < duration - 0.02;
    }).map(function (time) { return Number(time.toFixed(3)); }))).sort(function (a, b) { return a - b; });
  }

  function storeManualTimelineSplits(item, values) {
    localStorage.setItem(manualTimelineSplitKey(item.id), JSON.stringify(values));
  }

  function manualTimelineVoiceRanges(words) {
    var ranges = [];
    (words || []).forEach(function (word) {
      var start = Math.max(0, Number(word.start) || 0);
      var end = Math.max(start, Number(word.end) || start);
      var previous = ranges[ranges.length - 1];
      if (!previous || start - previous.end > 0.32) ranges.push({ start: start, end: end });
      else previous.end = Math.max(previous.end, end);
    });
    return ranges;
  }

  function manualTimelineHtml(item, locked) {
    if (!manualTimelineOpen[item.id]) return '';
    var duration = Math.max(0.01, Number(item.duration) || 0.01);
    var zoom = Math.max(8, Math.min(180, Number(manualTimelineZoom[item.id]) || 14));
    manualTimelineZoom[item.id] = zoom;
    var splits = manualTimelineSplitsFor(item);
    var boundaries = [0].concat(splits, [duration]);
    var selection = manualTimelineSelections[item.id];
    function pct(time) { return Math.max(0, Math.min(100, time / duration * 100)).toFixed(5); }
    function widthPct(start, end) { return Math.max(0.02, (end - start) / duration * 100).toFixed(5); }
    function selected(start, end) {
      return selection && Math.abs(selection.start - start) < 0.002 && Math.abs(selection.end - end) < 0.002;
    }
    var segments = boundaries.slice(0, -1).map(function (start, index) {
      var end = boundaries[index + 1];
      return '<button type="button" class="editor-manual-segment' + (selected(start, end) ? ' selected' : '') + '" data-start="' + start.toFixed(3) + '" data-end="' + end.toFixed(3) + '" style="left:' + pct(start) + '%;width:' + widthPct(start, end) + '%" title="Select ' + formatTime(start) + '–' + formatTime(end) + '"></button>';
    }).join('');
    var voice = manualTimelineVoiceRanges(item.words).map(function (range) {
      return '<i class="editor-manual-voice-block" style="left:' + pct(range.start) + '%;width:' + widthPct(range.start, range.end) + '%"></i>';
    }).join('');
    var cuts = (item.cuts || []).map(function (cut) {
      return '<i class="editor-manual-cut" style="left:' + pct(cut.start) + '%;width:' + widthPct(cut.start, cut.end) + '%" title="Removed ' + formatTime(cut.start) + '–' + formatTime(cut.end) + '"></i>';
    }).join('');
    var editableCuts = (item.editableTimelineCuts || []).map(function (cut) {
      var start = Math.max(0, Math.min(duration, Number(cut.start) || 0));
      var end = Math.max(start, Math.min(duration, Number(cut.end) || start));
      if (end - start < 0.02) return '';
      var origin = cut.editableOrigin === 'automatic' ? 'automatic' : 'manual';
      var protectedTail = item.endingProtectionEnabled === true && (cut.id === 'tail' || /^adjusted-tail-/.test(cut.id));
      return '<span class="editor-manual-cut-editable ' + origin + '" data-cut-id="' + esc(cut.id) + '" data-cut-origin="' + origin + '" data-cut-start="' + start.toFixed(3) + '" data-cut-end="' + end.toFixed(3) + '" style="left:' + pct(start) + '%;width:' + widthPct(start, end) + '%" title="' + (origin === 'automatic' ? 'Automatic' : 'Manual') + ' cut ' + formatTime(start) + '–' + formatTime(end) + '">' +
        (locked ? '' : '<button type="button" class="editor-manual-cut-handle start" data-cut-edge="start" aria-label="Drag the start of this cut"></button>' + (protectedTail ? '' : '<button type="button" class="editor-manual-cut-handle end" data-cut-edge="end" aria-label="Drag the end of this cut"></button>')) + '</span>';
    }).join('');
    var confirmedPageChanges = new Set((item.pageChangeCutIds || []).map(String));
    var pageMarkers = (item.cuts || []).filter(function (cut) { return confirmedPageChanges.has(pageChangeCutKey(cut)); }).map(function (cut) {
      var key = pageChangeCutKey(cut);
      return '<button type="button" class="editor-page-change-marker" data-page-cut-key="' + esc(key) + '" style="left:' + pct(cut.end) + '%" title="Page-turn zoom + fade at ' + formatTime(cut.end) + ' · right-click to remove" aria-label="Page-turn zoom and fade at ' + formatTime(cut.end) + '">↗</button>';
    }).join('');
    var markers = splits.map(function (time) {
      return '<i class="editor-manual-split" style="left:' + pct(time) + '%" title="Split at ' + formatTime(time) + '"></i>';
    }).join('');
    var effectiveWidth = Math.max(760, Math.round(duration * zoom));
    var tickStep = zoom >= 70 ? 1 : zoom >= 28 ? 5 : 10;
    var ticks = '';
    for (var time = 0; time <= duration; time += tickStep) {
      ticks += '<i style="left:' + pct(time) + '%"><span>' + formatTime(time) + '</span></i>';
    }
    return '<section class="editor-manual-timeline" id="editorManualTimeline"><div class="editor-manual-timeline-head"><div><div class="eyebrow">Source timeline</div><h3>Video + voice</h3><span>Click to seek. Drag cut handles to adjust timing.' + (item.endingProtectionEnabled ? ' The ending cut stays anchored to the source end.' : '') + ' Gold handles mark automatic cuts. Right-click a page-turn marker to remove its zoom and fade without restoring the cut.</span></div><div class="editor-manual-timeline-actions">' +
      '<label class="editor-timeline-fade">Fade to black <input type="number" id="editorTimelineFadeSeconds" min="0.3" max="4" step="0.1" value="' + (Number(item.outroFadeSeconds) > 0 ? Number(item.outroFadeSeconds) : (item.effectiveLayout === 'vertical' ? 2 : 1.7)) + '" ' + (locked ? 'disabled' : '') + ' aria-label="Fade to black duration in seconds"> s</label>' +
      '<button type="button" class="btn-secondary btn-tiny" id="editorTimelineUndo" ' + (!item.canUndoCut || locked ? 'disabled' : '') + '>Undo last decision</button><button type="button" class="btn-secondary btn-tiny" id="editorTimelineAddSplit" ' + (locked ? 'disabled' : '') + '>Split at playhead</button><button type="button" class="btn-secondary btn-tiny" id="editorTimelineClearSplits" ' + (!splits.length || locked ? 'disabled' : '') + '>Clear splits</button><button type="button" class="btn-primary btn-tiny" id="editorTimelineDelete" ' + (!selection || locked ? 'disabled' : '') + '>Delete selected section</button></div></div>' +
      '<div class="editor-manual-timeline-hint"><span id="editorTimelineZoomLabel">' + zoom.toFixed(0) + ' px/sec</span><span>Ctrl/⌘ + scroll to zoom · normal scroll moves along the timeline</span></div>' +
      '<div class="editor-manual-timeline-viewport" id="editorManualTimelineViewport"><div class="editor-manual-timeline-inner" id="editorManualTimelineInner" style="width:' + effectiveWidth + 'px">' +
        '<div class="editor-manual-ruler">' + ticks + '</div><div class="editor-manual-lane editor-manual-video-lane"><b>VIDEO</b>' + segments + cuts + editableCuts + pageMarkers + '</div>' +
        '<div class="editor-manual-lane editor-manual-voice-lane"><b>VOICE</b>' + voice + cuts + '</div>' + markers + '<i class="editor-manual-playhead" id="editorManualPlayhead"></i></div></div>' +
        '<div class="editor-page-change-menu" id="editorPageChangeMenu" hidden><button type="button" id="editorRemovePageChange">Remove zoom + fade here</button></div></section>';
  }

  function processingStepsHtml(item) {
    function step(state, label, detail) {
      return '<div class="editor-process-step ' + state + '"><i></i><div><strong>' + esc(label) + '</strong><span>' + esc(detail) + '</span></div></div>';
    }
    var transcriptState = item.transcriptionStatus === 'error' ? 'error' : item.transcriptionStatus === 'ready' ? 'done' : 'active';
    var frameState = item.classificationStatus === 'error' ? 'error' : item.classificationStatus === 'ready' ? 'done' : item.classificationStatus === 'running' || item.classificationStatus === 'pending' ? 'active' : 'waiting';
    var planState = item.planningMatchStatus === 'error' ? 'error' : item.planningMatchStatus === 'ready' ? 'done' : item.planningMatchStatus === 'running' || item.planningMatchStatus === 'pending' ? 'active' : 'waiting';
    var previewState = item.browserPreviewStatus === 'error' ? 'error' : item.browserPreviewStatus === 'ready' ? 'done' : item.browserPreviewRequired ? 'active' : '';
    var sourceState = item.oversizedSource ? (item.sourcePreparationStatus === 'error' ? 'error' : item.sourcePreparationStatus === 'ready' ? 'done' : 'active') : 'done';
    var sourceDetail = item.oversizedSource
      ? (sourceState === 'done' ? 'Original archived in R2; compact editing master ready' : sourceState === 'error' ? 'Needs retry' : item.sourcePreparationStatus === 'compacting' ? 'Creating the local editing master' : 'Uploading the untouched original to R2')
      : 'Original master preserved';
    return '<div class="editor-processing-steps">' + step(sourceState, 'Recording secured', sourceDetail) +
      (item.browserPreviewRequired ? step(previewState, 'Browser review copy', previewState === 'done' ? 'H.264 preview ready' : previewState === 'error' ? 'Can be retried' : Number(item.previewQueuePosition) > 1 ? (Number(item.previewQueuePosition) - 1) + ' recording(s) ahead' : 'Converting camera codec') : '') +
      step(transcriptState, 'Word-timed transcript', transcriptState === 'done' ? 'Speech mapped' : transcriptState === 'error' ? 'Needs retry' : item.transcriptionStatus === 'pending' && Number(item.transcriptionQueuePosition) > 1 ? (Number(item.transcriptionQueuePosition) - 1) + ' recording(s) ahead' : 'Listening for every word') +
      step(frameState, 'Camera orientation', frameState === 'done' ? (Number(item.height) > Number(item.width) ? 'Portrait detected' : 'Landscape detected') : 'Reading recording dimensions') +
      step('done', 'Pause cleanup', 'Long pauses removed; spoken mistakes stay for transcript editing') +
      step(planState, 'Planning card', planState === 'done' ? 'Workflow linked' : planState === 'error' ? 'Manual choice available' : item.planningMatchStatus === 'pending' && Number(item.planningQueuePosition) > 1 ? (Number(item.planningQueuePosition) - 1) + ' recording(s) ahead' : planState === 'active' ? 'Matching filmed content' : 'Starts after transcription') + '</div>';
  }

  function failedSteps(item) {
    var labels = [];
    if (item.oversizedSource && item.sourcePreparationStatus === 'error') labels.push('large recording preparation');
    if (item.transcriptionStatus === 'error') labels.push('transcript');
    if (item.browserPreviewStatus === 'error') labels.push('browser preview');
    if (framingFailureIsBlocking(item)) labels.push('framing');
    if (item.renderStatus === 'error') labels.push('final render');
    return labels;
  }

  function shell() {
    root.innerHTML =
      '<section class="video-editor">' +
        '<header class="editor-heading"><div><div class="eyebrow">Content production</div><h1>Editor</h1>' +
          '<p>Drop in a filming session. Each recording is framed, transcribed, cleaned and prepared for your approval.</p></div>' +
          '<div class="editor-heading-actions"><a href="voice-mobile.html" class="editor-pm-mobile btn-secondary">Project Manager</a><label class="editor-upload btn-primary"><input id="editorFile" type="file" accept="video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi" multiple hidden>Upload raw videos</label></div></header>' +
        '<div class="editor-upload-progress" id="editorUploadProgress" hidden><div class="editor-upload-progress-head"><span id="editorUploadLabel">Uploading…</span><button type="button" class="btn-secondary btn-tiny" id="editorCancelUpload" hidden>Cancel batch</button></div><div class="editor-upload-progress-track"><i id="editorUploadBar"></i></div></div>' +
        '<div class="editor-notice" id="editorNotice" hidden></div>' +
        '<div class="editor-action-feedback" id="editorActionFeedback" role="status" aria-live="polite"></div>' +
        '<div class="editor-session-summary" id="editorSessionSummary" role="status" aria-live="polite" hidden></div>' +
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
      if (currentUploadSessionId) api('/api/editor/uploads/' + encodeURIComponent(currentUploadSessionId), { method: 'DELETE' }).catch(function () {});
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
        persistCurrentReviewProgress();
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

  function showEditorActionFeedback(message) {
    var feedback = root && root.querySelector('#editorActionFeedback');
    if (!feedback) return;
    clearTimeout(editorActionFeedbackTimer);
    feedback.textContent = message || '';
    feedback.classList.toggle('show', !!message);
    if (!message) return;
    editorActionFeedbackTimer = setTimeout(function () {
      if (feedback.isConnected) feedback.classList.remove('show');
    }, 2600);
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
        projectRenderIndicator(item) + '<span class="editor-project-copy"><span class="editor-project-title"><strong>' + esc(displayName(item)) + '</strong><span class="editor-project-icons">' + projectWorkStateIcon(item) + projectFormatIcon(item) + '</span></span><span class="editor-project-meta">' + esc(statusLabel(item)) + ' · ' + formatTime(item.duration) + (formatBytes(item.sizeBytes) ? ' · ' + formatBytes(item.sizeBytes) : '') + '</span></span></button>';
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

  function normalizeUploadError(error) {
    error = error || new Error('The recording could not be uploaded.');
    error.duplicate = error.duplicate || error.code === 'duplicate_recording' || !!(error.body && error.body.error === 'duplicate_recording');
    error.existingProjectId = error.existingProjectId || error.body && error.body.existingProjectId || '';
    error.transient = error.transient || error.code === 'upload_session_missing' || !error.status || error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
    return error;
  }

  function uploadChunk(uploadId, chunkIndex, offset, blob, file, queueIndex, queueTotal, completedBytes, totalBytes) {
    function once() {
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        currentUploadXhr = xhr;
        xhr.open('POST', '/api/editor/uploads/' + encodeURIComponent(uploadId) + '/chunks/' + chunkIndex);
        xhr.withCredentials = true;
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.setRequestHeader('X-Upload-Offset', String(offset));
        xhr.upload.onprogress = function (event) {
          var chunkLoaded = event.lengthComputable ? Math.min(blob.size, event.loaded) : 0;
          uploadStatusPercent = Math.round((completedBytes + offset + chunkLoaded) / Math.max(1, totalBytes) * 100);
          uploadStatusText = 'Uploading ' + (queueIndex + 1) + ' of ' + queueTotal + ' · ' + file.name + ' · ' + uploadStatusPercent + '%';
          paintUploadStatus();
        };
        xhr.onload = function () {
          if (currentUploadXhr === xhr) currentUploadXhr = null;
          var body = {};
          try { body = JSON.parse(xhr.responseText || '{}'); } catch (error) {}
          if (xhr.status >= 200 && xhr.status < 300) return resolve(body);
          var failure = new Error(body.message || 'A part of the recording could not be uploaded.');
          failure.code = body.error || '';
          failure.status = xhr.status;
          failure.body = body;
          reject(normalizeUploadError(failure));
        };
        xhr.onerror = function () {
          if (currentUploadXhr === xhr) currentUploadXhr = null;
          var failure = new Error('Upload interrupted. Check the connection and try again.');
          failure.transient = true;
          reject(failure);
        };
        xhr.onabort = function () {
          if (currentUploadXhr === xhr) currentUploadXhr = null;
          var failure = new Error('Upload cancelled.');
          failure.cancelled = true;
          reject(failure);
        };
        xhr.send(blob);
      });
    }
    return once().catch(function (error) {
      if (error.cancelled || !error.transient || uploadBatchCancelled) throw error;
      uploadStatusText = 'Connection interrupted · retrying ' + file.name + '…';
      paintUploadStatus();
      return new Promise(function (resolve) { setTimeout(resolve, 500); }).then(once);
    });
  }

  function upload(file, queueIndex, queueTotal, completedBytes, totalBytes) {
    uploadStatusPercent = Math.round(completedBytes / Math.max(1, totalBytes) * 100);
    uploadStatusText = 'Preparing ' + file.name + '…';
    paintUploadStatus();
    var uploadId = '';
    return api('/api/editor/uploads', {
      method: 'POST',
      body: JSON.stringify({ fileName: file.name, mimeType: file.type, sizeBytes: file.size, name: file.name.replace(/\.[^.]+$/, '') })
    }).then(function (session) {
      uploadId = session.id;
      currentUploadSessionId = uploadId;
      var chunkSize = Math.max(1024 * 1024, Number(session.chunkSize) || 16 * 1024 * 1024);
      var offset = Math.max(0, Number(session.receivedBytes) || 0);
      var chunkIndex = Math.floor(offset / chunkSize);
      var sequence = Promise.resolve();
      while (offset < file.size) {
        (function (partOffset, partIndex) {
          var blob = file.slice(partOffset, Math.min(file.size, partOffset + chunkSize));
          sequence = sequence.then(function () {
            if (uploadBatchCancelled) {
              var cancelled = new Error('Upload cancelled.'); cancelled.cancelled = true; throw cancelled;
            }
            return uploadChunk(uploadId, partIndex, partOffset, blob, file, queueIndex, queueTotal, completedBytes, totalBytes).then(function () {
              uploadStatusPercent = Math.round((completedBytes + partOffset + blob.size) / Math.max(1, totalBytes) * 100);
              uploadStatusText = 'Uploading ' + (queueIndex + 1) + ' of ' + queueTotal + ' · ' + file.name + ' · ' + uploadStatusPercent + '%';
              paintUploadStatus();
            });
          });
        })(offset, chunkIndex);
        offset += chunkSize;
        chunkIndex++;
      }
      return sequence.then(function () {
        uploadStatusPercent = Math.round((completedBytes + file.size) / Math.max(1, totalBytes) * 100);
        uploadStatusText = 'Securing ' + file.name + ' on the server…';
        paintUploadStatus();
        return api('/api/editor/uploads/' + encodeURIComponent(uploadId) + '/complete', { method: 'POST', body: '{}' });
      });
    }).then(function (body) {
      currentUploadSessionId = '';
      if (body.videoPiece && typeof window.__rmRegisterEditorVideoCard === 'function') {
        window.__rmRegisterEditorVideoCard(body.videoPiece);
      }
      delete body.videoPiece;
      projectDetails[body.id] = body;
      projects.unshift(body);
      renderList();
      return body;
    }).catch(function (error) {
      if (uploadId) api('/api/editor/uploads/' + encodeURIComponent(uploadId), { method: 'DELETE' }).catch(function () {});
      currentUploadSessionId = '';
      throw normalizeUploadError(error);
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
      if (oversized.length) return alert('These recordings are larger than the 128 GiB per-file limit:\n\n' + oversized.join('\n') + '\n\nSplit or trim each raw take, then try again.');
      if (unsupported.length) return alert('These files do not look like supported recordings:\n\n' + unsupported.join('\n') + '\n\nUse MP4, MOV, M4V, WebM, MKV, or AVI.');
      return alert('Drop one or more video files.');
    }
    var created = [];
    var projectAtBatchStart = project && project.id || '';
    var failures = oversized.map(function (name) { return name + ': larger than the 128 GiB per-file limit'; });
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
      currentUploadSessionId = '';
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
    return retryTransientOnce(function () { return api('/api/editor'); }, 300).then(function (items) {
      if (expectedMountToken !== mountToken || !editorMounted()) return;
      projects = items;
      projects.forEach(function (item) { if (item.renderStatus === 'ready' || item.renderStatus === 'error') delete localPreviewRebuilds[item.id]; });
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
    persistCurrentReviewProgress();
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
      var completedReplacement = !!(previousProject && previousProject.id === item.id && item.renderStatus === 'ready' &&
        String(item.renderSha256 || '') && String(previousProject.renderSha256 || '') !== String(item.renderSha256 || ''));
      var progressOnly = !!(quiet && previousProject && previousProject.id === item.id && previousProject.renderStatus === 'running' && item.renderStatus === 'running');
      var unchanged = !!(quiet && previousProject && previousProject.id === item.id &&
        String(previousProject.updatedAt || '') === String(item.updatedAt || '') &&
        String(previousProject.renderSha256 || '') === String(item.renderSha256 || '') &&
        Number(previousProject.editRevision || 0) === Number(item.editRevision || 0));
      if (item.renderStatus === 'ready') delete localPreviewRebuilds[item.id];
      // A completed replacement is the thing Harvey is here to review. Do not
      // leave an already-open workspace parked on the raw camera master: that
      // view deliberately has no cuts, baked captions or entrance treatment
      // and previously made a healthy render look broken after polling.
      if (completedReplacement) {
        delete explicitSourcePreviews[item.id];
        previewModes[item.id] = 'final';
      }
      project = item;
      if (!quiet && !item.productionPieceId && !item.editStarted && !item.cloudQueueStatus) {
        item.editStarted = true;
        projects = projects.map(function (entry) {
          return entry.id === item.id ? Object.assign({}, entry, { editStarted: true }) : entry;
        });
        fetch('/api/editor/' + encodeURIComponent(item.id) + '/review-started', { method: 'POST', credentials: 'include' }).catch(function () {});
      }
      if (item.ingestSource === 'desktop_listener') {
        fetch('/api/editor/' + encodeURIComponent(item.id) + '/seen', { method: 'POST', credentials: 'include' })
          .then(function () { if (typeof window.__rmRefreshEditorUnreadBadge === 'function') window.__rmRefreshEditorUnreadBadge(); })
          .catch(function () {});
      }
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
        if (label) label.textContent = 'Encoding editing preview · ' + percent + '%';
        if (bar) bar.style.width = Math.max(2, percent) + '%';
        if (button) button.textContent = 'Building editing preview… ' + percent + '%';
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
    return !!item && (!!item.cloudQueueStatus || !!activeManualRevision(item) || ['queued', 'archiving', 'compacting'].indexOf(item.sourcePreparationStatus) !== -1 ||
      ['pending', 'running'].indexOf(item.transcriptionStatus) !== -1 ||
      ['pending', 'running'].indexOf(item.browserPreviewStatus) !== -1 ||
      ['pending', 'running'].indexOf(item.classificationStatus) !== -1 ||
      ['pending', 'running', 'pending_transcript'].indexOf(item.retakeAnalysisStatus) !== -1 ||
      ['pending', 'running', 'pending_transcript'].indexOf(item.planningMatchStatus) !== -1 ||
      ['queued', 'preparing'].indexOf(item.clipInsertStatus) !== -1 ||
      ['queued', 'running'].indexOf(item.renderStatus) !== -1 || (item.renderRebuildPending && item.renderStatus !== 'error'));
  }

  function projectPollSignature(item) {
    if (!item) return '';
    var manualRevision = activeManualRevision(item);
    var latestManualRevision = ((item.manualRevisions || []).slice(-1)[0]) || {};
    return [item.sourcePreparationStatus || '', item.transcriptionStatus, item.browserPreviewStatus, item.classificationStatus, item.retakeAnalysisStatus, item.planningMatchStatus,
      item.clipInsertStatus || '', item.renderStatus, Math.round(Number(item.renderProgress) || 0), item.renderRebuildPending ? 'rebuild' : '', item.productionPieceId || '', item.workflowWarning || '',
      manualRevision ? manualRevision.id + ':' + manualRevision.status : '', latestManualRevision.id || '', latestManualRevision.status || '', latestManualRevision.completedAt || ''].join('|');
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
        items.forEach(function (item) { if (item.renderStatus === 'ready' || item.renderStatus === 'error') delete localPreviewRebuilds[item.id]; });
        projects = items;
        renderList();
        var summary = items.find(function (item) { return item.id === activeId; });
        if (summary && (projectIsActive(summary) || projectPollSignature(summary) !== before)) return openProject(activeId, true);
        schedulePoll();
      }).catch(function () { schedulePoll(); });
    }, 1800);
  }

  function deleteCurrentRecording(deleteButton) {
    if (!project) return;
    var message = project.productionPieceId
      ? 'Remove this Editor source and render? The approved Content Production copy will remain safe.'
      : 'Permanently delete this original recording and its rendered edit? This cannot be undone.';
    if (!confirm(message)) return;
    var id = project.id;
    if (deleteButton) { deleteButton.disabled = true; deleteButton.textContent = 'Deleting…'; }
    api('/api/editor/' + encodeURIComponent(id), { method: 'DELETE' }).then(function () {
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
  }

  function renderWorkspace() {
    activeAudioPanelRefresh = null;
    var workspace = root.querySelector('#editorWorkspace');
    if (!workspace || !project) return;
    if (project.cloudQueueStatus) {
      var cloudFailed = project.cloudQueueStatus === 'error';
      workspace.innerHTML = '<div class="editor-processing" role="status"><div class="editor-processing-icon' + (cloudFailed ? ' error' : '') + '">' + (cloudFailed ? '!' : '') + '</div>' +
        '<div class="eyebrow">Recording secured in Cloudflare R2</div><h2>' + esc(displayName(project)) + '</h2>' +
        '<p>' + (cloudFailed ? esc(project.cloudQueueError || 'This recording needs attention before it can enter the Editor.') :
          project.cloudQueueStatus === 'preparing' ? 'Downloading and preparing the next editing master. The original is safe in R2.' :
          'Waiting for enough local editing workspace. You can keep recording and uploading; the original is safe in R2 and this will enter the Editor automatically when space is available.') + '</p>' +
        '<button type="button" class="editor-delete" id="editorDeleteCloud">Delete queued recording</button></div>';
      workspace.querySelector('#editorDeleteCloud').onclick = function () {
        if (!confirm('Permanently delete this R2-stored recording? This cannot be undone.')) return;
        var id = project.id;
        api('/api/editor/' + encodeURIComponent(id), { method: 'DELETE' }).then(function () {
          projects = projects.filter(function (item) { return item.id !== id; });
          delete projectDetails[id]; project = null; renderList();
          workspace.innerHTML = '<div class="editor-empty"><strong>Recording deleted</strong><span>Select another recording.</span></div>';
        }).catch(function (error) { alert(error.message); });
      };
      return;
    }
    var manualRevision = activeManualRevision(project);
    if (manualRevision) {
      workspace.innerHTML = '<div class="editor-manual-working" role="status" aria-live="polite"><div class="editor-processing-icon"></div>' +
        '<div class="eyebrow">Manual revision</div><h2>' + (manualRevision.status === 'running' ? 'Updating this video manually…' : 'Your revision is queued…') + '</h2>' +
        '<p>' + (manualRevision.status === 'running' ? 'I am applying and checking your requested change now.' : 'Project Manager has the instruction and will begin as soon as the current task finishes.') + ' You can leave the Editor and check back shortly.</p>' +
        '<blockquote>' + esc(manualRevision.request).replace(/\n/g, '<br>') + '</blockquote>' +
        manualRevisionLogHtml(project) + '</div>';
      return;
    }
    if (project.oversizedSource && project.sourcePreparationStatus !== 'ready') {
      var sourceFailed = project.sourcePreparationStatus === 'error';
      var sourceHeading = sourceFailed ? 'Large recording needs attention' :
        project.sourcePreparationStatus === 'compacting' ? 'Building a faster editing master…' : 'Securing this large recording…';
      var sourceMessage = sourceFailed ? project.sourcePreparationError :
        project.sourcePreparationStatus === 'compacting'
          ? 'The untouched original is safe in R2. We are creating a much smaller high-quality working copy so transcript edits and preview rebuilds do not have to process the massive OBS file.'
          : 'This recording is over 6 GiB, so its untouched original is being archived to R2 before local editing begins.';
      workspace.innerHTML = '<div class="editor-processing"><div class="editor-processing-icon' + (sourceFailed ? ' error' : '') + '">' + (sourceFailed ? '!' : '') + '</div>' +
        '<h2>' + sourceHeading + '</h2><p>' + esc(sourceMessage) + '</p>' + processingStepsHtml(project) +
        (sourceFailed ? '<button class="btn-primary" id="editorSourceRetry">Retry large recording preparation</button><button type="button" class="editor-delete" id="editorDeleteFailed">Delete recording</button>' : '') + '</div>';
      if (sourceFailed) workspace.querySelector('#editorDeleteFailed').onclick = function () { deleteCurrentRecording(this); };
      if (sourceFailed) workspace.querySelector('#editorSourceRetry').onclick = function () {
        var button = workspace.querySelector('#editorSourceRetry');
        var retryProjectId = project.id;
        button.disabled = true;
        button.textContent = 'Retrying…';
        api('/api/editor/' + retryProjectId + '/source-preparation/retry', { method: 'POST' }).then(function () {
          if (!project || project.id !== retryProjectId) return;
          project.sourcePreparationStatus = 'queued';
          project.sourcePreparationError = '';
          renderWorkspace();
          schedulePoll();
        }).catch(function (error) {
          if (button.isConnected) { button.disabled = false; button.textContent = 'Retry large recording preparation'; }
          alert(error.message);
        });
      };
      return;
    }
    if (project.transcriptionStatus !== 'ready') {
      var isError = project.transcriptionStatus === 'error';
      workspace.innerHTML = '<div class="editor-processing"><div class="editor-processing-icon' + (isError ? ' error' : '') + '">' + (isError ? '!' : '') + '</div>' +
        '<h2>' + (isError ? 'Transcription needs attention' : 'Building the transcript…') + '</h2><p>' +
        esc(isError ? project.transcriptionError : 'We are finding every spoken word and its exact position in the recording.') + '</p>' +
        processingStepsHtml(project) +
        (isError ? '<button class="btn-primary" id="editorRetry">Retry transcription</button><button type="button" class="editor-delete" id="editorDeleteFailed">Delete recording</button>' : '') + '</div>';
      if (isError) workspace.querySelector('#editorDeleteFailed').onclick = function () { deleteCurrentRecording(this); };
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
    var suspectedMistakeIndices = new Set((project.retakeHighlights || []).flatMap(function (candidate) {
      return (candidate.removeWordIndices || []).map(Number);
    }));
    var activeRetakeHighlights = (project.retakeHighlights || []).filter(function (candidate) {
      return (candidate.removeWordIndices || []).some(function (index) { return !removed.has(Number(index)); });
    });
    var suspectedMistakeCount = activeRetakeHighlights.length;
    var highlightedWordIndices = Array.from(suspectedMistakeIndices).filter(function (index) { return !removed.has(index); });
    var clipsByWord = {};
    (project.insertedClips || []).forEach(function (clip) { (clipsByWord[clip.afterWordIndex] || (clipsByWord[clip.afterWordIndex] = [])).push(clip); });
    var paragraphStarts = new Set((project.transcriptParagraphStartIndices || []).map(Number));
    var transcriptHtml = '';
    (project.words || []).forEach(function (word, position) {
      if (position === 0 || paragraphStarts.has(Number(word.index))) transcriptHtml += (position ? '</p>' : '') + '<p class="editor-transcript-paragraph">';
      var markers = (clipsByWord[word.index] || []).map(function (clip) { return '<span class="editor-clip-marker" title="Inserted from ' + esc(clip.sourceUrl || 'planning clip') + '">CLIP</span> '; }).join('');
      transcriptHtml += '<span class="editor-word' + (removed.has(word.index) ? ' removed' : '') + (suspectedMistakeIndices.has(Number(word.index)) && !removed.has(word.index) ? ' suspected-mistake' : '') + (word.originalText ? ' corrected' : '') + '" data-index="' + word.index + '" data-start="' + word.start + '" data-end="' + word.end + '"' + (word.originalText ? ' title="Originally transcribed as: ' + esc(word.originalText) + '"' : suspectedMistakeIndices.has(Number(word.index)) ? ' title="Possible mistake or retake. Review before cutting."' : '') + '>' + esc(word.text) + '</span> ' + markers;
    });
    if ((project.words || []).length) transcriptHtml += '</p>';
    var reviewProjects = visibleProjectsForCurrentFilter();
    var reviewProjectIndex = reviewProjects.findIndex(function (item) { return item.id === project.id; });
    var cutSeconds = Math.max(0, Number(project.duration) - editedDuration(project));
    var layout = project.effectiveLayout || (Number(project.height) > Number(project.width) ? 'vertical' : 'horizontal');
    var automaticEditRunning = ['pending', 'running', 'pending_transcript'].indexOf(project.planningMatchStatus) !== -1 || ['queued', 'preparing'].indexOf(project.clipInsertStatus) !== -1;
    var automaticCutsPresent = project.autoSilenceEnabled !== false && (project.gapDecisions || []).some(function (gap) { return !gap.restored; });
    var framingFailureBlocks = framingFailureIsBlocking(project);
    var failedSafetyCheck = framingFailureBlocks;
    var renderBlocked = automaticEditRunning || failedSafetyCheck || project.layoutReviewRequired;
    var renderButtonText = automaticEditRunning ? 'Preparing automatic edit…' : framingFailureBlocks ? 'Retry framing or choose a frame' : project.layoutReviewRequired ? 'Confirm Vertical or Horizontal frame' : project.renderDirty ? 'Rebuild preview' : 'Build editing preview';
    var audioUnavailableText = audioUnavailableMessage(project);
    var rendering = ['queued', 'running'].indexOf(project.renderStatus) !== -1;
    var previewRebuildPending = !!localPreviewRebuilds[project.id] || !!project.renderRebuildPending;
    var previewLocked = rendering || previewRebuildPending;
    var initialPreviewBuild = rendering && !project.renderDirty && !project.renderRebuildPending &&
      !project.renderSha256 && !project.lastRenderAt;
    var sentToProduction = !!project.productionPieceId;
    var failures = failedSteps(project);
    var previewMode = project.renderStatus === 'ready' && (!project.renderDirty || (previewModes[project.id] === 'final' && !explicitSourcePreviews[project.id])) &&
      !(previewModes[project.id] === 'source' && explicitSourcePreviews[project.id]) ? 'final' : 'source';
    // Dirty edits use the source media as a live cut-aware, captioned preview.
    // It is the untouched camera master only after an explicit Raw click.
    var previewingWorkingEdit = previewMode === 'source' && !explicitSourcePreviews[project.id];
    var browserSafeSource = project.browserPreviewRequired && project.browserPreviewStatus === 'ready';
    var sourcePreviewPreparing = previewMode === 'source' && project.browserPreviewRequired &&
      ['pending', 'running'].indexOf(project.browserPreviewStatus) !== -1;
    var mediaUnavailable = previewLocked || sourcePreviewPreparing;
    var sourcePreviewLabel = browserSafeSource ? 'Raw browser-safe copy · no edits/captions' : 'Raw original · no edits/captions';
    var previewVersion = previewMode === 'final'
      ? ((project.renderSha256 || project.lastRenderAt || project.updatedAt || '') + '-preview-' + (project.renderPreviewVersion || 0))
      : (browserSafeSource ? project.updatedAt : project.sourceSha256 || project.updatedAt || '');
    var previewUrl = previewMode === 'final'
      ? '/api/editor/' + encodeURIComponent(project.id) + '/render?inline=1&v=' + encodeURIComponent(previewVersion)
      : '/api/editor/' + encodeURIComponent(project.id) + '/source?v=' + encodeURIComponent(previewVersion);
    var previewSeek = Math.max(0, Number(previewSeekTimes[project.id]) || 0);
    var framingReadiness = '<i class="ready">Orientation detected</i>';
    var retakeReadiness = '<i class="ready">Mistakes edited manually</i>';
    var previewActionsHtml = '<div class="editor-preview-actions"><span class="editor-review-keys">Space play/pause · ←/→ 2s</span><label>Review speed<select id="editorReviewRate"' + (previewLocked ? ' disabled' : '') + '><option value="1"' + (reviewRate === 1 ? ' selected' : '') + '>1×</option><option value="1.25"' + (reviewRate === 1.25 ? ' selected' : '') + '>1.25×</option><option value="1.5"' + (reviewRate === 1.5 ? ' selected' : '') + '>1.5×</option><option value="2"' + (reviewRate === 2 ? ' selected' : '') + '>2×</option></select></label>' +
      (project.renderStatus === 'ready' ? '<button type="button" id="editorPreviewFinal" class="' + (previewMode === 'final' ? 'active' : '') + '"' + (previewLocked ? ' disabled' : '') + '>' + (project.renderDirty ? 'Previous preview' : 'Editing preview') + '</button>' +
        (project.renderDirty ? '<button type="button" id="editorPreviewWorking" class="' + (previewingWorkingEdit ? 'active' : '') + '"' + (previewLocked ? ' disabled' : '') + '>Working preview</button>' : '') +
        '<button type="button" id="editorPreviewSource" class="' + (previewMode === 'source' && !previewingWorkingEdit ? 'active' : '') + '"' + (previewLocked ? ' disabled' : '') + '>' + sourcePreviewLabel + '</button>' : '') + '</div>';
    var automaticControlsHtml = '<div class="editor-controls"><label class="editor-toggle"><input type="checkbox" id="editorAutoSilence" ' + (project.autoSilenceEnabled !== false ? 'checked' : '') + '><span></span>Remove long pauses</label>' +
      '<label class="editor-toggle"><input type="checkbox" id="editorCaptions" ' + (project.captionsEnabled !== false ? 'checked' : '') + '><span></span>Add yellow captions</label>' +
      '<label class="editor-toggle" title="Starts wide and gently settles to 112.5% on vertical and horizontal openings. Later vertical page-turn or inserted-clip reveals also settle to 112.5%; horizontal reveals settle to 125%. Horizontal openings use five seconds; every other move uses three."><input type="checkbox" id="editorOpeningPushIn" ' + (project.openingPushInEnabled !== false ? 'checked' : '') + '><span></span>Page-change camera zooms</label>' +
      '<label class="editor-mode">Pacing<select id="editorPacing"><option value="tight"' + (Number(project.silenceThresholdSeconds) < 0.85 ? ' selected' : '') + '>Tight</option><option value="natural"' + (Number(project.silenceThresholdSeconds || 1) >= 0.85 && Number(project.silenceThresholdSeconds || 1) < 1.3 ? ' selected' : '') + '>Natural</option><option value="gentle"' + (Number(project.silenceThresholdSeconds || 1) >= 1.3 ? ' selected' : '') + '>Gentle</option></select></label>' +
      '<button type="button" class="btn-secondary btn-tiny editor-clear-automation" id="editorClearAutomation" ' + (!automaticCutsPresent ? 'disabled' : '') + ' title="Restore every pause removed automatically. Manual transcript cuts stay intact.">Restore automatic pause cuts</button></div>';
    var audioSelectionReady = true;
    var manualRevisionPanelHtml = '<section class="editor-manual-panel"><div class="editor-manual-heading"><div><div class="eyebrow">Manual revision</div><h3>Tell me what to change</h3><span>Type or dictate a specific change. Include a timestamp when it helps.</span></div></div>' +
      (!sentToProduction ? '<textarea id="editorManualRevisionText" maxlength="4000" rows="3" placeholder="For example: Around 14 seconds, keep the tight zoom instead of pulling back."></textarea><div class="editor-manual-actions"><button type="button" class="btn-secondary btn-tiny" id="editorManualDictate">Dictate</button><button type="button" class="btn-primary btn-tiny" id="editorManualSubmit" disabled>Apply revision</button><span id="editorManualStatus" aria-live="polite"></span></div>' : '<p class="editor-manual-locked">This approved version is locked; its completed manual changes remain recorded below.</p>') +
      manualRevisionLogHtml(project) + '</section>';
    var rebuildPercent = Math.max(0, Math.min(99, Math.round(Number(project.renderProgress) || 0)));
    var rebuildLabel = project.renderStatus === 'running'
      ? (rebuildPercent >= 99 ? (initialPreviewBuild ? 'Finalising first preview…' : 'Finalising updated preview…') :
        (initialPreviewBuild ? 'Preparing first preview… ' : 'Rebuilding preview… ') + rebuildPercent + '%')
      : project.renderStatus === 'queued'
        ? (Number(project.renderQueuePosition) > 1
          ? (initialPreviewBuild ? 'First preview queued' : 'Preview rebuild queued') + ' · ' + (Number(project.renderQueuePosition) - 1) + ' recording(s) ahead'
          : (initialPreviewBuild ? 'First preview is next to prepare…' : 'Preview queued for rebuild…'))
        : project.renderStatus === 'error' ? 'Preview rebuild needs attention' : 'Preparing updated preview…';
    var rebuildFailed = project.renderStatus === 'error';
    var rebuildOverlayHtml = previewLocked
      ? '<div class="editor-preview-rebuild' + (rebuildFailed ? ' error' : '') + '" id="editorPreviewRebuild" role="status" aria-live="polite"><div class="editor-preview-rebuild-spinner">' + (rebuildFailed ? '!' : '') + '</div><strong id="editorPreviewRebuildLabel">' + rebuildLabel + '</strong><span>' + (rebuildFailed ? 'Playback remains locked because this file was not regenerated. Use Retry failed steps above.' : initialPreviewBuild ? 'No changes have been made. The first editable preview is being prepared from your new recording.' : 'Your latest edit is being applied. Playback will unlock when the regenerated preview is ready.') + '</span>' + (rebuildFailed ? '' : '<div><i id="editorPreviewRebuildBar" style="width:' + (project.renderStatus === 'running' ? Math.max(2, rebuildPercent) : 4) + '%"></i></div>') + '</div>'
      : '';
    var sourcePreparingOverlayHtml = sourcePreviewPreparing
      ? '<div class="editor-preview-rebuild" id="editorSourcePreviewPreparing" role="status" aria-live="polite"><div class="editor-preview-rebuild-spinner"></div><strong>Preparing browser-safe preview…</strong><span>This is actively encoding. Playback will unlock automatically; your camera master and editing controls remain available.</span><div><i style="width:4%"></i></div></div>'
      : '';
    var initialLoadingOverlayHtml = mediaUnavailable ? '' : '<div class="editor-preview-loading" id="editorPreviewLoading" role="status" aria-live="polite"><div></div><strong>Loading preview…</strong></div>';
    var rawSourceNoticeHtml = previewMode === 'source' && !!explicitSourcePreviews[project.id]
      ? '<div class="editor-raw-source-notice">Raw original · cuts, captions and animations are not shown</div>'
      : '';
    var previewPlayerHtml = '<div class="editor-preview' + (mediaUnavailable ? ' rebuilding' : '') + '" id="editorPreview" tabindex="' + (mediaUnavailable ? '-1' : '0') + '" aria-busy="' + (mediaUnavailable ? 'true' : 'false') + '" aria-label="Video review. Space plays or pauses. Left and right arrows move two seconds."><div class="editor-video-frame ' + layout + '"><video id="editorVideo" data-preview-mode="' + previewMode + '" data-seek-time="' + previewSeek.toFixed(3) + '" playsinline preload="auto"' + (mediaUnavailable ? '' : ' src="' + previewUrl + '"') + '></video>' + rawSourceNoticeHtml +
      '<div class="editor-preview-outro" id="editorPreviewOutro" aria-hidden="true"></div>' +
      '<div class="editor-caption" id="editorCaption"></div>' +
      '<div class="editor-player-controls" id="editorPlayerControls"><button type="button" class="editor-player-icon" id="editorPlayerPlay" aria-label="Play" disabled>▶</button><span id="editorPlayerCurrent">0:00</span><input type="range" id="editorPlayerSeek" min="0" max="1" step="0.01" value="0" aria-label="Video position" disabled><span id="editorPlayerDuration">' + formatTime(previewMode === 'final' ? editedDuration(project) : project.duration) + '</span><i id="editorPlayerBuffering" hidden>Loading</i><button type="button" class="editor-player-icon" id="editorPlayerMute" aria-label="Mute" disabled>VOL</button><button type="button" class="editor-player-icon" id="editorPlayerFullscreen" aria-label="Full screen" disabled>⛶</button></div>' +
      '<div class="editor-video-error" id="editorVideoError" hidden><strong>Preview could not be played</strong><span>Your recording and edit are safe. Reload this review copy without rebuilding anything.</span><button type="button" class="btn-secondary btn-tiny" id="editorReloadVideo">Reload preview</button></div>' + initialLoadingOverlayHtml + rebuildOverlayHtml + sourcePreparingOverlayHtml + '</div></div>';
    var previewStageHtml = layout === 'vertical'
      ? '<div class="editor-preview-stage vertical"><aside class="editor-preview-side editor-preview-side-playback"><div class="eyebrow">Playback</div><h3>Review</h3>' + previewActionsHtml + '</aside>' + previewPlayerHtml + '<aside class="editor-preview-side editor-preview-side-settings"><div class="eyebrow">Edit settings</div><h3>Automatic treatment</h3>' + automaticControlsHtml + '</aside></div>'
      : '<div class="editor-preview-stage horizontal">' + previewPlayerHtml + '</div>';
    workspace.innerHTML =
      '<div class="editor-topbar"><div><h2>' + esc(displayName(project)) + '</h2><span>' + (project.planningPieceTitle ? esc(project.name) + ' · ' : '') + formatTime(project.duration) + ' original · ' + formatTime(editedDuration(project)) + ' edited · ' + cutSeconds.toFixed(1) + 's removed' + (formatBytes(project.sizeBytes) ? ' · ' + formatBytes(project.sizeBytes) + ' source' : '') + '</span></div>' +
        '<div class="editor-topbar-actions"><div class="editor-project-nav"><button type="button" class="btn-secondary btn-tiny" id="editorPreviousProject" ' + (reviewProjectIndex <= 0 ? 'disabled' : '') + '>← Previous</button><span id="editorProjectPosition">' + (reviewProjectIndex >= 0 ? (reviewProjectIndex + 1) + ' of ' + reviewProjects.length : '') + '</span><button type="button" class="btn-secondary btn-tiny" id="editorNextProject" ' + (reviewProjectIndex < 0 || reviewProjectIndex >= reviewProjects.length - 1 ? 'disabled' : '') + '>Next →</button></div>' +
          (!sentToProduction ? '<button type="button" class="btn-secondary btn-tiny" id="editorToggleTimeline" ' + (previewLocked ? 'disabled' : '') + '>' + (manualTimelineOpen[project.id] ? 'Hide timeline' : 'Show timeline') + '</button>' : '') +
          (!sentToProduction && project.renderStatus === 'ready' && !project.renderDirty && !previewLocked ? '<button type="button" class="btn-primary btn-tiny editor-quick-approve" data-editor-approve ' + (!audioSelectionReady ? 'disabled title="Choose backing audio first"' : '') + '>Approve &amp; next</button>' : '') +
          '<span class="editor-save-state ' + esc(saveStates[project.id] || '') + '" id="editorSaveState">' + ({ saving: 'Saving…', saved: 'Saved', error: 'Save failed' }[saveStates[project.id]] || '') + '</span><button class="editor-delete" id="editorDelete">' + (sentToProduction ? 'Remove Editor files' : 'Delete recording') + '</button></div></div>' +
      (previewLocked ? '<div class="editor-lock-notice"><strong>' + (initialPreviewBuild ? 'Preparing the first preview' : 'Preview is rebuilding') + '</strong><span>' + (initialPreviewBuild ? 'This is initial processing—not a change you made. Playback will unlock when the first verified preview is ready.' : 'Playback is locked until the updated file has encoded and passed verification.') + '</span></div>' : '') +
      (project.renderDirty && !previewLocked ? '<div class="editor-lock-notice"><strong>Transcript edits saved</strong><span>Keep cutting mistakes, then press Rebuild preview once when you are finished.</span></div>' : '') +
      (project.browserPreviewRequired && ['pending', 'running'].indexOf(project.browserPreviewStatus) !== -1 && previewMode === 'source' ? '<div class="editor-lock-notice"><strong>Preparing a browser-safe source preview</strong><span>The camera master is preserved and final editing continues. This view will switch to H.264 automatically when ready.</span></div>' : '') +
      (sentToProduction ? '<div class="editor-lock-notice approved"><strong>Approved version locked</strong><span>The exact reviewed file is now in Content Production. Source and final previews remain available here.</span></div>' : '') +
      (failures.length ? '<div class="editor-error-recovery"><div><strong>' + failures.join(', ') + ' need' + (failures.length === 1 ? 's' : '') + ' attention</strong><span>Retry the failed automatic work without changing the source recording or your edit decisions.</span></div><button type="button" class="btn-secondary btn-tiny" id="editorRetryFailed">Retry failed steps</button></div>' : '') +
      (project.workflowWarning ? '<div class="editor-workflow-warning"><strong>Video workflow needs attention</strong><span>' + esc(project.workflowWarning) + '</span></div>' : '') +
      (layout === 'horizontal' ? '<div class="editor-preview-toolbar">' + previewActionsHtml + '</div>' : '') +
      previewStageHtml +
      (!sentToProduction ? manualTimelineHtml(project, previewLocked) : '') +
      manualRevisionPanelHtml +
      '<section class="editor-automation"><div class="editor-automation-head"><div><div class="eyebrow">Automatic edit</div><h3>Speech and pause map</h3></div><div class="editor-legend"><span class="speech">Speech</span><span class="cut">Removed pause</span><span class="pause">Kept pause</span></div></div>' + timelineHtml(project) +
        (layout === 'horizontal' ? automaticControlsHtml : '') + '</section>' +
      '<section class="editor-transcript-panel"><div class="editor-transcript-head"><div><div class="eyebrow">Transcript editor</div><h3>Select words to cut footage</h3></div>' +
        '<div class="editor-transcript-actions"><button class="btn-secondary btn-tiny" id="editorUndo" ' + (!project.canUndoCut ? 'disabled' : '') + '>Undo last decision</button><button class="btn-secondary btn-tiny" id="editorPlaySelection" disabled>Play selected</button>' +
        '<button class="btn-secondary btn-tiny editor-insert-clip" id="editorInsertClip" disabled>Insert clip here</button>' +
        '<button class="btn-secondary btn-tiny" id="editorCorrect" disabled>Correct word</button><button class="btn-secondary btn-tiny" id="editorRestore" disabled>Restore selected</button></div></div>' +
        '<div class="editor-sticky-cut"><button type="button" class="btn-primary btn-tiny" id="editorCut" disabled>Cut selected</button></div>' +
        '<div class="editor-transcript-review-note ' + esc(project.retakeAnalysisStatus || 'unavailable') + '"><span>' +
          (['pending', 'running', 'pending_transcript'].indexOf(project.retakeAnalysisStatus) !== -1 ? 'Scanning for likely mistakes and retakes…' :
            project.retakeAnalysisStatus === 'error' ? 'The highlight scan was unavailable. You can still edit the full transcript normally.' :
            suspectedMistakeCount ? '<strong>' + suspectedMistakeCount + ' earlier ' + (suspectedMistakeCount === 1 ? 'take' : 'takes') + ' highlighted.</strong> Check the amber text, then remove all suggestions in one step.' :
            'No active mistake or retake highlights remain. Review the transcript normally.') + '</span><button type="button" class="btn-primary btn-tiny" id="editorRemoveHighlights" ' + (!highlightedWordIndices.length || rendering || sentToProduction ? 'disabled' : '') + '>Remove highlighted sections</button></div>' +
        '<div class="editor-correction-tray" id="editorCorrectionTray" hidden><div><strong>Correct caption word</strong><span id="editorCorrectionNote">Timing stays exactly where it is.</span><em id="editorCorrectionError" hidden></em></div><input id="editorCorrectionInput" maxlength="40" autocomplete="off" aria-label="Corrected caption word"><div><button type="button" class="btn-secondary btn-tiny" id="editorCorrectionCancel">Cancel</button><button type="button" class="btn-secondary btn-tiny" id="editorCorrectionOriginal" hidden>Use original</button><button type="button" class="btn-primary btn-tiny" id="editorCorrectionSave">Save correction</button></div></div>' +
        '<div class="editor-transcript' + (rendering || sentToProduction ? ' locked' : '') + '" id="editorTranscript" tabindex="0">' + transcriptHtml + '</div>' +
        ((project.insertedClips || []).length ? '<div class="editor-inserted-clips">' + (project.insertedClips || []).map(function (clip) { return '<div><span><strong>' + (clip.status === 'ready' ? 'Inserted clip' : 'Preparing clip…') + '</strong>' + esc(clip.transcriptText || clip.quote || clip.sourceUrl) + '</span><button type="button" class="btn-secondary btn-tiny editor-remove-clip" data-clip-id="' + esc(clip.id) + '" ' + (clip.status !== 'ready' ? 'disabled' : '') + '>Remove</button></div>'; }).join('') + '</div>' : '') +
        (project.clipInsertStatus === 'error' ? '<div class="editor-clip-error">' + esc(project.clipInsertError || 'The clip could not be prepared.') + '</div>' : '') +
        '<p class="editor-selection-hint">Select the word a clip should follow, or drag across words to cut footage. Press Delete to cut, Ctrl/⌘ Z to undo, or Escape to clear.</p></section>' +
      '<div class="editor-export"><div><strong>Next: Content Production</strong><span>' +
        (project.productionPieceId ? 'This edit is ready in Content Production for titles and thumbnail selection.' :
          project.renderStatus === 'ready' && !project.renderDirty ? 'Send the finished edit across without uploading it again. Backing audio is chosen in Content Production.' : project.renderDirty ? 'Your transcript cuts are saved. Rebuild the preview once when you have finished removing mistakes.' :
          'Build the editing preview first. Yellow captions will be baked in below center.') + '</span>' +
        '<div class="editor-readiness"><i class="ready">Transcript ready</i>' + framingReadiness + retakeReadiness + (project.renderStatus === 'ready' && !project.renderDirty ? '<i class="ready">Output verified</i>' : project.renderDirty ? '<i class="review">Preview needs rebuild</i>' : '') + '</div>' +
        (['queued', 'running'].indexOf(project.renderStatus) !== -1 ? '<div class="editor-render-progress"><span id="editorRenderProgressLabel">' + (project.renderStatus === 'queued' ? (Number(project.renderQueuePosition) > 1 ? (Number(project.renderQueuePosition) - 1) + ' recording(s) ahead in the preview queue' : 'Next in the preview queue') : 'Encoding editing preview · ' + Math.round(Number(project.renderProgress) || 0) + '%') + '</span><div><i id="editorRenderProgressBar" style="width:' + (project.renderStatus === 'queued' ? 4 : Math.max(2, Number(project.renderProgress) || 0)) + '%"></i></div></div>' : '') +
        (project.renderStatus === 'error' ? '<em>' + esc(project.renderError) + '</em>' : '') + '</div><div class="editor-export-actions">' +
        (project.productionPieceId ? '<button class="btn-primary" id="editorOpenProduction">Open Content Production</button>' :
          project.renderStatus === 'ready' && !project.renderDirty ? '<button class="btn-primary" id="editorSendProduction" data-editor-approve ' + (!audioSelectionReady || previewLocked ? 'disabled title="Wait for the updated preview before approval"' : '') + '>Approve &amp; Send to Production</button>' :
          '<button class="btn-primary" id="editorRender" ' + (['queued', 'running'].indexOf(project.renderStatus) !== -1 || renderBlocked ? 'disabled' : '') + '>' + (project.renderStatus === 'queued' ? 'Waiting in preview queue…' : project.renderStatus === 'running' ? 'Building editing preview… ' + Math.round(Number(project.renderProgress) || 0) + '%' : renderButtonText) + '</button>') +
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
    var previewingOriginalMaster = !previewingFinal && !!explicitSourcePreviews[project.id];
    var previewingWorkingEdit = !previewingFinal && !previewingOriginalMaster;
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
    var manualText = root.querySelector('#editorManualRevisionText');
    var manualSubmit = root.querySelector('#editorManualSubmit');
    var manualDictate = root.querySelector('#editorManualDictate');
    var manualStatus = root.querySelector('#editorManualStatus');
    // Backing-audio auditioning belongs to Content Production. Keeping this
    // null makes Editor playback use the verified voice-only render and, most
    // importantly, prevents opening a recording from generating 30 mixes.
    var audioBatch = null;
    var playerScrubbing = false;
    var resumeAfterScrub = false;
    var scrubResumeToken = 0;
    var bufferingTimer = null;
    var synchronizedStartToken = 0;
    var synchronizedStartInProgress = false;
    function setManualStatus(text, failed) {
      if (!manualStatus) return;
      manualStatus.textContent = text || '';
      manualStatus.className = failed ? 'error' : '';
    }
    if (manualText && manualSubmit) {
      manualText.addEventListener('input', function () { manualSubmit.disabled = !manualText.value.trim() || !!manualRevisionRecorder; });
      manualSubmit.onclick = function () {
        if (manualRevisionRecorder) return;
        var request = manualText.value.trim();
        if (!request) return;
        manualSubmit.disabled = true;
        if (manualDictate) manualDictate.disabled = true;
        setManualStatus('Queuing revision…');
        api('/api/editor/' + encodeURIComponent(project.id) + '/manual-revisions', {
          method: 'POST', body: JSON.stringify({ request: request })
        }).then(function (updated) {
          project = updated;
          projectDetails[updated.id] = updated;
          projects = projects.map(function (item) { return item.id === updated.id ? updated : item; });
          renderList(); renderWorkspace(); schedulePoll();
        }).catch(function (error) {
          manualSubmit.disabled = false;
          if (manualDictate) manualDictate.disabled = false;
          setManualStatus(error.message, true);
        });
      };
    }
    if (manualDictate) manualDictate.onclick = function () {
      if (manualRevisionRecorder && manualRevisionRecorder.state === 'recording') {
        manualRevisionRecorder.stop();
        manualDictate.disabled = true;
        manualDictate.textContent = 'Transcribing…';
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
        setManualStatus('Voice dictation is not supported in this browser.', true);
        return;
      }
      setManualStatus('Opening microphone…');
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        var chunks = [];
        manualRevisionStream = stream;
        manualRevisionRecorder = new MediaRecorder(stream);
        manualRevisionRecorder.ondataavailable = function (event) { if (event.data && event.data.size) chunks.push(event.data); };
        manualRevisionRecorder.onstop = function () {
          var type = manualRevisionRecorder.mimeType || 'audio/webm';
          var blob = new Blob(chunks, { type: type });
          if (manualRevisionStream) manualRevisionStream.getTracks().forEach(function (track) { track.stop(); });
          manualRevisionStream = null; manualRevisionRecorder = null;
          var form = new FormData(); form.append('audio', blob, 'revision.webm');
          fetch('/api/voice/transcribe', { method: 'POST', credentials: 'same-origin', body: form }).then(function (response) {
            if (!response.ok) throw new Error('Could not transcribe that recording.');
            return response.json();
          }).then(function (body) {
            var dictated = String(body.text || '').trim();
            if (dictated) manualText.value = (manualText.value.trim() ? manualText.value.trim() + ' ' : '') + dictated;
            manualText.dispatchEvent(new Event('input', { bubbles: true }));
            manualDictate.disabled = false; manualDictate.textContent = 'Dictate'; setManualStatus(dictated ? 'Dictation added.' : 'No speech was detected.', !dictated);
          }).catch(function (error) {
            manualDictate.disabled = false; manualDictate.textContent = 'Dictate'; setManualStatus(error.message, true);
          });
        };
        manualRevisionRecorder.start();
        manualSubmit.disabled = true;
        manualDictate.textContent = 'Stop & transcribe';
        setManualStatus('Listening…');
      }).catch(function () { setManualStatus('Microphone access was not available.', true); });
    };
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
      // Seeking back to zero can momentarily drop readyState below HAVE_CURRENT_DATA
      // even though this browser-safe preview is already loaded. `play()` is
      // designed to wait for data; returning here instead made soundtrack
      // switches intermittently stop before either clock had started.
      if (previewLocked) return Promise.resolve();
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
        if (token !== synchronizedStartToken) return;
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
      // `HTMLMediaElement.src` is resolved to an absolute URL while our
      // preview map stores a relative one. Comparing the property made every
      // repaint look like a track change, reloaded the same audio, and aborted
      // the play promise started by the dropdown gesture. Compare the literal
      // attribute instead so a selected track is loaded exactly once.
      var sourceChanged = mixedAudio.getAttribute('src') !== url;
      if (sourceChanged) {
        mixedAudio.pause();
        mixedAudio.setAttribute('src', url);
        mixedAudio.load();
      }
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
      options.push('<option value="__none__">No backing audio</option>');
      ready.forEach(function (track) { options.push('<option value="' + esc(track.id) + '" title="' + esc(track.note || '') + '">' + esc(track.name) + '</option>'); });
      if (project.audioTrackId && project.audioTrackId !== '__none__' && !ready.some(function (track) { return track.id === project.audioTrackId; })) {
        var pendingTrack = audioTracks.find(function (track) { return track.id === project.audioTrackId; });
        options.push('<option value="' + esc(project.audioTrackId) + '" disabled>' + esc(pendingTrack ? pendingTrack.name + ' · preparing…' : 'Selected track unavailable') + '</option>');
      }
      audioTrackSelect.innerHTML = options.join('');
      audioTrackSelect.value = project.audioTrackId || '__none__';
      if (previewLocked) {
        audioTrackSelect.disabled = true;
        audioProgress.className = 'editor-audio-progress loading';
        audioProgress.querySelector('span').textContent = 'Available when the updated preview is ready';
      } else if (project.renderStatus !== 'ready') {
        audioTrackSelect.disabled = true;
        audioProgress.className = 'editor-audio-progress';
        audioProgress.querySelector('span').textContent = audioUnavailableMessage(project);
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
    video.addEventListener('timeupdate', function () { updateReviewPlayheads(currentSourcePlayhead()); });
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
    var toggleTimelineButton = root.querySelector('#editorToggleTimeline');
    if (toggleTimelineButton) toggleTimelineButton.onclick = function () {
      var openingTimeline = !manualTimelineOpen[project.id];
      manualTimelineOpen[project.id] = openingTimeline;
      previewSeekTimes[project.id] = Number(video.currentTime) || 0;
      if (openingTimeline) manualTimelineViewStates[project.id] = { sourceTime: currentSourcePlayhead(), center: true };
      storeReviewProgress(project.id, currentSourcePlayhead());
      renderWorkspace();
    };
    var manualTimelineViewport = root.querySelector('#editorManualTimelineViewport');
    var manualTimelineInner = root.querySelector('#editorManualTimelineInner');
    var manualTimelinePlayhead = root.querySelector('#editorManualPlayhead');
    function currentSourcePlayhead() {
      return previewingFinal ? editedToSourceTime(video.currentTime, project) : Number(video.currentTime) || 0;
    }
    function updateManualTimelinePlayhead(sourceTime) {
      if (!manualTimelinePlayhead) return;
      var duration = Math.max(0.01, Number(project.duration) || 0.01);
      manualTimelinePlayhead.style.left = Math.max(0, Math.min(100, Number(sourceTime) / duration * 100)).toFixed(5) + '%';
    }
    function updateReviewPlayheads(sourceTime) {
      updateManualTimelinePlayhead(sourceTime);
      var automaticPlayhead = root.querySelector('#editorPlayhead');
      if (!automaticPlayhead || !project.duration) return;
      automaticPlayhead.style.left = Math.max(0, Math.min(100, Number(sourceTime) / Number(project.duration) * 100)).toFixed(5) + '%';
    }
    function seekManualTimeline(sourceTime) {
      var clamped = Math.max(0, Math.min(Number(project.duration) || 0, Number(sourceTime) || 0));
      var target = previewingFinal ? sourceToEditedTime(clamped, project.cuts || [], project) : clamped;
      try { video.currentTime = Math.max(0, Math.min(Number(video.duration) || target, target)); } catch (error) {}
      updateManualTimelinePlayhead(clamped);
      syncPlayerControls();
    }
    function preserveTimelinePlaybackPosition() {
      previewSeekTimes[project.id] = Number(video.currentTime) || 0;
      previewAutoplay[project.id] = !video.paused && !video.ended;
      if (manualTimelineViewport) {
        manualTimelineViewStates[project.id] = {
          sourceTime: currentSourcePlayhead(),
          scrollLeft: manualTimelineViewport.scrollLeft
        };
      }
    }
    function restoreManualTimelineView() {
      if (!manualTimelineViewport || !manualTimelineInner) return;
      var state = manualTimelineViewStates[project.id];
      if (!state) return;
      delete manualTimelineViewStates[project.id];
      var restoreProjectId = project.id;
      requestAnimationFrame(function () {
        if (!project || project.id !== restoreProjectId || !manualTimelineViewport.isConnected) return;
        var maximum = Math.max(0, manualTimelineInner.scrollWidth - manualTimelineViewport.clientWidth);
        if (state.scrollLeft !== null && state.scrollLeft !== undefined && Number.isFinite(Number(state.scrollLeft))) {
          manualTimelineViewport.scrollLeft = Math.max(0, Math.min(maximum, Number(state.scrollLeft)));
          return;
        }
        var duration = Math.max(0.01, Number(project.duration) || 0.01);
        var playheadX = Math.max(0, Math.min(1, Number(state.sourceTime) / duration)) * manualTimelineInner.scrollWidth;
        manualTimelineViewport.scrollLeft = Math.max(0, Math.min(maximum, playheadX - manualTimelineViewport.clientWidth / 2));
      });
    }
    if (manualTimelineViewport && manualTimelineInner) {
      var pageChangeMenu = root.querySelector('#editorPageChangeMenu');
      var selectedPageChangeKey = '';
      function showPageChangeMenu(key, clientX, clientY) {
        if (!pageChangeMenu || previewLocked || !key) return;
        selectedPageChangeKey = key;
        pageChangeMenu.hidden = false;
        pageChangeMenu.style.left = Math.max(8, Math.min(window.innerWidth - 220, clientX)) + 'px';
        pageChangeMenu.style.top = Math.max(8, Math.min(window.innerHeight - 54, clientY)) + 'px';
      }
      manualTimelineInner.addEventListener('contextmenu', function (event) {
        var marker = event.target.closest('.editor-page-change-marker');
        var editable = event.target.closest('.editor-manual-cut-editable');
        var key = marker && marker.dataset.pageCutKey;
        if (!key && editable) key = pageChangeCutKey({ id: editable.dataset.cutId, start: Number(editable.dataset.cutStart), end: Number(editable.dataset.cutEnd) });
        if (editable && (project.pageChangeCutIds || []).indexOf(key) === -1) {
          var cutStart = Number(editable.dataset.cutStart);
          var cutEnd = Number(editable.dataset.cutEnd);
          var matchingPageCut = (project.cuts || []).find(function (cut) {
            return cut.start <= cutEnd && cut.end >= cutStart && (project.pageChangeCutIds || []).indexOf(pageChangeCutKey(cut)) !== -1;
          });
          if (matchingPageCut) key = pageChangeCutKey(matchingPageCut);
        }
        if (!key || (project.pageChangeCutIds || []).indexOf(key) === -1 || previewLocked) return;
        event.preventDefault();
        showPageChangeMenu(key, event.clientX, event.clientY);
      });
      var removePageChange = root.querySelector('#editorRemovePageChange');
      if (removePageChange) removePageChange.onclick = function () {
        var key = selectedPageChangeKey;
        pageChangeMenu.hidden = true;
        if (!key) return;
        preserveTimelinePlaybackPosition();
        save(function (latest) {
          return { suppressedPageChangeCutKeys: Array.from(new Set((latest.suppressedPageChangeCutKeys || []).concat([key]))) };
        }).then(function (item) {
          if (item) showEditorActionFeedback('Page-turn zoom + fade removed here · video cut kept');
        });
      };
      manualTimelineInner.onclick = function (event) {
        var pageMarker = event.target.closest('.editor-page-change-marker');
        if (pageMarker) {
          event.preventDefault();
          event.stopPropagation();
          showPageChangeMenu(pageMarker.dataset.pageCutKey, event.clientX, event.clientY);
          return;
        }
        if (pageChangeMenu) pageChangeMenu.hidden = true;
        var segment = event.target.closest('.editor-manual-segment');
        var rect = manualTimelineInner.getBoundingClientRect();
        var sourceTime = Math.max(0, Math.min(Number(project.duration) || 0,
          (event.clientX - rect.left) / Math.max(1, rect.width) * (Number(project.duration) || 0)));
        if (segment) {
          var start = Number(segment.dataset.start);
          var end = Number(segment.dataset.end);
          manualTimelineSelections[project.id] = { start: start, end: end };
          manualTimelineInner.querySelectorAll('.editor-manual-segment').forEach(function (node) { node.classList.toggle('selected', node === segment); });
          var deleteButton = root.querySelector('#editorTimelineDelete');
          if (deleteButton) {
            deleteButton.disabled = manualTimelineSplitsFor(project).length === 0;
            deleteButton.textContent = 'Delete ' + (end - start).toFixed(2) + 's section';
          }
          sourceTime = start;
        }
        seekManualTimeline(sourceTime);
      };
      manualTimelineViewport.addEventListener('wheel', function (event) {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        var oldWidth = manualTimelineInner.offsetWidth;
        var cursorX = event.clientX - manualTimelineViewport.getBoundingClientRect().left;
        var anchor = (manualTimelineViewport.scrollLeft + cursorX) / Math.max(1, oldWidth);
        var duration = Math.max(0.01, Number(project.duration) || 0.01);
        var displayedZoom = oldWidth / duration;
        var currentZoom = Math.max(8, Math.min(180, Math.max(Number(manualTimelineZoom[project.id]) || 14, displayedZoom)));
        var nextZoom = Math.max(8, Math.min(180, currentZoom * (event.deltaY < 0 ? 1.25 : 0.8)));
        manualTimelineZoom[project.id] = nextZoom;
        var nextWidth = Math.max(manualTimelineViewport.clientWidth, Math.round(duration * nextZoom));
        manualTimelineInner.style.width = nextWidth + 'px';
        manualTimelineViewport.scrollLeft = Math.max(0, anchor * nextWidth - cursorX);
        var label = root.querySelector('#editorTimelineZoomLabel');
        if (label) label.textContent = nextZoom.toFixed(0) + ' px/sec';
      }, { passive: false });

      manualTimelineInner.querySelectorAll('.editor-manual-cut-handle').forEach(function (handle) {
        handle.onclick = function (event) { event.preventDefault(); event.stopPropagation(); };
        handle.onpointerdown = function (event) {
          if (event.button !== undefined && event.button !== 0) return;
          var editable = handle.closest('.editor-manual-cut-editable');
          var cutId = editable && editable.dataset.cutId;
          var origin = editable && editable.dataset.cutOrigin;
          var sourceCut = (project.editableTimelineCuts || []).find(function (cut) {
            return cut.id === cutId && cut.editableOrigin === origin;
          });
          if (!editable || !sourceCut) return;
          event.preventDefault();
          event.stopPropagation();
          var edge = handle.dataset.cutEdge;
          var duration = Math.max(0.01, Number(project.duration) || 0.01);
          var originalStart = Number(sourceCut.start);
          var originalEnd = Number(sourceCut.end);
          var nextStart = originalStart;
          var nextEnd = originalEnd;
          var minimumCut = 0.04;
          editable.classList.add('dragging');
          handle.setPointerCapture(event.pointerId);

          function updateFromPointer(pointerEvent) {
            var rect = manualTimelineInner.getBoundingClientRect();
            var sourceTime = Math.max(0, Math.min(duration, (pointerEvent.clientX - rect.left) / Math.max(1, rect.width) * duration));
            if (edge === 'start') {
              nextStart = Math.min(originalEnd - minimumCut, sourceTime);
              if (project.endingProtectionEnabled === true && (cutId === 'tail' || /^adjusted-tail-/.test(cutId)) && project.words && project.words.length) {
                var lastWordEnd = Number(project.words[project.words.length - 1].end) || 0;
                nextStart = Math.min(originalEnd - minimumCut, Math.max(lastWordEnd + 0.08, Math.min(lastWordEnd + 0.25, nextStart)));
              }
            }
            else nextEnd = Math.max(originalStart + minimumCut, sourceTime);
            nextStart = Number(Math.max(0, nextStart).toFixed(3));
            nextEnd = Number(Math.min(duration, nextEnd).toFixed(3));
            editable.style.left = (nextStart / duration * 100).toFixed(5) + '%';
            editable.style.width = (Math.max(minimumCut, nextEnd - nextStart) / duration * 100).toFixed(5) + '%';
            editable.title = (origin === 'automatic' ? 'Automatic' : 'Manual') + ' cut ' + formatTime(nextStart) + '–' + formatTime(nextEnd);
          }

          function removeDragListeners() {
            window.removeEventListener('pointermove', updateFromPointer);
            window.removeEventListener('pointerup', finishDrag);
            window.removeEventListener('pointercancel', cancelDrag);
            editable.classList.remove('dragging');
          }

          function finishDrag(pointerEvent) {
            removeDragListeners();
            try { handle.releasePointerCapture(event.pointerId); } catch (error) {}
            if (pointerEvent) updateFromPointer(pointerEvent);
            if (Math.abs(nextStart - originalStart) < 0.001 && Math.abs(nextEnd - originalEnd) < 0.001) return;
            preserveTimelinePlaybackPosition();
            previewSeekTimes[project.id] = edge === 'start' ? nextStart : nextEnd;
            storeReviewProgress(project.id, previewSeekTimes[project.id]);
            save(function (latest) {
              var trims = (latest.manualTrimCuts || []).slice();
              var restored = (latest.restoredAutoCutIds || []).slice();
              if (origin === 'automatic') {
                if (restored.indexOf(cutId) === -1) restored.push(cutId);
                trims.unshift({ id: 'adjusted-' + cutId + '-' + Date.now().toString(36), start: nextStart, end: nextEnd, note: 'Adjusted automatic timeline cut' });
              } else {
                trims = trims.map(function (cut) {
                  return cut.id === cutId ? Object.assign({}, cut, { start: nextStart, end: nextEnd }) : cut;
                });
              }
              return { manualTrimCuts: trims, restoredAutoCutIds: restored };
            }).then(function (item) {
              if (item) showEditorActionFeedback('Cut edge moved · now ' + formatTime(nextStart) + '–' + formatTime(nextEnd));
            });
          }

          function cancelDrag() {
            removeDragListeners();
            editable.style.left = (originalStart / duration * 100).toFixed(5) + '%';
            editable.style.width = ((originalEnd - originalStart) / duration * 100).toFixed(5) + '%';
          }

          window.addEventListener('pointermove', updateFromPointer);
          window.addEventListener('pointerup', finishDrag);
          window.addEventListener('pointercancel', cancelDrag);
        };
      });
    }
    var addTimelineSplit = root.querySelector('#editorTimelineAddSplit');
    if (addTimelineSplit) addTimelineSplit.onclick = function () {
      var time = Number(currentSourcePlayhead().toFixed(3));
      if (time <= 0.02 || time >= Number(project.duration) - 0.02) return;
      var splits = manualTimelineSplitsFor(project);
      if (!splits.some(function (value) { return Math.abs(value - time) < 0.02; })) splits.push(time);
      splits.sort(function (a, b) { return a - b; });
      storeManualTimelineSplits(project, splits);
      delete manualTimelineSelections[project.id];
      preserveTimelinePlaybackPosition();
      renderWorkspace();
    };
    var clearTimelineSplits = root.querySelector('#editorTimelineClearSplits');
    if (clearTimelineSplits) clearTimelineSplits.onclick = function () {
      storeManualTimelineSplits(project, []);
      delete manualTimelineSelections[project.id];
      preserveTimelinePlaybackPosition();
      renderWorkspace();
    };
    var deleteTimelineSection = root.querySelector('#editorTimelineDelete');
    if (deleteTimelineSection) deleteTimelineSection.onclick = function () {
      var selection = manualTimelineSelections[project.id];
      if (!selection || selection.end - selection.start < 0.02) return;
      var cutProjectId = project.id;
      var removedSeconds = selection.end - selection.start;
      preserveTimelinePlaybackPosition();
      delete manualTimelineSelections[cutProjectId];
      deleteTimelineSection.disabled = true;
      deleteTimelineSection.textContent = 'Applying cut…';
      var cutRequest = save(function (latest) {
        var trims = (latest.manualTrimCuts || []).slice();
        trims.unshift({ id: 'timeline-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8), start: selection.start, end: selection.end, note: 'Deleted from manual timeline' });
        return { manualTrimCuts: trims };
      });
      previewModes[cutProjectId] = 'source';
      delete explicitSourcePreviews[cutProjectId];
      previewSeekTimes[cutProjectId] = selection.start;
      storeReviewProgress(cutProjectId, selection.start);
      cutRequest.then(function (item) {
        if (!item) return;
        showEditorActionFeedback('Cut applied · ' + removedSeconds.toFixed(2) + 's removed');
      });
    };
    if (manualTimelineViewport && deleteTimelineSection) manualTimelineViewport.addEventListener('keydown', function (event) {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (deleteTimelineSection.disabled || !manualTimelineSelections[project.id]) return;
      event.preventDefault();
      deleteTimelineSection.click();
    });
    updateManualTimelinePlayhead(currentSourcePlayhead());
    restoreManualTimelineView();
    video.playbackRate = reviewRate;
    var videoError = root.querySelector('#editorVideoError');
    video.addEventListener('loadeddata', function () {
      setInitialPlayerLoading(false);
      if (videoError) videoError.hidden = true;
      if (mediaRecoveryChecks[videoProjectId]) clearTimeout(mediaRecoveryChecks[videoProjectId]);
      delete mediaRecoveryChecks[videoProjectId];
      var sourceTime = previewingFinal ? editedToSourceTime(video.currentTime, project) : video.currentTime;
      updatePreviewMotion(sourceTime);
      updateReviewPlayheads(sourceTime);
      syncPlayerControls();
    });
    // A cached review proxy can already have a decoded frame before the
    // workspace finishes binding its listeners. Do not leave the loading
    // cover up forever merely because `loadeddata` won that race.
    if (video.readyState >= 2) setInitialPlayerLoading(false);
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
    var previewOutro = root.querySelector('#editorPreviewOutro');
    function isLongformVideo() {
      return (project.effectiveLayout || 'horizontal') === 'horizontal';
    }
    var motionAnimationFrame = null;
    function updatePreviewMotion(sourcePlayheadTime) {
      var openingScale = 1;
      if (previewingWorkingEdit && project.openingPushInEnabled !== false) {
        var motion = cameraMotionState(sourcePlayheadTime, project);
        var openingProgress = Math.max(0, Math.min(1, motion.elapsed / motion.duration));
        var initialOpening = Math.abs(motion.resetAt) <= 0.001;
        var targetScale = initialOpening
          ? ((project.effectiveLayout || 'horizontal') === 'horizontal' ? HORIZONTAL_OPENING_CAMERA_SCALE : VERTICAL_OPENING_CAMERA_SCALE)
          : ((project.effectiveLayout || 'horizontal') === 'vertical' ? VERTICAL_REVEAL_CAMERA_SCALE : RESTING_CAMERA_SCALE);
        openingScale = 1 + (targetScale - 1) * openingProgress * openingProgress * (3 - 2 * openingProgress);
      }
      var width = video.clientWidth || 0;
      var height = video.clientHeight || 0;
      var offsetX = width * (1 - openingScale) * 0.5;
      var offsetY = height * (1 - openingScale) * 0.5;
      video.style.transform = openingScale > 1.0001 ? 'matrix(' + openingScale.toFixed(5) + ',0,0,' + openingScale.toFixed(5) + ',' + offsetX.toFixed(3) + ',' + offsetY.toFixed(3) + ')' : '';
      video.style.transformOrigin = '0 0';
      var overlayOpacity = 0;
      if (previewingWorkingEdit) {
        var confirmedPageChanges = new Set((project.pageChangeCutIds || []).map(String));
        (project.cuts || []).forEach(function (cut) {
          if (!confirmedPageChanges.has(pageChangeCutKey(cut))) return;
          if (sourcePlayheadTime >= cut.start - PAGE_CHANGE_FADE_SECONDS && sourcePlayheadTime < cut.start) {
            overlayOpacity = Math.max(overlayOpacity,
              (sourcePlayheadTime - (cut.start - PAGE_CHANGE_FADE_SECONDS)) / PAGE_CHANGE_FADE_SECONDS);
          } else if (sourcePlayheadTime >= cut.start && sourcePlayheadTime <= cut.end) {
            overlayOpacity = 1;
          } else if (sourcePlayheadTime > cut.end && sourcePlayheadTime <= cut.end + PAGE_CHANGE_FADE_SECONDS) {
            overlayOpacity = Math.max(overlayOpacity,
              1 - (sourcePlayheadTime - cut.end) / PAGE_CHANGE_FADE_SECONDS);
          }
        });
        var trailingCut = (project.cuts || []).filter(function (cut) {
          return cut.end >= video.duration - 0.02;
        })[0];
        if (trailingCut && sourcePlayheadTime >= trailingCut.start) {
          var outroFadeSeconds = Number(project.outroFadeSeconds) > 0 ? Number(project.outroFadeSeconds) : (isLongformVideo() ? 1.7 : 2);
          overlayOpacity = Math.max(overlayOpacity, Math.max(0, Math.min(1,
            (sourcePlayheadTime - trailingCut.start) / Math.max(0.01, outroFadeSeconds))));
        }
      }
      if (previewOutro) previewOutro.style.opacity = Math.max(0, Math.min(1, overlayOpacity)).toFixed(3);
    }
    function animatePreviewMotion() {
      if (!video.isConnected || !project || project.id !== videoProjectId) {
        motionAnimationFrame = null;
        return;
      }
      var sourceTime = previewingFinal ? editedToSourceTime(video.currentTime, project) : video.currentTime;
      updatePreviewMotion(sourceTime);
      updateReviewPlayheads(sourceTime);
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
      // startPlayerPlayback deliberately pauses the old picture before it
      // starts the replacement soundtrack. The resulting asynchronous pause
      // event must not abort that new audio play request.
      if (mixedPreviewActive() && !synchronizedStartInProgress) mixedAudio.pause();
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
        storeReviewProgress(videoProjectId, sourcePlayheadTime);
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
      updateReviewPlayheads(sourcePlayheadTime);
      if (previewingFinal || previewingOriginalMaster) {
        caption.classList.remove('visible');
        return;
      }
      if (!previewingOriginalMaster) {
        var trailingCut = (project.cuts || []).filter(function (item) {
          return item.end >= video.duration - 0.02;
        })[0];
        if (trailingCut && video.currentTime >= trailingCut.start) {
          // The exported edit holds the final retained frame and fades it to
          // black. Keep the lightweight source preview moving through its
          // remaining tail while reproducing that fade, instead of freezing
          // the player just before its displayed end time.
          caption.classList.remove('visible');
          return;
        }
        var cut = (project.cuts || []).filter(function (item) { return video.currentTime >= item.start && video.currentTime < item.end; })[0];
        if (cut && cut.end < video.duration - 0.02) { video.currentTime = cut.end + 0.01; return; }
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
        if (phraseScale < 1) caption.style.fontSize = (2.05 * phraseScale).toFixed(2) + 'cqw';
        group.words.forEach(function (word, index) {
          // Whitespace at the end of an inline-block is collapsed away, so
          // putting the separator inside the preceding word joined every
          // horizontal caption into one unreadable string. Keep each word as
          // its own emphasis target and insert a real text node between them.
          if (index) caption.appendChild(document.createTextNode(' '));
          var span = document.createElement('span');
          span.textContent = window.RealityCaptionMask.maskCaption(word.text);
          var emphasisEnd = index + 1 < group.words.length ? group.words[index + 1].sourceStart : group.sourceEnd;
          span.className = video.currentTime >= word.sourceStart && video.currentTime < emphasisEnd ? 'active' : '';
          caption.appendChild(span);
        });
      } else if (group && Array.isArray(group.words)) {
        var spokenIndex = group.words.findIndex(function (word, index) {
          var wordEnd = index + 1 < group.words.length ? group.words[index + 1].sourceStart : group.sourceEnd;
          return video.currentTime >= word.sourceStart && video.currentTime < wordEnd;
        });
        if (spokenIndex !== -1) {
          // Match the rendered vertical caption's three-word windows: keep
          // the whole window visible while emphasis follows the spoken word.
          var windowStart = Math.floor(spokenIndex / 3) * 3;
          var windowWords = group.words.slice(windowStart, windowStart + 3);
          var characters = Array.from(windowWords.map(function (word) { return word.text; }).join(' ')).length;
          var fit = Math.max(0.36, Math.min(1, 18 / Math.max(18, characters)));
          caption.style.fontSize = (8 * fit).toFixed(2) + 'cqw';
          windowWords.forEach(function (word, index) {
            if (index) caption.appendChild(document.createTextNode(' '));
            var span = document.createElement('span');
            span.textContent = window.RealityCaptionMask.maskCaption(word.text);
            span.className = windowStart + index === spokenIndex ? 'active' : '';
            caption.appendChild(span);
          });
        }
      } else if (group) caption.textContent = window.RealityCaptionMask.maskCaption(group.text);
      caption.classList.toggle('visible', !!group && project.captionsEnabled !== false);
    });
    video.addEventListener('pause', persistCurrentReviewProgress);
    video.addEventListener('seeked', persistCurrentReviewProgress);
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
        if (project.renderStatus === 'ready' && !project.renderDirty && !previewingFinal) {
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
    var workingPreviewButton = root.querySelector('#editorPreviewWorking');
    if (workingPreviewButton) workingPreviewButton.onclick = function () {
      previewSeekTimes[project.id] = previewingFinal ? editedToSourceTime(video.currentTime, project) : video.currentTime;
      delete explicitSourcePreviews[project.id];
      previewModes[project.id] = 'source'; renderWorkspace();
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
    var removeHighlightsButton = root.querySelector('#editorRemoveHighlights');
    if (removeHighlightsButton) removeHighlightsButton.onclick = function () {
      var alreadyRemoved = new Set((project.removedWordIndices || []).map(Number));
      var recommendationIndices = Array.from(new Set((project.retakeHighlights || []).flatMap(function (candidate) {
        return (candidate.removeWordIndices || []).map(Number);
      }))).filter(function (index) { return !alreadyRemoved.has(index); });
      if (!recommendationIndices.length) return;
      removeHighlightsButton.disabled = true;
      removeHighlightsButton.textContent = 'Removing…';
      save(function (latest) {
        var next = new Set((latest.removedWordIndices || []).map(Number));
        recommendationIndices.forEach(function (index) { next.add(index); });
        return { removedWordIndices: Array.from(next).sort(function (a, b) { return a - b; }) };
      }).then(function (item) {
        if (!item) return;
        editorNotice = 'Highlighted earlier takes were removed. Make any other transcript cuts, then rebuild the preview once.';
        renderNotice();
      });
    };
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
    var timelineUndo = root.querySelector('#editorTimelineUndo');
    if (timelineUndo) timelineUndo.onclick = undo;
    var timelineFadeSeconds = root.querySelector('#editorTimelineFadeSeconds');
    if (timelineFadeSeconds) timelineFadeSeconds.onchange = function () {
      var seconds = Number(this.value);
      if (!Number.isFinite(seconds) || seconds < 0.3 || seconds > 4) {
        alert('Fade to black must be between 0.3 and 4 seconds.');
        renderWorkspace();
        return;
      }
      save({ outroFadeSeconds: seconds });
    };
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
    root.querySelector('#editorPacing').onchange = function () {
      var settings = { tight: [0.7, 0.10], natural: [1, 0.24], gentle: [1.5, 0.32] }[this.value] || [1, 0.24];
      save({ silenceThresholdSeconds: settings[0], retainedPauseSeconds: settings[1] }, true);
    };
    var clearAutomation = root.querySelector('#editorClearAutomation');
    if (clearAutomation) clearAutomation.onclick = function () {
      save(function (latest) {
        return {
          autoSilenceEnabled: false,
          removedWordIndices: (latest.removedWordIndices || []).map(Number)
        };
      }, true).then(function (item) {
        if (!item) return;
        editorNotice = 'Automatic pause cuts were restored. Manual transcript cuts were preserved, and Undo is available.';
        renderNotice();
      });
    };
    var renderButton = root.querySelector('#editorRender');
    if (renderButton) renderButton.onclick = function () {
        var renderProjectId = project.id;
        var wasRebuild = !!project.renderDirty;
        persistCurrentReviewProgress();
        renderButton.disabled = true;
        renderButton.textContent = wasRebuild ? 'Starting preview rebuild…' : 'Starting editing preview…';
        retryTransientOnce(function () {
          return api('/api/editor/' + renderProjectId + '/render', { method: 'POST' });
        }, 500).then(function () {
          if (!project || project.id !== renderProjectId) return;
          project.renderStatus = 'running'; renderWorkspace(); schedulePoll();
        }).catch(function (error) {
          if (renderButton.isConnected) { renderButton.disabled = false; renderButton.textContent = wasRebuild ? 'Rebuild preview' : 'Build editing preview'; }
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
        if (typeof window.__rmRegisterEditorHandoff === 'function') window.__rmRegisterEditorHandoff(result);
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
    root.querySelector('#editorDelete').onclick = function () { deleteCurrentRecording(this); };
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
    });
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
      schedulePoll();
      if (project && project.id === id) {
        project = item;
        if (!options.skipWorkspaceRender) renderWorkspace();
        else {
          var stateNode = root.querySelector('#editorSaveState');
          if (stateNode) { stateNode.className = 'editor-save-state saved'; stateNode.textContent = 'Saved'; }
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
    var renderKeys = ['removedWordIndices', 'manualTrimCuts', 'wordCorrection', 'autoSilenceEnabled', 'restoredAutoCutIds', 'captionsEnabled', 'suppressedPageChangeCutKeys', 'outroFadeSeconds',
      'layoutOverride', 'openingPushInEnabled', 'silenceThresholdSeconds', 'retainedPauseSeconds'];
    var renderWillChange = typeof patch === 'function' || renderKeys.some(function (key) {
      return patch && Object.prototype.hasOwnProperty.call(patch, key);
    });
    if (renderWillChange) releaseAudioPreviewBatch(id);
    rememberPlaybackBeforeEdit(id, renderWillChange);
    if (renderWillChange) {
      previewModes[id] = 'source';
      delete explicitSourcePreviews[id];
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
    }, options || {});
  }

  window.RMEditor = {
    unmount: function () {
      persistCurrentReviewProgress();
      stopManualRevisionDictation();
      clearTimeout(pollTimer);
      clearTimeout(desktopUploaderPollTimer);
      clearTimeout(editorActionFeedbackTimer);
      root = null;
    },
    mount: function (element) {
      stopManualRevisionDictation();
      mountToken++;
      openRequestToken++;
      pendingExplicitOpenToken = 0;
      clearTimeout(pollTimer);
      clearTimeout(desktopUploaderPollTimer);
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
      if (project) { restoreReviewProgress(project); renderWorkspace(); }
      var expectedMountToken = mountToken;
      pollDesktopUploaderStatus(expectedMountToken);
      loadProjects(expectedMountToken).catch(function (error) {
        if (expectedMountToken !== mountToken || !editorMounted()) return;
        var workspace = root && root.querySelector('#editorWorkspace');
        if (workspace) workspace.innerHTML = '<div class="editor-empty"><strong>Editor unavailable</strong><span>' + esc(error.message) + '</span></div>';
      });
    }
  };

})();
