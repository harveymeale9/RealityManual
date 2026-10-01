'use strict';

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const STORE_NAME = 'editorProjects';
const MAX_UPLOAD_BYTES = Math.floor(4.5 * 1024 * 1024 * 1024);
const EDITOR_UPLOAD_CHUNK_BYTES = 16 * 1024 * 1024;
const EDITOR_UPLOAD_SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const EDIT_RENDER_DEBOUNCE_MS = 2500;
const EDITOR_DISK_RESERVE_BYTES = 2 * 1024 * 1024 * 1024;
const PAGE_ZOOM_SECONDS = 3;
const HORIZONTAL_OPENING_ZOOM_SECONDS = 5;
const PAGE_CHANGE_CUT_SECONDS = 3;
// Footage is deliberately recorded wide enough to show a little table. The
// opening move settles into a tight book-first framing and that 125%
// composition remains the baseline for the rest of the shot. Substantial
// automatic long-pause cuts are treated as page changes and start the move
// again from the wide camera frame.
const OPENING_PUSH_IN_SCALE = 1.25;
const EDITOR_RENDER_VERSION = 13;
const BROWSER_PREVIEW_VERSION = 2;
const AUDIO_PREVIEW_MIX_VERSION = 3;
const AUDIO_PREVIEW_TTL_MS = 2 * 60 * 60 * 1000;

function requiredEditorCapacity(fileBytes, fileAlreadyStored) {
  const bytes = Math.max(0, Number(fileBytes) || 0);
  // Source, source scrub proxy, Editor render, final-render scrub proxy,
  // Production copy, and the later mixed final can coexist. The proxies are
  // much smaller, but capacity admission deliberately assumes the safe worst
  // case rather than gambling on compression ratios.
  return EDITOR_DISK_RESERVE_BYTES + bytes * (fileAlreadyStored ? 5 : 6);
}

function outstandingEditorCapacity(projects) {
  return (Array.isArray(projects) ? projects : []).reduce(function (total, project) {
    if (!project || project.productionPieceId) return total;
    const bytes = Math.max(0, Number(project.sizeBytes) || 0);
    let copies = 2; // Production handoff plus its later soundtrack/final copy.
    if (project.renderStatus !== 'ready') copies += 2;
    if (project.browserPreviewRequired && project.browserPreviewStatus !== 'ready') copies++;
    return total + bytes * copies;
  }, 0);
}

function createByteReservationLedger() {
  const reservations = new Map();
  return {
    reserve: function (bytes) {
      const token = crypto.randomUUID();
      reservations.set(token, Math.max(0, Number(bytes) || 0));
      return token;
    },
    release: function (token) { return reservations.delete(token); },
    total: function () {
      let bytes = 0;
      reservations.forEach(function (value) { bytes += value; });
      return bytes;
    }
  };
}

function createKeyedClaimRegistry() {
  const claims = new Map();
  return {
    claim: function (key) {
      const existing = claims.get(key);
      if (existing) return { owner: false, result: existing.promise };
      let settle;
      const promise = new Promise(function (resolve) { settle = resolve; });
      const entry = { promise: promise };
      claims.set(key, entry);
      let finished = false;
      return {
        owner: true,
        result: promise,
        settle: function (value) {
          if (finished) return false;
          finished = true;
          if (claims.get(key) === entry) claims.delete(key);
          settle(value);
          return true;
        }
      };
    },
    size: function () { return claims.size; }
  };
}

function createPriorityTaskQueue() {
  const urgent = [];
  const normal = [];
  let running = false;
  function pump() {
    if (running) return;
    const entry = urgent.shift() || normal.shift();
    if (!entry) return;
    running = true;
    Promise.resolve().then(entry.task).then(entry.resolve, entry.reject).finally(function () {
      running = false;
      pump();
    });
  }
  return {
    enqueue: function (task, priority) {
      return new Promise(function (resolve, reject) {
        (priority === 'urgent' ? urgent : normal).push({ task: task, resolve: resolve, reject: reject });
        setImmediate(pump);
      });
    }
  };
}

function createConcurrentTaskQueue(limit) {
  const waiting = [];
  let running = 0;
  limit = Math.max(1, Math.floor(Number(limit) || 1));
  function pump() {
    while (running < limit && waiting.length) {
      const entry = waiting.shift();
      running++;
      Promise.resolve().then(entry.task).then(entry.resolve, entry.reject).finally(function () {
        running--;
        pump();
      });
    }
  }
  return {
    enqueue: function (task) {
      return new Promise(function (resolve, reject) {
        waiting.push({ task: task, resolve: resolve, reject: reject });
        setImmediate(pump);
      });
    }
  };
}

async function verifiedRenderMatches(project, filePath) {
  if (!project || project.renderStatus !== 'ready' || !project.renderQuality || project.renderQuality.status !== 'passed') return false;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 1024 || stat.size !== Number(project.renderSizeBytes) || !project.renderSha256) return false;
    return await hashFile(filePath) === project.renderSha256;
  } catch (error) { return false; }
}

function run(command, args, label) {
  return new Promise(function (resolve, reject) {
    execFile(command, args, { maxBuffer: 20 * 1024 * 1024 }, function (err, stdout, stderr) {
      if (err) return reject(new Error(label + ' failed: ' + String(stderr || err.message).slice(-2000)));
      resolve({ stdout: stdout, stderr: stderr });
    });
  });
}

function runWithProgress(command, args, label, onProgress) {
  return new Promise(function (resolve, reject) {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', function (chunk) {
      stdout += chunk;
      const lines = stdout.split(/\r?\n/); stdout = lines.pop() || '';
      lines.forEach(function (line) {
        const match = line.match(/^out_time_us=(\d+)$/);
        if (match && typeof onProgress === 'function') onProgress(Number(match[1]) / 1000000);
      });
    });
    child.stderr.on('data', function (chunk) { stderr = (stderr + chunk).slice(-20000); });
    child.on('error', function (error) { reject(new Error(label + ' failed: ' + error.message)); });
    child.on('close', function (code) {
      if (code !== 0) return reject(new Error(label + ' failed: ' + stderr.slice(-2000)));
      resolve();
    });
  });
}

function clipTimestampSeconds(value) {
  const parts = String(value || '').trim().split(':').map(Number);
  if (!parts.length || parts.some(function (part) { return !Number.isFinite(part) || part < 0; }) || parts.length > 3) return NaN;
  return parts.reduce(function (total, part) { return total * 60 + part; }, 0);
}

function parseInsertClipDirectives(notesHtml) {
  const text = String(notesHtml || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p\s*>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, '&').replace(/&nbsp;/gi, ' ');
  const pattern = /INSERT\s+CLIP\s*:\s*(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s,]+)\s+(\d+(?::\d+){1,2}(?:\.\d+)?)\s*-\s*(\d+(?::\d+){1,2}(?:\.\d+)?)(?:\s*,?\s*[“"]([^”"\n]+)[”"])?/gi;
  const directives = [];
  let match;
  while ((match = pattern.exec(text))) {
    const start = clipTimestampSeconds(match[2]);
    const end = clipTimestampSeconds(match[3]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 60) continue;
    const sourceUrl = match[1].replace(/[.)\]]+$/, '');
    directives.push({
      id: crypto.createHash('sha256').update([sourceUrl, start, end, match.index].join('|')).digest('hex').slice(0, 16),
      sourceUrl: sourceUrl, sourceStart: start, sourceEnd: end, duration: end - start,
      quote: String(match[4] || '').trim()
    });
  }
  return directives;
}

function approximateWords(text, duration) {
  const tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
  const step = Math.max(0.08, Math.max(0, Number(duration) || 0) / Math.max(1, tokens.length));
  return tokens.map(function (token, index) {
    return { index: index, text: token, start: index * step, end: Math.min(Number(duration) || step, (index + 1) * step) };
  });
}

function hashFile(filePath) {
  return new Promise(function (resolve, reject) {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', function (chunk) { hash.update(chunk); });
    stream.on('error', reject);
    stream.on('end', function () { resolve(hash.digest('hex')); });
  });
}

function parseMaxVolume(stderr) {
  const matches = String(stderr || '').match(/max_volume:\s*(-?inf|-?\d+(?:\.\d+)?)\s*dB/ig) || [];
  if (!matches.length) return -Infinity;
  const value = matches[matches.length - 1].match(/(-?inf|-?\d+(?:\.\d+)?)/i);
  if (!value || /inf/i.test(value[1])) return -Infinity;
  return Number(value[1]);
}

function renderDurationTolerance(expectedSeconds) {
  return Math.max(0.35, Math.min(1.5, Math.max(0, Number(expectedSeconds) || 0) * 0.01));
}

async function cleanStaleTempFiles(directory, olderThanMs, nowMs) {
  const cutoff = (Number(nowMs) || Date.now()) - Math.max(60000, Number(olderThanMs) || 24 * 60 * 60 * 1000);
  let entries;
  try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); }
  catch (error) { return 0; }
  let removed = 0;
  await Promise.all(entries.filter(function (entry) { return entry.isFile(); }).map(async function (entry) {
    const filePath = path.join(directory, entry.name);
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.mtimeMs >= cutoff) return;
      await fs.promises.rm(filePath, { force: true });
      removed++;
    } catch (error) {}
  }));
  return removed;
}

function cleanOrphanedEditorTempFiles(directory) {
  let entries;
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
  catch (error) { return 0; }
  let removed = 0;
  entries.filter(function (entry) {
    return entry.isFile() && (/^editor-upload-/.test(entry.name) || /^editor-.+\.mp3$/.test(entry.name));
  }).forEach(function (entry) {
    try { fs.rmSync(path.join(directory, entry.name), { force: true }); removed++; }
    catch (error) {}
  });
  return removed;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function normalizeWorkingTitle(value) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^["'`]+|["'`]+$/g, '').slice(0, 80).trim();
}

function displayDimensions(width, height, rotation) {
  width = Number(width) || 0;
  height = Number(height) || 0;
  rotation = Number(rotation) || 0;
  const quarterTurn = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  return quarterTurn ? { width: height, height: width } : { width: width, height: height };
}

function normalizedVideoMimeType(fileName, reportedType) {
  const reported = String(reportedType || '').toLowerCase();
  if (reported.startsWith('video/')) return reported;
  const extension = path.extname(String(fileName || '')).toLowerCase();
  return ({
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.m4v': 'video/x-m4v',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo'
  })[extension] || 'video/mp4';
}

function browserPreviewNeeded(fileName, media) {
  // Every camera master gets a small, densely-keyframed editing proxy. Codec
  // compatibility alone is not enough: a browser-playable 4K H.264 file can
  // still seek very slowly when its keyframes are far apart.
  return true;
}

function normalizeWords(rawWords) {
  return (Array.isArray(rawWords) ? rawWords : []).filter(function (word) {
    return word && word.type === 'word' && Number.isFinite(Number(word.start)) &&
      Number.isFinite(Number(word.end)) && Number(word.end) > Number(word.start) && String(word.text || '').trim();
  }).map(function (word, index) {
    return {
      index: index,
      text: String(word.text || '').trim(),
      start: Math.max(0, Number(word.start)),
      end: Math.max(0, Number(word.end))
    };
  });
}

// Natural mode keeps 380ms between phrases. It removes only the middle of a
// gap, so consonants, breaths and deliberate sentence cadence retain handles.
function calculateAutoCuts(words, duration, options) {
  options = options || {};
  const threshold = clamp(options.thresholdSeconds === undefined ? 1.0 : options.thresholdSeconds, 0.65, 5);
  const retainedPause = clamp(options.retainedPauseSeconds === undefined ? 0.38 : options.retainedPauseSeconds, 0.18, threshold - 0.05);
  const cuts = [];
  if (!words.length || !Number.isFinite(Number(duration)) || Number(duration) <= 0) return cuts;
  const total = Number(duration);
  const lead = words[0].start;
  if (lead > 0.45) cuts.push({ id: 'lead', start: 0, end: Math.max(0, lead - 0.18), reason: 'leading_silence' });
  for (let i = 0; i < words.length - 1; i++) {
    const gapStart = words[i].end;
    const gapEnd = words[i + 1].start;
    const gap = gapEnd - gapStart;
    if (gap <= threshold) continue;
    const handle = retainedPause / 2;
    cuts.push({ id: 'gap-' + i, gapIndex: i, start: gapStart + handle, end: gapEnd - handle, reason: 'long_pause' });
  }
  const tail = total - words[words.length - 1].end;
  if (tail > 0.55) cuts.push({
    id: 'tail',
    start: Math.min(total, words[words.length - 1].end + 0.25),
    end: total,
    reason: 'trailing_silence'
  });
  return cuts.filter(function (cut) { return cut.end - cut.start >= 0.08; });
}

function calculateManualCuts(words, removedWordIndices, duration) {
  const removed = new Set((Array.isArray(removedWordIndices) ? removedWordIndices : [])
    .map(Number).filter(function (index) { return Number.isInteger(index) && index >= 0 && index < words.length; }));
  const cuts = [];
  let index = 0;
  while (index < words.length) {
    if (!removed.has(index)) { index++; continue; }
    const first = index;
    while (index + 1 < words.length && removed.has(index + 1)) index++;
    const last = index;
    const previousEnd = first > 0 && !removed.has(first - 1) ? words[first - 1].end : 0;
    const nextStart = last + 1 < words.length && !removed.has(last + 1) ? words[last + 1].start : Number(duration);
    const start = Math.max(previousEnd + (first > 0 ? 0.02 : 0), words[first].start - 0.06, 0);
    const end = Math.min(nextStart - (last + 1 < words.length ? 0.02 : 0), words[last].end + 0.10, Number(duration));
    if (end > start) cuts.push({ start: start, end: end, reason: 'transcript_cut' });
    index++;
  }
  return cuts;
}

function mergeCuts(cuts, duration) {
  const total = Math.max(0, Number(duration) || 0);
  const sorted = (cuts || []).map(function (cut) {
    return { id: cut.id || '', start: clamp(cut.start, 0, total), end: clamp(cut.end, 0, total), reason: cut.reason || 'cut' };
  }).filter(function (cut) { return cut.end > cut.start; })
    .sort(function (a, b) { return a.start - b.start || a.end - b.end; });
  const merged = [];
  sorted.forEach(function (cut) {
    const previous = merged[merged.length - 1];
    if (!previous || cut.start > previous.end + 0.015) return merged.push(Object.assign({}, cut));
    previous.end = Math.max(previous.end, cut.end);
    if (previous.reason !== cut.reason) previous.reason = 'combined';
    if (previous.id !== cut.id) previous.id = '';
  });
  return merged;
}

function cutsForProject(project) {
  const restored = new Set(Array.isArray(project.restoredAutoCutIds) ? project.restoredAutoCutIds : []);
  const auto = project.autoSilenceEnabled === false ? [] : calculateAutoCuts(project.words || [], project.duration, {
    thresholdSeconds: project.silenceThresholdSeconds,
    retainedPauseSeconds: project.retainedPauseSeconds
  }).filter(function (cut) { return !restored.has(cut.id); });
  const manual = calculateManualCuts(project.words || [], project.removedWordIndices || [], project.duration);
  return mergeCuts(auto.concat(manual), project.duration);
}

function sourceLayout(project) {
  return Number(project && project.height) > Number(project && project.width) ? 'vertical' : 'horizontal';
}

function effectiveLayout(project) {
  if (project && (project.layoutOverride === 'vertical' || project.layoutOverride === 'horizontal')) return project.layoutOverride;
  return sourceLayout(project);
}

function layoutReviewRequired(project) {
  return false;
}

function blockingReviewFailure(project) {
  if (project && project.retakeAnalysisStatus === 'error') {
    return 'The automatic retake check failed. Retry it before building the final edit.';
  }
  return '';
}

function automaticReviewReady(project) {
  if (!project || project.transcriptionStatus !== 'ready') return false;
  if (['queued', 'preparing'].includes(project.clipInsertStatus)) return false;
  if (!['ready', 'unavailable'].includes(project.retakeAnalysisStatus)) return false;
  // Planning linkage controls workflow bookkeeping, never the safety or bytes
  // of the video. A failed matcher must remain visible and retryable without
  // turning an otherwise finished automatic edit into manual babysitting.
  if (!['ready', 'unavailable', 'error'].includes(project.planningMatchStatus)) return false;
  return unresolvedRetakeCount(project) === 0 && !layoutReviewRequired(project);
}

function contentTypeForProject(project, cuts) {
  if (project && ['ultra_short', 'short', 'long_short', 'longform'].includes(project.contentTypeOverride)) return project.contentTypeOverride;
  if (effectiveLayout(project) === 'horizontal') return 'longform';
  const duration = Math.max(0, Number(project && project.duration) - (cuts || cutsForProject(project)).reduce(function (sum, cut) {
    return sum + Math.max(0, cut.end - cut.start);
  }, 0));
  if (duration <= 25) return 'ultra_short';
  if (duration <= 60) return 'short';
  return 'long_short';
}

function invalidateRender(project) {
  project.renderStatus = '';
  project.renderError = '';
  project.renderProgress = 0;
  project.automaticRenderStartedAt = '';
  project.renderQuality = null;
  project.renderSizeBytes = 0;
  project.renderSha256 = '';
  project.editedDuration = 0;
  return project;
}

function advanceEditRevision(project) {
  project.editRevision = Math.max(0, Number(project.editRevision) || 0) + 1;
  return project.editRevision;
}

function patchAffectsRender(body) {
  body = body && typeof body === 'object' ? body : {};
  return ['removedWordIndices', 'wordCorrection', 'autoSilenceEnabled', 'restoredAutoCutIds', 'captionsEnabled',
    'layoutOverride', 'openingPushInEnabled', 'silenceThresholdSeconds', 'retainedPauseSeconds'].some(function (key) {
    return Object.prototype.hasOwnProperty.call(body, key);
  });
}

function openingPushInScale(editedSeconds, durationSeconds) {
  const duration = Math.max(0.001, Number(durationSeconds) || PAGE_ZOOM_SECONDS);
  const progress = clamp((Number(editedSeconds) || 0) / duration, 0, 1);
  const eased = progress * progress * (3 - 2 * progress);
  return 1 + (OPENING_PUSH_IN_SCALE - 1) * eased;
}

function openingZoomExpression(elapsedStart, framesPerSecond, durationSeconds) {
  const frameOffset = (Math.max(0, Number(elapsedStart) || 0) * framesPerSecond).toFixed(6);
  const duration = Math.max(0.001, Number(durationSeconds) || PAGE_ZOOM_SECONDS);
  const progress = 'min(max((on+' + frameOffset + ')/(' + framesPerSecond.toFixed(8) + '*' + duration.toFixed(6) + '),0),1)';
  const eased = '(' + progress + '*' + progress + '*(3-2*' + progress + '))';
  return '(1+' + (OPENING_PUSH_IN_SCALE - 1).toFixed(3) + '*' + eased + ')';
}

function cameraResetStarts(cuts) {
  const resetStarts = [0];
  (cuts || []).forEach(function (cut) {
    if (cut.reason !== 'long_pause' && cut.reason !== 'combined') return;
    // Sentence pauses are also tightened automatically. Only a substantial
    // removed silence is a reliable voice-only signal that Harvey turned the
    // page; otherwise the camera would restart throughout ordinary speech.
    if (Number(cut.end) - Number(cut.start) < PAGE_CHANGE_CUT_SECONDS) return;
    const boundary = mapSourceTimeToEdited(cut.end, cuts);
    if (boundary > resetStarts[resetStarts.length - 1] + 0.001) resetStarts.push(boundary);
  });
  return resetStarts;
}

function cameraMotionState(sourceSeconds, cuts, layout) {
  const editedTime = mapSourceTimeToEdited(sourceSeconds, cuts || []);
  const resetStarts = cameraResetStarts(cuts || []);
  let resetAt = 0;
  resetStarts.forEach(function (candidate) { if (candidate <= editedTime + 0.001) resetAt = candidate; });
  return {
    editedTime: editedTime,
    resetAt: resetAt,
    elapsed: Math.max(0, editedTime - resetAt),
    duration: layout === 'horizontal' && resetAt === 0 ? HORIZONTAL_OPENING_ZOOM_SECONDS : PAGE_ZOOM_SECONDS
  };
}

function cameraMotionForSegment(segment, cuts, layout) {
  // Returning from an external full-screen excerpt is a new camera reveal,
  // just like returning after a page turn: begin on the completely wide book
  // frame, ease to the 125% base over three seconds, then hold. This must be
  // attached to the edit-decision segment rather than inferred from source
  // time, because the inserted clip advances the final timeline without
  // changing the camera recording's own timestamps.
  if (segment && segment.cameraResetAfterInsert) {
    const editedTime = mapSourceTimeToEdited(segment.start, cuts || []);
    return { editedTime: editedTime, resetAt: editedTime, elapsed: 0, duration: PAGE_ZOOM_SECONDS };
  }
  return cameraMotionState(segment && segment.start, cuts, layout);
}

// One high-quality fractional resampling stage handles the centred camera
// settle for each retained shot.
function cameraMotionFilter(options) {
  options = options || {};
  const openingEnabled = options.openingEnabled === true;
  if (!openingEnabled) return '';
  const renderShape = options.renderShape;
  const framesPerSecond = 30000 / 1001;
  const zoom = openingZoomExpression(options.elapsedStart, framesPerSecond, options.durationSeconds);
  // The open book sits left and slightly high in the fixed horizontal camera
  // setup. Bias the crop toward its measured centre so 125% keeps both page
  // edges visible instead of enlarging the surrounding desk. Portrait footage
  // is deliberately framed around its single page and remains centred.
  const horizontal = options.layout === 'horizontal';
  const x = '(iw-iw/' + zoom + ')*' + (horizontal ? '0.25' : '0.5');
  const y = '(ih-ih/' + zoom + ')*' + (horizontal ? '0.34' : '0.5');
  return ",zoompan=z='" + zoom + "':x='" + x + "':y='" + y + "':d=1:s=" +
    renderShape.width + 'x' + renderShape.height + ':fps=30000/1001,setsar=1';
}

function openingPushInFilter(renderShape, elapsedStart, durationSeconds) {
  return cameraMotionFilter({ renderShape: renderShape, elapsedStart: elapsedStart, durationSeconds: durationSeconds, openingEnabled: true });
}

function patchNeedsAutoRender(project, renderWillChange) {
  return !!renderWillChange || !project || !project.renderStatus;
}

function gapDecisions(project) {
  const words = project.words || [];
  const restored = new Set(Array.isArray(project.restoredAutoCutIds) ? project.restoredAutoCutIds : []);
  return calculateAutoCuts(words, project.duration, {
    thresholdSeconds: project.silenceThresholdSeconds,
    retainedPauseSeconds: project.retainedPauseSeconds
  }).map(function (cut) {
    return Object.assign({}, cut, {
      duration: Math.max(0, cut.end - cut.start),
      restored: restored.has(cut.id),
      label: cut.reason === 'leading_silence' ? 'Opening silence' : cut.reason === 'trailing_silence' ? 'Ending silence' : 'Pause after “' + String(words[cut.gapIndex] && words[cut.gapIndex].text || '').slice(0, 40) + '”'
    });
  });
}

function retakeCandidates(words) {
  const utterances = [];
  let current = [];
  function flush() {
    if (current.length) utterances.push(current);
    current = [];
  }
  (words || []).forEach(function (word, index) {
    const previous = current[current.length - 1];
    if (previous && word.start - previous.end > 0.85) flush();
    current.push(word);
    if (/[.!?]["'’”)]*$/.test(word.text)) flush();
    else if (index === words.length - 1) flush();
  });
  function clean(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9']/g, ''); }
  const output = [];
  for (let index = 0; index < utterances.length - 1; index++) {
    const first = utterances[index];
    const second = utterances[index + 1];
    if (first.length < 2 || second.length < 2 || second[0].start - first[first.length - 1].end > 5) continue;
    const a = first.map(function (word) { return clean(word.text); }).filter(Boolean);
    const b = second.map(function (word) { return clean(word.text); }).filter(Boolean);
    let prefix = 0;
    while (prefix < Math.min(a.length, b.length) && a[prefix] === b[prefix]) prefix++;
    const overlap = a.filter(function (token) { return b.includes(token); }).length / Math.max(a.length, b.length);
    const likelyRestart = prefix >= Math.min(3, a.length) && b.length > a.length;
    const closeRepeat = overlap >= 0.68;
    if (!likelyRestart && !closeRepeat) continue;
    output.push({
      id: 'retake-' + index,
      removeWordIndices: first.map(function (word) { return word.index; }),
      firstText: first.map(function (word) { return word.text; }).join(' '),
      replacementText: second.map(function (word) { return word.text; }).join(' '),
      confidence: likelyRestart && overlap >= 0.5 ? 'high' : 'review',
      reason: likelyRestart ? 'The next take begins the same way and continues further.' : 'These adjacent lines substantially repeat one another.'
    });
  }
  return output;
}

function normalizeRetakeDecisions(raw, words) {
  const claimedRemovalIndices = new Set();
  const ordered = (Array.isArray(raw) ? raw : []).map(function (decision, index) {
    return { decision: decision, index: index };
  }).sort(function (left, right) {
    const confidenceDifference = Number(right.decision && right.decision.confidence === 'high') - Number(left.decision && left.decision.confidence === 'high');
    return confidenceDifference || left.index - right.index;
  });
  return ordered.map(function (entry) {
    const decision = entry.decision;
    const index = entry.index;
    const start = Number(decision.removeStartIndex);
    const end = Number(decision.removeEndIndex);
    const replacementStart = Number(decision.replacementStartIndex);
    const replacementEnd = Number(decision.replacementEndIndex);
    if (![start, end, replacementStart, replacementEnd].every(Number.isInteger)) return null;
    if (start < 0 || end < start || end >= words.length || end - start > 250) return null;
    // A semantic auto-cut is safe only when the model points to a concrete,
    // later replacement. Never coerce hallucinated/out-of-range indices into
    // the transcript or accept an overlapping range that deletes unique words.
    if (replacementStart <= end || replacementEnd < replacementStart || replacementEnd >= words.length || replacementEnd - replacementStart > 250) return null;
    const replacementGap = Number(words[replacementStart] && words[replacementStart].start) - Number(words[end] && words[end].end);
    if (!Number.isFinite(replacementGap) || replacementGap < 0 || replacementGap > 30) return null;
    const removeWordIndices = [];
    for (let wordIndex = start; wordIndex <= end; wordIndex++) removeWordIndices.push(wordIndex);
    if (removeWordIndices.some(function (wordIndex) { return claimedRemovalIndices.has(wordIndex); })) return null;
    removeWordIndices.forEach(function (wordIndex) { claimedRemovalIndices.add(wordIndex); });
    // The semantic reviewer is useful, but a hallucinated `high` must never
    // be sufficient to delete unique speech. A real restarted take normally
    // shares its opening or much of its wording with the later clean take.
    // Unrelated ranges remain visible as review cards instead of being
    // applied automatically.
    function tokens(from, to) {
      return words.slice(from, to + 1).map(function (word) {
        return String(word.text || '').toLowerCase().replace(/[^a-z0-9']/g, '');
      }).filter(Boolean);
    }
    const removedTokens = tokens(start, end);
    const replacementTokens = tokens(replacementStart, replacementEnd);
    let matchingPrefix = 0;
    while (matchingPrefix < Math.min(removedTokens.length, replacementTokens.length) && removedTokens[matchingPrefix] === replacementTokens[matchingPrefix]) matchingPrefix++;
    const sharedRatio = removedTokens.filter(function (token) { return replacementTokens.includes(token); }).length / Math.max(1, removedTokens.length);
    const lexicalSupport = matchingPrefix >= Math.min(2, removedTokens.length) || sharedRatio >= 0.5;
    const requestedHigh = decision.confidence === 'high';
    const confidence = requestedHigh && lexicalSupport ? 'high' : 'review';
    const reason = String(decision.reason || 'A nearby take may replace this wording.').slice(0, 260) +
      (requestedHigh && !lexicalSupport ? ' The wording differs enough to require review.' : '');
    return {
      id: 'smart-retake-' + index + '-' + start + '-' + end,
      removeWordIndices: removeWordIndices,
      firstText: words.slice(start, end + 1).map(function (word) { return word.text; }).join(' '),
      replacementText: words.slice(replacementStart, replacementEnd + 1).map(function (word) { return word.text; }).join(' '),
      confidence: confidence,
      reason: reason.slice(0, 300),
      source: 'semantic'
    };
  }).filter(Boolean);
}

function retakeCandidatesForProject(project) {
  return Array.isArray(project.retakeDecisions) && project.retakeDecisions.length
    ? project.retakeDecisions
    : retakeCandidates(project.words || []);
}

function unresolvedRetakeCount(project) {
  const dismissed = new Set((project.dismissedRetakeIds || []).map(String));
  const removed = new Set((project.removedWordIndices || []).map(Number));
  return retakeCandidatesForProject(project).filter(function (candidate) {
    return !dismissed.has(candidate.id) && !candidate.removeWordIndices.every(function (index) { return removed.has(index); });
  }).length;
}

function appliedRetakeCount(project) {
  const dismissed = new Set((project.dismissedRetakeIds || []).map(String));
  const removed = new Set((project.removedWordIndices || []).map(Number));
  return retakeCandidatesForProject(project).filter(function (candidate) {
    return !dismissed.has(candidate.id) && candidate.removeWordIndices.length > 0 && candidate.removeWordIndices.every(function (index) { return removed.has(index); });
  }).length;
}

function reconcileAutomaticRetakeCuts(project, decisions) {
  const removed = new Set((project.removedWordIndices || []).map(Number));
  // Release only indices explicitly owned by the previous automatic analysis.
  // Manual transcript cuts are never inferred from the current decision list,
  // so a changed model answer cannot silently restore Harvey's own edit.
  (project.autoRetakeRemovedWordIndices || []).map(Number).forEach(function (index) { removed.delete(index); });
  const dismissed = new Set((project.dismissedRetakeIds || []).map(String));
  const owned = new Set();
  (decisions || []).filter(function (decision) {
    return decision.confidence === 'high' && !dismissed.has(decision.id);
  }).forEach(function (decision) {
    decision.removeWordIndices.forEach(function (index) {
      // If Harvey had already removed this word manually, automation can use
      // the same resulting cut but must never claim ownership of it.
      if (!removed.has(index)) owned.add(index);
      removed.add(index);
    });
  });
  project.removedWordIndices = Array.from(removed).sort(function (a, b) { return a - b; });
  project.autoRetakeRemovedWordIndices = Array.from(owned).sort(function (a, b) { return a - b; });
  return project;
}

function keepSegments(duration, cuts) {
  const total = Math.max(0, Number(duration) || 0);
  const segments = [];
  let cursor = 0;
  mergeCuts(cuts, total).forEach(function (cut) {
    if (cut.start - cursor >= 0.04) segments.push({ start: cursor, end: cut.start });
    cursor = Math.max(cursor, cut.end);
  });
  if (total - cursor >= 0.04) segments.push({ start: cursor, end: total });
  return segments;
}

function segmentAudioFades(segments, index, duration) {
  const segment = (segments || [])[index];
  if (!segment) return { fadeIn: false, fadeOut: false };
  const previous = index > 0 ? segments[index - 1] : null;
  const next = index + 1 < segments.length ? segments[index + 1] : null;
  // Fade audio at genuine source jumps, including a removed opening or tail.
  return {
    fadeIn: segment.start > 0.015 && (!previous || segment.start - previous.end > 0.015),
    fadeOut: segment.end < Math.max(0, Number(duration) || 0) - 0.015 && (!next || next.start - segment.end > 0.015)
  };
}

function mapSourceTimeToEdited(time, cuts) {
  const value = Math.max(0, Number(time) || 0);
  let removed = 0;
  for (const cut of cuts || []) {
    if (value >= cut.end) removed += cut.end - cut.start;
    else if (value > cut.start) return cut.start - removed;
    else break;
  }
  return value - removed;
}

function captionGroups(project, cuts) {
  const removed = new Set((project.removedWordIndices || []).map(Number));
  const available = (project.words || []).filter(function (word) { return !removed.has(word.index); });
  const groups = [];
  let current = [];
  function flush() {
    if (!current.length) return;
    const start = mapSourceTimeToEdited(current[0].start, cuts);
    const end = Math.max(start + 0.45, mapSourceTimeToEdited(current[current.length - 1].end, cuts));
    const timedWords = current.map(function (word) {
      return {
        text: word.text,
        sourceStart: word.start,
        sourceEnd: word.end,
        start: mapSourceTimeToEdited(word.start, cuts),
        end: mapSourceTimeToEdited(word.end, cuts)
      };
    });
    groups.push({
      start: start,
      end: end,
      sourceStart: current[0].start,
      sourceEnd: current[current.length - 1].end,
      text: current.map(function (word) { return word.text; }).join(' '),
      words: timedWords
    });
    current = [];
  }
  available.forEach(function (word) {
    const previous = current[current.length - 1];
    if (previous && (word.start - previous.end > 0.7 || current.length >= 5 || word.end - current[0].start > 2.4)) flush();
    current.push(word);
    if (/[.!?][\"'’”)]*$/.test(word.text)) flush();
  });
  flush();
  return groups;
}

function editorTimelineSegments(project, cuts) {
  const base = keepSegments(project.duration, cuts).map(function (segment) { return Object.assign({ type: 'source' }, segment); });
  const ready = (project.insertedClips || []).filter(function (clip) { return clip.status === 'ready' && Number(clip.duration) > 0; })
    .sort(function (a, b) { return Number(a.afterSourceTime) - Number(b.afterSourceTime); });
  ready.forEach(function (clip) {
    const at = Number(clip.afterSourceTime);
    const containingIndex = base.findIndex(function (segment) { return segment.type === 'source' && at >= segment.start - 0.001 && at <= segment.end + 0.001; });
    if (containingIndex < 0) return;
    const containing = base[containingIndex];
    const replacement = [];
    if (at - containing.start >= 0.04) replacement.push({ type: 'source', start: containing.start, end: at });
    replacement.push({ type: 'insert', clipId: clip.id, start: 0, end: Number(clip.duration), clip: clip });
    if (containing.end - at >= 0.04) replacement.push({ type: 'source', start: at, end: containing.end, cameraResetAfterInsert: true });
    base.splice.apply(base, [containingIndex, 1].concat(replacement));
  });
  return base;
}

function renderCaptionGroups(project, cuts, segments) {
  const removed = new Set((project.removedWordIndices || []).map(Number));
  const timed = [];
  let cursor = 0;
  (segments || []).forEach(function (segment, segmentIndex) {
    const duration = segment.end - segment.start;
    const words = segment.type === 'insert' ? (segment.clip.words || []) : (project.words || []).filter(function (word) {
      return !removed.has(Number(word.index)) && Number(word.start) >= segment.start - 0.001 && Number(word.end) <= segment.end + 0.001;
    });
    words.forEach(function (word) {
      const base = segment.type === 'insert' ? 0 : segment.start;
      timed.push({ text: word.text, start: cursor + Math.max(0, Number(word.start) - base), end: cursor + Math.min(duration, Number(word.end) - base), segmentIndex: segmentIndex });
    });
    cursor += duration;
  });
  const groups = []; let current = [];
  function flush() {
    if (!current.length) return;
    groups.push({ start: current[0].start, end: Math.max(current[0].start + 0.2, current[current.length - 1].end), text: current.map(function (word) { return word.text; }).join(' '), words: current });
    current = [];
  }
  timed.forEach(function (word) {
    const previous = current[current.length - 1];
    if (previous && (word.segmentIndex !== previous.segmentIndex || word.start - previous.end > 0.7 || current.length >= 5 || word.end - current[0].start > 2.4)) flush();
    current.push(word);
    if (/[.!?][\"'’”)]*$/.test(word.text)) flush();
  });
  flush();
  return groups;
}

function assTime(seconds) {
  const centiseconds = Math.max(0, Math.round(Number(seconds || 0) * 100));
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const secs = Math.floor((centiseconds % 6000) / 100);
  const cs = centiseconds % 100;
  return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(secs).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
}

function escapeAss(text) {
  return String(text || '').replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\r?\n/g, '\\N');
}

function buildAss(project, groups) {
  const width = Math.max(360, Math.round(Number(project.width) || 1080));
  const height = Math.max(360, Math.round(Number(project.height) || 1920));
  const isLongform = width >= height;
  const fontSize = Math.max(30, Math.round(Math.min(width, height) * (isLongform ? 0.048 : 0.08)));
  const emphasizedSize = Math.round(fontSize * 1.12);
  // Vertical captions sit low over the otherwise-unused lower page area.
  // 22% from the bottom matches the Editor preview and Harvey's marked
  // reference line; the former 30% placement sat visibly over the page text.
  // Landscape captions sit just above the lower book edge. The old 27%
  // margin put them across the middle of the page; 12% matches Harvey's
  // marked lower-third target while retaining a safe gap above the frame.
  const marginV = Math.round(height * (isLongform ? 0.12 : 0.22));
  const header = [
    '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: ' + width, 'PlayResY: ' + height,
    'ScaledBorderAndShadow: yes', '', '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Arial,' + fontSize + ',&H0063DFF4,&H0063DFF4,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,3,2,2,40,40,' + marginV + ',1',
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ];
  const events = [];
  (groups || []).forEach(function (group) {
    if (!Array.isArray(group.words) || !group.words.length) {
      events.push('Dialogue: 0,' + assTime(group.start) + ',' + assTime(group.end) + ',Default,,0,0,0,,' + escapeAss(group.text));
      return;
    }
    if (!isLongform) {
      // Vertical content deliberately shows exactly one large word at a
      // time. Hold it until the following word begins, then switch cleanly;
      // the phrase grouper still supplies a blank beat at sentence/long-pause
      // boundaries so a finished thought does not linger on screen.
      group.words.forEach(function (word, wordIndex) {
        const eventStart = word.start;
        const eventEnd = wordIndex + 1 < group.words.length ? group.words[wordIndex + 1].start : group.end;
        if (eventEnd <= eventStart) return;
        const escaped = escapeAss(word.text);
        const characterCount = Array.from(String(word.text || '')).length;
        const fittedSize = Math.max(Math.round(fontSize * 0.36), Math.min(fontSize, Math.round(fontSize * 15 / Math.max(15, characterCount))));
        const fittedText = fittedSize < fontSize ? '{\\fs' + fittedSize + '}' + escaped + '{\\r}' : escaped;
        events.push('Dialogue: 0,' + assTime(eventStart) + ',' + assTime(eventEnd) + ',Default,,0,0,0,,' + fittedText);
      });
      return;
    }
    // Keep the complete phrase on screen while moving one stable emphasis
    // through it. Segment boundaries use the next word's exact start, so the
    // active word changes in lockstep with speech without relying on karaoke
    // fill behavior that differs between ASS renderers.
    const characterCount = Array.from(String(group.text || '')).length;
    const fittedLongformSize = Math.max(Math.round(fontSize * 0.65), Math.min(fontSize, Math.round(fontSize * 50 / Math.max(50, characterCount))));
    const fittedEmphasizedSize = Math.round(fittedLongformSize * 1.12);
    group.words.forEach(function (activeWord, activeIndex) {
      const eventStart = activeIndex === 0 ? group.start : activeWord.start;
      const eventEnd = activeIndex + 1 < group.words.length ? group.words[activeIndex + 1].start : group.end;
      if (eventEnd <= eventStart) return;
      const text = group.words.map(function (word, wordIndex) {
        const escaped = escapeAss(word.text);
        if (fittedLongformSize < fontSize) {
          return wordIndex === activeIndex
            ? '{\\fs' + fittedEmphasizedSize + '\\bord4}' + escaped
            : '{\\fs' + fittedLongformSize + '\\bord3}' + escaped;
        }
        return wordIndex === activeIndex ? '{\\fs' + emphasizedSize + '\\bord4}' + escaped + '{\\r}' : escaped;
      }).join(' ');
      events.push('Dialogue: 0,' + assTime(eventStart) + ',' + assTime(eventEnd) + ',Default,,0,0,0,,' + text);
    });
  });
  return header.concat(events).join('\n') + '\n';
}

function projectListSummary(project) {
  const summary = Object.assign({}, project);
  summary.insertedClips = (project.insertedClips || []).map(function (clip) {
    const item = Object.assign({}, clip); delete item.words; return item;
  });
  summary.unresolvedRetakeCount = unresolvedRetakeCount(project);
  summary.appliedRetakeCount = appliedRetakeCount(project);
  summary.layoutReviewRequired = layoutReviewRequired(project);
  summary.canUndoCut = Array.isArray(project.cutDecisionHistory) && project.cutDecisionHistory.length > 0;
  // Queue cards and status polling need lifecycle metadata, not the complete
  // transcript/edit graph. A filming batch can otherwise resend megabytes of
  // repeated word timing and analysis every 1.8 seconds.
  ['words', 'transcriptText', 'removedWordIndices', 'autoRetakeRemovedWordIndices', 'punchIns',
    'dismissedRetakeIds', 'restoredAutoCutIds', 'retakeDecisions', 'cutDecisionHistory',
    'recentMutationIds', 'renderQuality', 'visualClassification', 'planningMatch'].forEach(function (key) {
    delete summary[key];
  });
  return summary;
}

function setup(options) {
  options = options || {};
  const db = options.db;
  const dataDir = options.dataDir;
  const transcribeDetailed = options.transcribeDetailed;
  const handoffToProduction = options.handoffToProduction;
  const analyzeRetakes = options.analyzeRetakes;
  const getPlanningCandidates = options.getPlanningCandidates;
  const getPlanningPiece = options.getPlanningPiece;
  const matchPlanningPiece = options.matchPlanningPiece;
  const onRenderReady = options.onRenderReady;
  const onRenderInvalidated = options.onRenderInvalidated;
  const onPlanningPieceChanged = options.onPlanningPieceChanged;
  const onProjectDeleted = options.onProjectDeleted;
  const getAudioTracks = options.getAudioTracks;
  const getAudioTrackPath = options.getAudioTrackPath;
  const getAudioMixSettings = options.getAudioMixSettings;
  const buildAudioPreview = options.buildAudioPreview;
  if (!db || !dataDir || typeof transcribeDetailed !== 'function') throw new Error('video editor setup is incomplete');
  const router = express.Router();
  const rootDir = path.join(dataDir, 'editor');
  const tempDir = path.join(dataDir, 'tmp');
  fs.mkdirSync(rootDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });
  // No Editor request or extraction process can survive a service restart.
  // Remove only Editor-owned leftovers immediately; /data/tmp is shared with
  // other Content Studio features and must not be swept wholesale.
  cleanOrphanedEditorTempFiles(tempDir);
  cleanStaleTempFiles(tempDir).catch(function () {});
  const tempCleanupTimer = setInterval(function () { cleanStaleTempFiles(tempDir).catch(function () {}); }, 6 * 60 * 60 * 1000);
  if (typeof tempCleanupTimer.unref === 'function') tempCleanupTimer.unref();
  const uploadStorage = multer.diskStorage({
    destination: function (req, file, callback) { callback(null, tempDir); },
    filename: function (req, file, callback) {
      const name = 'editor-upload-' + crypto.randomUUID();
      req.editorUploadTempPath = path.join(tempDir, name);
      callback(null, name);
    }
  });
  const upload = multer({ storage: uploadStorage, limits: { fileSize: MAX_UPLOAD_BYTES } });
  const getStmt = db.prepare('SELECT data FROM records WHERE store_name = ? AND id = ?');
  const listStmt = db.prepare('SELECT data FROM records WHERE store_name = ? ORDER BY updated_at DESC');
  const putStmt = db.prepare('INSERT INTO records (store_name, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(store_name, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at');
  const delStmt = db.prepare('DELETE FROM records WHERE store_name = ? AND id = ?');
  const transcriptionJobs = new Map();
  const previewJobs = new Map();
  const renderPreviewJobs = new Map();
  const renderJobs = new Map();
  const productionJobs = new Map();
  const audioPreviewJobs = new Map();
  const audioPreviewCache = new Map();
  const audioPreviewQueue = createConcurrentTaskQueue(2);
  // Browser proxies and final masters are both sustained FFmpeg encodes. One
  // priority queue prevents CPU contention while letting an approval-ready
  // final take the next slot ahead of proxies that have not started yet.
  const encodeQueue = createPriorityTaskQueue();
  const classificationJobs = new Map();
  const retakeJobs = new Map();
  const planningMatchJobs = new Map();
  const clipInsertJobs = new Map();
  const automaticRenderTimers = new Map();
  const uploadCapacityReservations = createByteReservationLedger();
  const sourceHashClaims = createKeyedClaimRegistry();
  const chunkUploadSessions = new Map();
  let transcriptionChain = Promise.resolve();
  let retakeChain = Promise.resolve();
  let planningMatchChain = Promise.resolve();

  function pruneAudioPreviewCache(projectId) {
    const now = Date.now();
    audioPreviewCache.forEach(function (entry, key) {
      if ((projectId && entry.projectId === projectId) || entry.expiresAt <= now || !fs.existsSync(entry.path)) {
        audioPreviewCache.delete(key);
        fs.rm(entry.path, { force: true }, function () {});
      }
    });
  }
  const audioPreviewCleanupTimer = setInterval(function () { pruneAudioPreviewCache(); }, 10 * 60 * 1000);
  if (typeof audioPreviewCleanupTimer.unref === 'function') audioPreviewCleanupTimer.unref();

  async function editorAudioPreview(project, trackId) {
    if (typeof getAudioTrackPath !== 'function' || typeof getAudioMixSettings !== 'function' || typeof buildAudioPreview !== 'function') {
      throw new Error('Backing-audio previews are unavailable.');
    }
    const trackPath = getAudioTrackPath(trackId);
    if (!trackPath || !fs.existsSync(trackPath)) throw new Error('That backing track is no longer available.');
    const settings = getAudioMixSettings() || {};
    const settingsHash = crypto.createHash('sha256').update(JSON.stringify(settings)).digest('hex');
    const key = [project.id, project.renderSha256, trackId, settingsHash].join(':');
    pruneAudioPreviewCache();
    const cached = audioPreviewCache.get(key);
    if (cached && fs.existsSync(cached.path)) {
      cached.expiresAt = Date.now() + AUDIO_PREVIEW_TTL_MS;
      return cached.path;
    }
    if (audioPreviewJobs.has(key)) return audioPreviewJobs.get(key);
    const job = audioPreviewQueue.enqueue(async function () {
      const outPath = path.join(tempDir, 'editor-audio-preview-' + crypto.randomUUID() + '.mp3');
      try {
        // Keep Editor auditioning byte-for-byte on the same output profile as
        // the proven Content Settings tester: same measured mix and the
        // mixer's normal 192 kbps MP3 preview, rather than a separate 48 kbps
        // approximation that made quieter ambience sound thin and indistinct.
        await buildAudioPreview(renderPath(project.id), trackPath, outPath, settings, { bitrate: '192k' });
        const stat = fs.statSync(outPath);
        if (!stat.isFile() || stat.size <= 512) throw new Error('The backing-audio preview was empty.');
        audioPreviewCache.set(key, { path: outPath, projectId: project.id, expiresAt: Date.now() + AUDIO_PREVIEW_TTL_MS });
        return outPath;
      } catch (error) {
        fs.rm(outPath, { force: true }, function () {});
        throw error;
      }
    }).finally(function () { audioPreviewJobs.delete(key); });
    audioPreviewJobs.set(key, job);
    return job;
  }

  function invalidateProjectRender(project) {
    const hadVerifiedRender = project && project.renderStatus === 'ready';
    const rebuildPending = hadVerifiedRender || !!(project && project.renderRebuildPending);
    if (hadVerifiedRender && typeof onRenderInvalidated === 'function') {
      try { onRenderInvalidated({ project: project }); }
      catch (error) { project.workflowWarning = 'The edit changed safely, but its linked planning card could not be returned to Filmed.'; }
    }
    const invalidated = invalidateRender(project);
    // Preserve an explicit distinction between a first render and an edit
    // which invalidated a preview Harvey had already reviewed. The browser
    // uses this throughout the debounce window, before renderStatus becomes
    // queued/running, so the stale player can be covered and made inert.
    if (project) project.renderRebuildPending = rebuildPending;
    if (project && project.id && isId(project.id)) {
      pruneAudioPreviewCache(project.id);
      try { fs.rmSync(renderPath(project.id), { force: true }); } catch (error) {}
      try { fs.rmSync(renderPreviewPath(project.id), { force: true }); } catch (error) {}
      project.renderPreviewStatus = '';
      project.renderPreviewError = '';
      project.renderPreviewVersion = 0;
    }
    return invalidated;
  }

  function withQueuePositions(project) {
    if (!project) return project;
    const item = Object.assign({}, project);
    function position(jobs) {
      const index = Array.from(jobs.keys()).indexOf(project.id);
      return index === -1 ? 0 : index + 1;
    }
    item.transcriptionQueuePosition = position(transcriptionJobs);
    item.previewQueuePosition = position(previewJobs);
    item.classificationQueuePosition = position(classificationJobs);
    item.retakeQueuePosition = position(retakeJobs);
    item.planningQueuePosition = position(planningMatchJobs);
    item.renderQueuePosition = position(renderJobs);
    return item;
  }

  function getProject(id) {
    const row = getStmt.get(STORE_NAME, id);
    if (!row) return null;
    try { return JSON.parse(row.data); } catch (e) { return null; }
  }
  function saveProject(project) {
    project.updatedAt = new Date().toISOString();
    putStmt.run(STORE_NAME, project.id, JSON.stringify(project), project.updatedAt);
    return project;
  }
  function projectDetail(project) {
    project.cuts = cutsForProject(project);
    project.captionGroups = captionGroups(project, project.cuts);
    project.gapDecisions = gapDecisions(project);
    project.retakeCandidates = retakeCandidatesForProject(project);
    project.unresolvedRetakeCount = unresolvedRetakeCount(project);
    project.appliedRetakeCount = appliedRetakeCount(project);
    project.layoutReviewRequired = layoutReviewRequired(project);
    project.effectiveLayout = effectiveLayout(project);
    project.detectedContentType = contentTypeForProject(project, project.cuts);
    project.planningCandidates = typeof getPlanningCandidates === 'function' ? getPlanningCandidates(project) : [];
    project.canUndoCut = Array.isArray(project.cutDecisionHistory) && project.cutDecisionHistory.length > 0;
    delete project.cutDecisionHistory;
    delete project.recentMutationIds;
    return project;
  }
  function projectDir(id) { return path.join(rootDir, id); }
  function sourcePath(id) { return path.join(projectDir(id), 'source'); }
  function previewPath(id) { return path.join(projectDir(id), 'preview.mp4'); }
  function renderPath(id) { return path.join(projectDir(id), 'render.mp4'); }
  function renderPreviewPath(id) { return path.join(projectDir(id), 'render-preview.mp4'); }
  function insertedClipPath(id, clipId) { return path.join(projectDir(id), 'inserted-clip-' + clipId + '.mp4'); }
  function isId(id) { return /^[A-Za-z0-9_-]{1,128}$/.test(String(id || '')); }
  function availableDiskBytes() {
    try {
      const stat = fs.statfsSync(dataDir);
      return Number(stat.bavail) * Number(stat.bsize || stat.frsize || 4096);
    } catch (error) { return Infinity; }
  }
  function ensureUploadCapacity(req, res, next) {
    const contentLength = Number(req.headers['content-length']);
    const projects = listStmt.all(STORE_NAME).map(function (row) { try { return JSON.parse(row.data); } catch (error) { return null; } }).filter(Boolean);
    const outstanding = outstandingEditorCapacity(projects);
    const requestedCapacity = Number.isFinite(contentLength) && contentLength > 0 ? requiredEditorCapacity(contentLength, false) : 0;
    if (requestedCapacity && availableDiskBytes() < requestedCapacity + outstanding + uploadCapacityReservations.total()) {
      return res.status(507).json({ error: 'insufficient_storage', message: 'There is not enough free workspace to safely edit this recording. Clear old Editor files or VPS storage, then try again.' });
    }
    if (requestedCapacity) {
      const token = uploadCapacityReservations.reserve(requestedCapacity);
      let released = false;
      req.releaseEditorUploadReservation = function () {
        if (released) return;
        released = true;
        uploadCapacityReservations.release(token);
      };
      res.once('finish', req.releaseEditorUploadReservation);
      res.once('close', req.releaseEditorUploadReservation);
    }
    next();
  }

  function cleanAbortedUpload(req, res, next) {
    req.once('aborted', function () {
      if (req.editorUploadTempPath) fs.rm(req.editorUploadTempPath, { force: true }, function () {});
    });
    next();
  }

  async function probe(filePath) {
    const result = await run('ffprobe', ['-v', 'error', '-show_entries',
      'format=duration:stream=codec_type,codec_name,width,height,pix_fmt:stream_tags=rotate:stream_side_data=rotation',
      '-of', 'json', filePath], 'video probe');
    const parsed = JSON.parse(result.stdout || '{}');
    const video = (parsed.streams || []).find(function (stream) { return stream.codec_type === 'video'; }) || {};
    const sideRotation = (video.side_data_list || []).map(function (entry) { return Number(entry.rotation); })
      .find(function (value) { return Number.isFinite(value); });
    const tagRotation = video.tags && Number(video.tags.rotate);
    const rotation = Number.isFinite(sideRotation) ? sideRotation : Number.isFinite(tagRotation) ? tagRotation : 0;
    const dimensions = displayDimensions(video.width, video.height, rotation);
    return {
      duration: Number(parsed.format && parsed.format.duration) || 0,
      width: dimensions.width,
      height: dimensions.height,
      codedWidth: Number(video.width) || 0,
      codedHeight: Number(video.height) || 0,
      rotation: rotation,
      pixelFormat: String(video.pix_fmt || ''),
      videoCodec: String(video.codec_name || ''),
      audioCodec: String(((parsed.streams || []).find(function (stream) { return stream.codec_type === 'audio'; }) || {}).codec_name || ''),
      hasAudio: (parsed.streams || []).some(function (stream) { return stream.codec_type === 'audio'; })
    };
  }

  async function browserPreviewIsValid(filePath, expectedDuration) {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size <= 1024) return false;
      const media = await probe(filePath);
      const durationValid = !Number(expectedDuration) || Math.abs(media.duration - Number(expectedDuration)) <= renderDurationTolerance(expectedDuration);
      const rotationBakedIn = Math.abs(Number(media.rotation) || 0) % 180 !== 90;
      return media.videoCodec === 'h264' && media.hasAudio && media.width > 0 && media.height > 0 &&
        Math.max(media.width, media.height) <= 854 && rotationBakedIn && durationValid;
    } catch (error) { return false; }
  }

  async function buildScrubProxy(inputPath, outputPath, expectedDuration, label) {
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-autorotate', '1', '-i', inputPath,
      '-map', '0:v:0', '-map', '0:a:0', '-vf',
      "scale=w='if(gte(iw,ih),trunc(min(854,iw)/2)*2,-2)':h='if(gte(iw,ih),-2,trunc(min(854,ih)/2)*2)',fps=30",
      '-c:v', 'libx264', '-preset', 'superfast', '-tune', 'fastdecode', '-crf', '30', '-pix_fmt', 'yuv420p',
      '-g', '15', '-keyint_min', '15', '-sc_threshold', '0',
      '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', outputPath], label);
    if (!await browserPreviewIsValid(outputPath, expectedDuration)) throw new Error('The scrub-optimized browser preview failed verification.');
  }

  async function generateBrowserPreview(id) {
    if (previewJobs.has(id)) return previewJobs.get(id);
    let initial;
    try { initial = getProject(id); } catch (error) { return; }
    if (!initial || !initial.browserPreviewRequired || initial.productionPieceId) return;
    const job = encodeQueue.enqueue(async function () {
      let project;
      try { project = getProject(id); } catch (error) { return; }
      if (!project || !project.browserPreviewRequired || project.productionPieceId) return;
      project.browserPreviewStatus = 'running';
      project.browserPreviewError = '';
      try { saveProject(project); } catch (error) { return; }
      try {
        await buildScrubProxy(sourcePath(id), previewPath(id), project.duration, 'source scrub proxy');
        try { project = getProject(id); } catch (error) { return; }
        if (!project) return;
        project.browserPreviewStatus = 'ready';
        project.browserPreviewError = '';
        project.browserPreviewVersion = BROWSER_PREVIEW_VERSION;
        try { saveProject(project); } catch (error) { return; }
      } catch (error) {
        fs.rm(previewPath(id), { force: true }, function () {});
        try { project = getProject(id); } catch (readError) { return; }
        if (project) {
          project.browserPreviewStatus = 'error';
          project.browserPreviewError = String(error.message || error).slice(0, 500);
          project.browserPreviewVersion = 0;
          try { saveProject(project); } catch (saveError) { return; }
        }
      }
    }, 'normal').finally(function () { previewJobs.delete(id); });
    previewJobs.set(id, job);
    return job;
  }

  async function generateRenderPreview(id) {
    if (renderPreviewJobs.has(id)) return renderPreviewJobs.get(id);
    let initial;
    try { initial = getProject(id); } catch (error) { return; }
    if (!initial || initial.renderStatus !== 'ready' || !fs.existsSync(renderPath(id))) return;
    const job = encodeQueue.enqueue(async function () {
      let project;
      try { project = getProject(id); } catch (error) { return; }
      if (!project || project.renderStatus !== 'ready' || !fs.existsSync(renderPath(id))) return;
      project.renderPreviewStatus = 'running';
      project.renderPreviewError = '';
      try { saveProject(project); } catch (error) { return; }
      try {
        await buildScrubProxy(renderPath(id), renderPreviewPath(id), project.editedDuration || project.duration, 'final edit scrub proxy');
        try { project = getProject(id); } catch (error) { return; }
        if (!project || project.renderStatus !== 'ready') return;
        project.renderPreviewStatus = 'ready';
        project.renderPreviewError = '';
        project.renderPreviewVersion = BROWSER_PREVIEW_VERSION;
        try { saveProject(project); } catch (error) { return; }
      } catch (error) {
        fs.rm(renderPreviewPath(id), { force: true }, function () {});
        try { project = getProject(id); } catch (readError) { return; }
        if (project) {
          project.renderPreviewStatus = 'error';
          project.renderPreviewError = String(error.message || error).slice(0, 500);
          project.renderPreviewVersion = 0;
          try { saveProject(project); } catch (saveError) { return; }
        }
      }
    }, 'normal').finally(function () { renderPreviewJobs.delete(id); });
    renderPreviewJobs.set(id, job);
    return job;
  }

  async function transcribeProject(id) {
    if (transcriptionJobs.has(id)) return transcriptionJobs.get(id);
    const job = transcriptionChain.catch(function () {}).then(async function () {
      let project = getProject(id);
      if (!project) return;
      project.transcriptionStatus = 'running';
      project.transcriptionError = '';
      saveProject(project);
      const audioPath = path.join(tempDir, 'editor-' + id + '-' + crypto.randomUUID() + '.mp3');
      try {
        await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath(id), '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', audioPath], 'editor audio extraction');
        const audioBytes = fs.readFileSync(audioPath);
        let result;
        try {
          result = await transcribeDetailed(audioBytes, 'audio/mpeg');
        } catch (firstError) {
          await new Promise(function (resolve) { setTimeout(resolve, 750); });
          result = await transcribeDetailed(audioBytes, 'audio/mpeg');
        }
        project = getProject(id);
        if (!project) return;
        project.transcriptText = String(result.text || '').trim();
        project.words = normalizeWords(result.words);
        project.removedWordIndices = [];
        project.dismissedRetakeIds = [];
        project.restoredAutoCutIds = [];
        project.autoSilenceEnabled = true;
        project.transcriptionStatus = project.words.length ? 'ready' : 'error';
        project.transcriptionError = project.words.length ? '' : 'No timed speech was detected in this recording.';
        project.retakeAnalysisStatus = project.words.length && typeof analyzeRetakes === 'function' ? 'pending' : 'unavailable';
        project.retakeAnalysisError = '';
        project.retakeDecisions = [];
        project.planningMatchStatus = project.words.length && typeof matchPlanningPiece === 'function' ? 'pending' : 'unavailable';
        project.planningMatchError = '';
        invalidateProjectRender(project);
        advanceEditRevision(project);
        saveProject(project);
        if (project.words.length && typeof analyzeRetakes === 'function') setImmediate(function () { analyzeProjectRetakes(id); });
        if (project.words.length && typeof matchPlanningPiece === 'function') setImmediate(function () { matchProjectPlanningPiece(id); });
        if (project.words.length) setImmediate(function () { maybeAutoRender(id); });
      } catch (err) {
        project = getProject(id);
        if (project) {
          project.transcriptionStatus = 'error';
          project.transcriptionError = String(err.message || err).slice(0, 500);
          saveProject(project);
        }
      } finally {
        fs.rm(audioPath, { force: true }, function () {});
      }
    }).finally(function () { transcriptionJobs.delete(id); });
    transcriptionChain = job.catch(function () {});
    transcriptionJobs.set(id, job);
    return job;
  }

  async function analyzeProjectRetakes(id) {
    if (retakeJobs.has(id)) return retakeJobs.get(id);
    if (typeof analyzeRetakes !== 'function') return;
    const job = retakeChain.catch(function () {}).then(async function () {
      let project = getProject(id);
      if (!project || project.transcriptionStatus !== 'ready') return;
      project.retakeAnalysisStatus = 'running';
      project.retakeAnalysisError = '';
      saveProject(project);
      try {
        let raw;
        try {
          raw = await analyzeRetakes({ words: project.words || [], transcriptText: project.transcriptText || '' });
        } catch (firstError) {
          // One-shot provider processes can fail transiently while the shared
          // CLI credential/session is being refreshed. Retry once inside the
          // same durable job before asking Harvey to intervene.
          await new Promise(function (resolve) { setTimeout(resolve, 750); });
          raw = await analyzeRetakes({ words: project.words || [], transcriptText: project.transcriptText || '' });
        }
        project = getProject(id);
        if (!project) return;
        const decisions = normalizeRetakeDecisions(raw && raw.decisions, project.words || []);
        reconcileAutomaticRetakeCuts(project, decisions);
        project.retakeDecisions = decisions;
        project.retakeAnalysisStatus = 'ready';
        project.retakeAnalysisError = '';
        invalidateProjectRender(project);
        advanceEditRevision(project);
        saveProject(project);
        setImmediate(function () { maybeAutoRender(id); });
      } catch (err) {
        project = getProject(id);
        if (project) {
          project.retakeAnalysisStatus = 'error';
          project.retakeAnalysisError = String(err.message || err).slice(0, 500);
          saveProject(project);
        }
      }
    }).finally(function () { retakeJobs.delete(id); });
    retakeChain = job.catch(function () {});
    retakeJobs.set(id, job);
    return job;
  }

  async function matchProjectPlanningPiece(id) {
    if (planningMatchJobs.has(id)) return planningMatchJobs.get(id);
    if (typeof matchPlanningPiece !== 'function' || typeof getPlanningCandidates !== 'function') return;
    const job = planningMatchChain.catch(function () {}).then(async function () {
      let project = getProject(id);
      if (!project || project.transcriptionStatus !== 'ready') return;
      project.planningMatchStatus = 'running';
      project.planningMatchError = '';
      saveProject(project);
      try {
        const candidates = await Promise.resolve(getPlanningCandidates(project));
        let result;
        try {
          result = await matchPlanningPiece({ project: project, candidates: candidates });
        } catch (firstError) {
          await new Promise(function (resolve) { setTimeout(resolve, 750); });
          result = await matchPlanningPiece({ project: project, candidates: candidates });
        }
        project = getProject(id);
        if (!project) return;
        const matched = candidates.find(function (candidate) { return candidate.id === (result && result.pieceId); });
        const workingTitle = normalizeWorkingTitle(result && result.workingTitle || matched && matched.title);
        if (workingTitle) {
          project.workingTitle = workingTitle;
          project.name = workingTitle;
          project.nameSource = matched && result.confidence === 'high' ? 'planning_transcript' : 'transcript';
          project.workingTitleGeneratedAt = new Date().toISOString();
        }
        const previousPlanningPieceId = project.planningPieceId || '';
        if (matched && result.confidence === 'high' && !project.planningPieceManuallySelected) {
          project.planningPieceId = matched.id;
          project.planningPieceTitle = matched.title || '';
          project.planningPieceSeq = Number(matched.seq) || 0;
        }
        project.planningMatch = {
          suggestedPieceId: matched ? matched.id : '',
          confidence: result && result.confidence || 'none',
          reason: String(result && result.reason || '').slice(0, 300)
        };
        project.planningMatchStatus = 'ready';
        project.planningMatchError = '';
        if (project.planningPieceId !== previousPlanningPieceId && typeof onPlanningPieceChanged === 'function') {
          onPlanningPieceChanged({ project: project, previousPlanningPieceId: previousPlanningPieceId, renderWillChange: false });
        }
        saveProject(project);
        setImmediate(function () { maybeAutoRender(id); });
      } catch (err) {
        project = getProject(id);
        if (project) {
          project.planningMatchStatus = 'error';
          project.planningMatchError = String(err.message || err).slice(0, 500);
          saveProject(project);
          setImmediate(function () { maybeAutoRender(id); });
        }
      }
    }).finally(function () { planningMatchJobs.delete(id); });
    planningMatchChain = job.catch(function () {});
    planningMatchJobs.set(id, job);
    return job;
  }

  async function prepareInsertedClip(id, request) {
    if (clipInsertJobs.has(id)) return clipInsertJobs.get(id);
    const job = Promise.resolve().then(async function () {
      let project = getProject(id);
      let tempPrefix = '';
      if (!project) return;
      try {
        if (!project.planningPieceId) {
          project.planningMatchStatus = 'pending'; saveProject(project);
          await matchProjectPlanningPiece(id);
          project = getProject(id);
        }
        const planningPiece = project && project.planningPieceId && typeof getPlanningPiece === 'function' ? getPlanningPiece(project.planningPieceId) : null;
        if (!planningPiece) throw new Error('I could not confidently match this recording to an Outline Completed card.');
        const directives = parseInsertClipDirectives(planningPiece.notesHtml);
        const used = new Set((project.insertedClips || []).map(function (clip) { return clip.directiveId; }));
        const directive = directives.find(function (item) { return item.id === request.directiveId; }) || directives.find(function (item) { return !used.has(item.id); });
        if (!directive) throw new Error(directives.length ? 'Every INSERT CLIP instruction on the matched card is already in this edit.' : 'The matched planning card has no valid INSERT CLIP instruction.');
        const word = (project.words || []).find(function (item) { return Number(item.index) === Number(request.afterWordIndex); });
        if (!word || (project.removedWordIndices || []).map(Number).includes(Number(word.index))) throw new Error('Select a retained transcript word to insert the clip after.');
        const clipId = crypto.randomUUID();
        const clip = Object.assign({}, directive, { id: clipId, directiveId: directive.id, afterWordIndex: Number(word.index), afterSourceTime: Number(word.end), status: 'preparing', planningPieceId: planningPiece.id, planningPieceTitle: planningPiece.title || '', createdAt: new Date().toISOString() });
        project.insertedClips = (project.insertedClips || []).concat([clip]);
        project.clipInsertStatus = 'preparing'; project.clipInsertError = '';
        invalidateProjectRender(project); advanceEditRevision(project); saveProject(project);

        const prefix = 'editor-youtube-' + clipId;
        tempPrefix = prefix;
        const template = path.join(tempDir, prefix + '.%(ext)s');
        await run('yt-dlp', ['--no-playlist', '--no-warnings', '--download-sections', '*' + directive.sourceStart + '-' + directive.sourceEnd,
          '--force-keyframes-at-cuts', '-f', 'bv*[height<=1080]+ba/b[height<=1080]', '--merge-output-format', 'mp4', '-o', template, directive.sourceUrl], 'YouTube clip download');
        const downloadedName = fs.readdirSync(tempDir).find(function (name) { return name.indexOf(prefix + '.') === 0; });
        if (!downloadedName) throw new Error('YouTube returned no downloadable clip.');
        const downloaded = path.join(tempDir, downloadedName);
        const target = insertedClipPath(id, clipId);
        const requestedDuration = directive.sourceEnd - directive.sourceStart;
        await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', downloaded, '-t', requestedDuration.toFixed(3),
          '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', target], 'clip normalization');
        fs.rmSync(downloaded, { force: true });
        const media = await probe(target);
        if (!media.hasAudio || media.duration < 0.2) throw new Error('The selected YouTube range did not contain usable video and audio.');
        const audioPath = path.join(tempDir, 'editor-clip-audio-' + clipId + '.mp3');
        let words = [];
        try {
          await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', target, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', audioPath], 'clip audio extraction');
          const transcription = await transcribeDetailed(fs.readFileSync(audioPath), 'audio/mpeg');
          words = normalizeWords(transcription.words).filter(function (item) { return item.start < media.duration + 0.1; });
        } catch (error) {
          words = approximateWords(directive.quote, media.duration);
        } finally { fs.rmSync(audioPath, { force: true }); }
        if (!words.length) throw new Error('The clip downloaded, but its speech could not be transcribed and the outline did not include a quoted caption fallback.');
        project = getProject(id);
        if (!project) return;
        const stored = (project.insertedClips || []).find(function (item) { return item.id === clipId; });
        if (!stored) { fs.rmSync(target, { force: true }); return; }
        stored.duration = media.duration;
        stored.words = words.length ? words : approximateWords(stored.quote, media.duration);
        stored.transcriptText = stored.words.map(function (item) { return item.text; }).join(' ');
        stored.status = 'ready'; stored.readyAt = new Date().toISOString();
        project.clipInsertStatus = 'ready'; project.clipInsertError = '';
        invalidateProjectRender(project); advanceEditRevision(project); saveProject(project);
        scheduleAutoRender(id, 50);
      } catch (error) {
        project = getProject(id);
        if (project) {
          const preparing = (project.insertedClips || []).filter(function (clip) { return clip.status === 'preparing'; });
          preparing.forEach(function (clip) { fs.rmSync(insertedClipPath(id, clip.id), { force: true }); });
          project.insertedClips = (project.insertedClips || []).filter(function (clip) { return clip.status !== 'preparing'; });
          project.clipInsertStatus = 'error'; project.clipInsertError = String(error.message || error).slice(0, 500); saveProject(project);
          scheduleAutoRender(id, 50);
        }
      } finally {
        if (tempPrefix) {
          try { fs.readdirSync(tempDir).filter(function (name) { return name.indexOf(tempPrefix + '.') === 0; }).forEach(function (name) { fs.rmSync(path.join(tempDir, name), { force: true }); }); } catch (error) {}
        }
      }
    }).finally(function () { clipInsertJobs.delete(id); });
    clipInsertJobs.set(id, job);
    return job;
  }

  async function classifyProject(id) {
    if (classificationJobs.has(id)) return classificationJobs.get(id);
    const job = Promise.resolve().then(async function () {
      let project = getProject(id);
      if (!project) return;
      const layout = sourceLayout(project);
      project.visualClassification = {
        layout: layout, confidence: 'high', cropCenterX: 0.5,
        explanation: layout === 'vertical'
          ? 'Portrait camera orientation detected from the recording.'
          : 'Landscape camera orientation detected from the recording.'
      };
      project.classificationStatus = 'ready';
      project.classificationError = '';
      saveProject(project);
      setImmediate(function () { maybeAutoRender(id); });
    }).finally(function () { classificationJobs.delete(id); });
    classificationJobs.set(id, job);
    return job;
  }

  function maybeAutoRender(id) {
    const project = getProject(id);
    if (!project || project.productionPieceId || project.automaticRenderStartedAt || project.renderStatus || !automaticReviewReady(project)) return false;
    project.automaticRenderStartedAt = new Date().toISOString();
    saveProject(project);
    setImmediate(function () { renderProject(id); });
    return true;
  }

  function scheduleAutoRender(id, delayMs) {
    if (automaticRenderTimers.has(id)) clearTimeout(automaticRenderTimers.get(id));
    const timer = setTimeout(function () {
      automaticRenderTimers.delete(id);
      maybeAutoRender(id);
    }, Math.max(0, Number(delayMs) || 0));
    automaticRenderTimers.set(id, timer);
  }

async function renderProject(id) {
    if (renderJobs.has(id)) return renderJobs.get(id);
    let queuedProject = getProject(id);
    if (!queuedProject) return;
    queuedProject.renderStatus = 'queued';
    queuedProject.renderError = '';
    queuedProject.renderProgress = 0;
    saveProject(queuedProject);
    const job = encodeQueue.enqueue(async function () {
      let project = getProject(id);
      if (!project) return;
      project.renderStatus = 'running';
      project.renderError = '';
      project.renderProgress = 0;
      saveProject(project);
      const cuts = cutsForProject(project);
      const segments = editorTimelineSegments(project, cuts);
      if (!segments.length) throw new Error('Every part of the recording is currently cut. Restore some transcript first.');
      const expectedDuration = segments.reduce(function (sum, segment) { return sum + segment.end - segment.start; }, 0);
      const assPath = path.join(projectDir(id), 'captions.ass');
      const layout = effectiveLayout(project);
      const renderShape = layout === 'vertical' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
      if (project.captionsEnabled !== false) fs.writeFileSync(assPath, buildAss(renderShape, renderCaptionGroups(project, cuts, segments)));
      const filters = [];
      const readyClips = (project.insertedClips || []).filter(function (clip) { return clip.status === 'ready'; });
      const clipInputIndex = new Map(readyClips.map(function (clip, index) { return [clip.id, index + 1]; }));
      segments.forEach(function (segment, index) {
        const segmentDuration = segment.end - segment.start;
        const inputIndex = segment.type === 'insert' ? clipInputIndex.get(segment.clipId) : 0;
        let videoFilter = '[' + inputIndex + ':v]trim=start=' + segment.start.toFixed(3) + ':end=' + segment.end.toFixed(3) + ',setpts=PTS-STARTPTS';
        if (layout === 'vertical') {
          videoFilter += ",crop=w='min(iw\\,ih*9/16)':h='min(ih\\,iw*16/9)':x='(iw-ow)/2':y='(ih-oh)/2',scale=1080:1920,setsar=1";
        } else {
          videoFilter += ",crop=w='min(iw\\,ih*16/9)':h='min(ih\\,iw*9/16)':x='(iw-ow)/2':y='(ih-oh)/2',scale=1920:1080,setsar=1";
        }
        if (segment.type === 'source') {
          const motion = cameraMotionForSegment(segment, cuts, layout);
          videoFilter += cameraMotionFilter({ renderShape: renderShape, layout: layout, elapsedStart: motion.elapsed, durationSeconds: motion.duration, openingEnabled: project.openingPushInEnabled !== false });
        }
        videoFilter += ',format=yuv420p';
        filters.push(videoFilter + '[v' + index + ']');
        // Tiny boundary fades prevent waveform discontinuities from creating
        // a click at transcript/jump cuts, without audibly crossfading words.
        let audioFilter = '[' + inputIndex + ':a]atrim=start=' + segment.start.toFixed(3) + ':end=' + segment.end.toFixed(3) + ',asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
        if (index > 0) audioFilter += ',afade=t=in:st=0:d=0.008';
        if (index + 1 < segments.length) audioFilter += ',afade=t=out:st=' + Math.max(0, segmentDuration - 0.008).toFixed(3) + ':d=0.008';
        filters.push(audioFilter + '[a' + index + ']');
      });
      const concatInputs = segments.map(function (_, index) { return '[v' + index + '][a' + index + ']'; }).join('');
      filters.push(concatInputs + 'concat=n=' + segments.length + ':v=1:a=1[joinedv][outa]');
      if (project.captionsEnabled !== false) filters.push("[joinedv]subtitles='" + assPath.replace(/'/g, "'\\''") + "'[outv]");
      else filters.push('[joinedv]null[outv]');
      let lastReportedProgress = -1;
      const ffmpegInputs = ['-hide_banner', '-loglevel', 'error', '-y', '-autorotate', '1', '-i', sourcePath(id)];
      readyClips.forEach(function (clip) { ffmpegInputs.push('-i', insertedClipPath(id, clip.id)); });
      await runWithProgress('ffmpeg', ffmpegInputs.concat(['-filter_complex', filters.join(';'),
        '-map', '[outv]', '-map', '[outa]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', renderPath(id)]), 'editor render', function (encodedSeconds) {
        const percent = Math.min(99, Math.max(0, Math.floor(encodedSeconds / Math.max(0.01, expectedDuration) * 100)));
        if (percent < lastReportedProgress + 2) return;
        lastReportedProgress = percent;
        const current = getProject(id);
        if (current && current.renderStatus === 'running') { current.renderProgress = percent; saveProject(current); }
      });
      project = getProject(id);
      if (!project) return;
      const stat = fs.statSync(renderPath(id));
      const renderedMedia = await probe(renderPath(id));
      const volumeResult = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', renderPath(id), '-map', '0:a:0',
        '-af', 'volumedetect', '-f', 'null', '-'], 'render audio verification');
      const audioPeakDb = parseMaxVolume(volumeResult.stderr);
      const durationTolerance = renderDurationTolerance(expectedDuration);
      const qualityChecks = {
        playableFile: stat.size > 1024,
        correctFrame: renderedMedia.width === renderShape.width && renderedMedia.height === renderShape.height,
        standardPixelFormat: renderedMedia.pixelFormat === 'yuv420p',
        audioPresent: renderedMedia.hasAudio,
        audibleAudio: Number.isFinite(audioPeakDb) && audioPeakDb > -55,
        durationMatches: Math.abs(renderedMedia.duration - expectedDuration) <= durationTolerance
      };
      if (Object.keys(qualityChecks).some(function (key) { return !qualityChecks[key]; })) {
        throw new Error('Rendered output failed technical verification: ' + Object.keys(qualityChecks).filter(function (key) { return !qualityChecks[key]; }).join(', '));
      }
      await buildScrubProxy(renderPath(id), renderPreviewPath(id), expectedDuration, 'final edit scrub proxy');
      const renderSha256 = await hashFile(renderPath(id));
      project.renderStatus = 'ready';
      project.renderRebuildPending = false;
      project.renderVersion = EDITOR_RENDER_VERSION;
      project.renderProgress = 100;
      project.renderSizeBytes = stat.size;
      project.renderSha256 = renderSha256;
      project.renderPreviewStatus = 'ready';
      project.renderPreviewError = '';
      project.renderPreviewVersion = BROWSER_PREVIEW_VERSION;
      project.editedDuration = expectedDuration;
      project.renderQuality = {
        status: 'passed', checkedAt: new Date().toISOString(), checks: qualityChecks,
        width: renderedMedia.width, height: renderedMedia.height, pixelFormat: renderedMedia.pixelFormat,
        duration: renderedMedia.duration, audioPeakDb: audioPeakDb
      };
      project.lastRenderAt = new Date().toISOString();
      saveProject(project);
      if (typeof onRenderReady === 'function') {
        try {
          await Promise.resolve(onRenderReady({ project: project, renderPath: renderPath(id) }));
          project = getProject(id);
          if (project && project.workflowWarning) {
            delete project.workflowWarning;
            saveProject(project);
          }
        }
        catch (workflowError) {
          project = getProject(id);
          if (project) {
            project.workflowWarning = String(workflowError.message || workflowError).slice(0, 500);
            saveProject(project);
          }
        }
      }
    }).catch(function (err) {
      const project = getProject(id);
      fs.rm(renderPath(id), { force: true }, function () {});
      fs.rm(renderPreviewPath(id), { force: true }, function () {});
      if (project) {
        project.renderStatus = 'error';
        project.renderProgress = 0;
        project.renderError = String(err.message || err).slice(0, 1000);
        project.renderQuality = { status: 'failed', checkedAt: new Date().toISOString(), message: project.renderError };
        saveProject(project);
      }
    }, 'urgent').finally(function () { renderJobs.delete(id); });
    renderJobs.set(id, job);
    return job;
  }

  // A deploy cannot continue an in-flight provider/FFmpeg process, but every
  // source master and decision is durable. Requeue interrupted phases instead
  // of turning a routine service restart into manual babysitting.
  listStmt.all(STORE_NAME).forEach(function (row) {
    try {
      const project = JSON.parse(row.data);
      let migrated = false;
      const canResumeWork = !project.productionPieceId;
      if (project.renderStatus === undefined || project.renderStatus === null) { project.renderStatus = ''; migrated = true; }
      if (typeof project.renderRebuildPending !== 'boolean') { project.renderRebuildPending = false; migrated = true; }
      if (!Number.isFinite(Number(project.editRevision))) { project.editRevision = 0; migrated = true; }
      if (!Number.isFinite(Number(project.renderProgress))) { project.renderProgress = 0; migrated = true; }
      if (!Array.isArray(project.insertedClips)) { project.insertedClips = []; migrated = true; }
      if (['queued', 'preparing'].includes(project.clipInsertStatus)) {
        project.insertedClips = project.insertedClips.filter(function (clip) { return clip.status === 'ready'; });
        project.clipInsertStatus = 'error'; project.clipInsertError = 'Clip preparation was interrupted by a service restart. Press Insert clip to retry.'; migrated = true;
      }
      if (!project.retakeAnalysisStatus) { project.retakeAnalysisStatus = canResumeWork && typeof analyzeRetakes === 'function' ? (project.transcriptionStatus === 'ready' ? 'pending' : 'pending_transcript') : 'unavailable'; migrated = true; }
      if (!project.planningMatchStatus) { project.planningMatchStatus = canResumeWork && typeof matchPlanningPiece === 'function' ? (project.transcriptionStatus === 'ready' ? 'pending' : 'pending_transcript') : 'unavailable'; migrated = true; }
      if (!canResumeWork) {
        if (migrated) saveProject(project);
        return;
      }
      const recordedLayout = sourceLayout(project);
      const previousAutomaticLayout = project.layoutOverride === 'vertical' || project.layoutOverride === 'horizontal'
        ? project.layoutOverride
        : (sourceLayout(project) === 'vertical' ? 'vertical' : project.visualClassification && project.visualClassification.layout || recordedLayout);
      let migrationRequiresRender = previousAutomaticLayout !== recordedLayout && (!project.layoutOverride || project.layoutOverride === 'auto');
      if (project.classificationStatus !== 'ready' || !project.visualClassification || project.visualClassification.layout !== recordedLayout) {
        project.classificationStatus = 'ready';
        project.classificationError = '';
        project.visualClassification = {
          layout: recordedLayout, confidence: 'high', cropCenterX: 0.5,
          explanation: recordedLayout === 'vertical' ? 'Portrait camera orientation detected from the recording.' : 'Landscape camera orientation detected from the recording.'
        };
        migrated = true;
      }
      if (project.openingPushInEnabled === undefined) {
        project.openingPushInEnabled = true;
        migrationRequiresRender = true;
        migrated = true;
      }
      if (Array.isArray(project.punchIns) && project.punchIns.length) {
        project.punchIns = [];
        migrationRequiresRender = true;
        migrated = true;
      }
      // Older Editor projects finished transcript matching before that pass
      // also generated a useful queue label. Re-run only that lightweight
      // text phase once, retaining the camera filename separately in fileName.
      if (project.transcriptionStatus === 'ready' && typeof matchPlanningPiece === 'function' && !project.workingTitle) {
        project.planningMatchStatus = 'pending';
        project.planningMatchError = '';
        migrated = true;
      }
      if (migrationRequiresRender && project.renderStatus === 'ready') invalidateProjectRender(project);
      const resumeTranscription = project.transcriptionStatus === 'running' || project.transcriptionStatus === 'pending';
      const resumePreview = project.browserPreviewRequired && ['running', 'pending'].includes(project.browserPreviewStatus);
      const resumeRender = project.renderStatus === 'running' || project.renderStatus === 'queued';
      const resumeRetakes = ['running', 'pending', 'pending_transcript'].includes(project.retakeAnalysisStatus);
      const resumePlanning = ['running', 'pending', 'pending_transcript'].includes(project.planningMatchStatus);
      const orphanedRenderKickoff = !project.renderStatus && !!project.automaticRenderStartedAt;
      if (project.transcriptionStatus === 'running' || project.transcriptionStatus === 'pending') {
        project.transcriptionStatus = 'pending';
        project.transcriptionError = '';
      }
      if (resumePreview) {
        project.browserPreviewStatus = 'pending';
        project.browserPreviewError = '';
      }
      if (project.renderStatus === 'running' || project.renderStatus === 'queued') {
        project.renderStatus = '';
        project.renderError = '';
        project.automaticRenderStartedAt = '';
      }
      if (orphanedRenderKickoff) project.automaticRenderStartedAt = '';
      if (['running', 'pending', 'pending_transcript'].includes(project.retakeAnalysisStatus)) {
        project.retakeAnalysisStatus = project.transcriptionStatus === 'ready' ? 'pending' : 'pending_transcript';
        project.retakeAnalysisError = '';
      }
      if (['running', 'pending', 'pending_transcript'].includes(project.planningMatchStatus)) {
        project.planningMatchStatus = project.transcriptionStatus === 'ready' ? 'pending' : 'pending_transcript';
        project.planningMatchError = '';
      }
      const resumeAutomaticRender = (resumeRender || !project.renderStatus) && automaticReviewReady(project);
      if (migrated || resumeTranscription || resumePreview || resumeRender || resumeRetakes || resumePlanning || orphanedRenderKickoff || resumeAutomaticRender) saveProject(project);
      setImmediate(function () {
        if (resumeTranscription) transcribeProject(project.id);
        if (resumePreview) generateBrowserPreview(project.id);
        if (!resumeTranscription && project.transcriptionStatus === 'ready' && resumeRetakes) analyzeProjectRetakes(project.id);
        if (!resumeTranscription && project.transcriptionStatus === 'ready' && resumePlanning) matchProjectPlanningPiece(project.id);
        if (resumeAutomaticRender) maybeAutoRender(project.id);
      });
    } catch (e) {}
  });

  // Re-probe legacy sources for rotation and codecs. This both repairs old
  // display dimensions and creates a browser-safe H.264 review proxy when a
  // camera master (notably iPhone HEVC) is valid for FFmpeg but unreliable in
  // Chrome-class review browsers.
  setImmediate(function () {
    listStmt.all(STORE_NAME).forEach(function (row) {
      let project;
      try { project = JSON.parse(row.data); } catch (e) { return; }
      if (!project || project.productionPieceId || !isId(project.id) || !fs.existsSync(sourcePath(project.id))) return;
      probe(sourcePath(project.id)).then(async function (media) {
        let current = getProject(project.id);
        if (!current) return;
        const needsPreview = browserPreviewNeeded(current.fileName, media);
        const previewFile = previewPath(current.id);
        const previewValid = needsPreview && Number(current.browserPreviewVersion) === BROWSER_PREVIEW_VERSION && await browserPreviewIsValid(previewFile, current.duration);
        // Proxy validation performs asynchronous ffprobe work. Transcription or
        // another startup recovery can finish while it is in flight, so never
        // save the pre-await snapshot over that newer state.
        current = getProject(project.id);
        if (!current || current.productionPieceId) return;
        const dimensionsChanged = current.width !== media.width || current.height !== media.height;
        const previewMetadataChanged = !current.videoCodec || current.browserPreviewRequired === undefined || current.sourceRotation === undefined;
        const expectedPreviewStatus = needsPreview ? (previewValid ? 'ready' : 'pending') : 'not_required';
        const previewStateChanged = current.browserPreviewRequired !== needsPreview || current.browserPreviewStatus !== expectedPreviewStatus;
        if (!dimensionsChanged && !previewMetadataChanged && !previewStateChanged) return;
        current.videoCodec = media.videoCodec;
        current.audioCodec = media.audioCodec;
        current.sourceRotation = media.rotation;
        current.browserPreviewRequired = needsPreview;
        if (needsPreview && !previewValid) {
          await fs.promises.rm(previewFile, { force: true });
          current.browserPreviewStatus = 'pending';
          current.browserPreviewError = '';
          current.browserPreviewVersion = 0;
        } else if (needsPreview) {
          current.browserPreviewStatus = 'ready';
          current.browserPreviewError = '';
          current.browserPreviewVersion = BROWSER_PREVIEW_VERSION;
        } else if (!needsPreview) {
          await fs.promises.rm(previewFile, { force: true });
          current.browserPreviewStatus = 'not_required';
          current.browserPreviewError = '';
          current.browserPreviewVersion = 0;
        }
        if (dimensionsChanged) {
          current.width = media.width;
          current.height = media.height;
          const layout = sourceLayout(current);
          current.visualClassification = {
            layout: layout, confidence: 'high', cropCenterX: 0.5,
            explanation: layout === 'vertical' ? 'Portrait camera orientation detected from the recording.' : 'Landscape camera orientation detected from the recording.'
          };
          current.classificationStatus = 'ready';
          current.classificationError = '';
          invalidateProjectRender(current);
        }
        saveProject(current);
        if (current.browserPreviewRequired && current.browserPreviewStatus === 'pending') generateBrowserPreview(current.id);
        setImmediate(function () { maybeAutoRender(current.id); });
      }).catch(function () {});
    });
  });

  // Existing verified edits predate the dedicated low-resolution final-review
  // file. Build it in the background without touching or re-encoding the
  // authoritative final master.
  setImmediate(function () {
    listStmt.all(STORE_NAME).forEach(function (row) {
      let project;
      try { project = JSON.parse(row.data); } catch (error) { return; }
      if (!project || project.productionPieceId || project.renderStatus !== 'ready' || !isId(project.id) || !fs.existsSync(renderPath(project.id))) return;
      let previewExists = false;
      try { previewExists = fs.statSync(renderPreviewPath(project.id)).size > 1024; } catch (error) {}
      if (previewExists && Number(project.renderPreviewVersion) === BROWSER_PREVIEW_VERSION) return;
      project.renderPreviewStatus = 'pending';
      project.renderPreviewError = '';
      project.renderPreviewVersion = 0;
      saveProject(project);
      generateRenderPreview(project.id);
    });
  });

  // Render fingerprints were introduced after technical output verification.
  // Backfill active verified masters so a deploy does not force an otherwise
  // unchanged recording through another expensive encode at approval time.
  setImmediate(function () {
    listStmt.all(STORE_NAME).forEach(function (row) {
      let project;
      try { project = JSON.parse(row.data); } catch (e) { return; }
      if (!project || project.productionPieceId || project.renderStatus !== 'ready' || project.renderSha256 || !isId(project.id) || !fs.existsSync(renderPath(project.id))) return;
      const filePath = renderPath(project.id);
      let stat;
      try { stat = fs.statSync(filePath); } catch (error) { return; }
      if (!stat.isFile() || stat.size <= 1024 || stat.size !== Number(project.renderSizeBytes) || !project.renderQuality || project.renderQuality.status !== 'passed') return;
      hashFile(filePath).then(function (digest) {
        const current = getProject(project.id);
        if (!current || current.productionPieceId || current.renderStatus !== 'ready' || current.renderSha256 || current.renderSizeBytes !== stat.size) return;
        current.renderSha256 = digest;
        saveProject(current);
      }).catch(function () {});
    });
  });

  // A ready flag is not enough after a host crash, manual disk operation, or
  // filesystem fault. Verify fingerprints serially at startup so Harvey never
  // reviews a truncated/stale final that approval would only reject later.
  setImmediate(async function () {
    const rows = listStmt.all(STORE_NAME);
    for (const row of rows) {
      let snapshot;
      try { snapshot = JSON.parse(row.data); } catch (error) { continue; }
      if (!snapshot || snapshot.productionPieceId || snapshot.renderStatus !== 'ready' || !snapshot.renderSha256 || !isId(snapshot.id)) continue;
      if (Number(snapshot.renderVersion) !== EDITOR_RENDER_VERSION) {
        const current = getProject(snapshot.id);
        if (!current || current.productionPieceId || current.renderStatus !== 'ready' || current.renderSha256 !== snapshot.renderSha256) continue;
        invalidateProjectRender(current);
        saveProject(current);
        if (automaticReviewReady(current)) setImmediate(function () { maybeAutoRender(current.id); });
        continue;
      }
      const valid = await verifiedRenderMatches(snapshot, renderPath(snapshot.id));
      if (valid) continue;
      const current = getProject(snapshot.id);
      if (!current || current.productionPieceId || current.renderStatus !== 'ready' || current.renderSha256 !== snapshot.renderSha256) continue;
      invalidateProjectRender(current);
      saveProject(current);
      if (automaticReviewReady(current)) setImmediate(function () { maybeAutoRender(current.id); });
    }
  });

  // Older recordings predate byte-accurate duplicate detection. Hash their
  // durable masters once in the background so future uploads use content
  // identity rather than a camera filename/size guess.
  setImmediate(function () {
    listStmt.all(STORE_NAME).forEach(function (row) {
      let project;
      try { project = JSON.parse(row.data); } catch (e) { return; }
      if (!project || project.sourceSha256 || !isId(project.id) || !fs.existsSync(sourcePath(project.id))) return;
      hashFile(sourcePath(project.id)).then(function (digest) {
        const current = getProject(project.id);
        if (!current || current.sourceSha256) return;
        current.sourceSha256 = digest;
        saveProject(current);
      }).catch(function () {});
    });
  });

  router.get('/', function (req, res) {
    const projects = listStmt.all(STORE_NAME).map(function (row) {
      try {
        const project = JSON.parse(row.data);
        return withQueuePositions(projectListSummary(project));
      } catch (e) { return null; }
    }).filter(Boolean);
    res.json(projects);
  });

  async function acceptStoredEditorUpload(req, res) {
    // Multer has now materialized this request on disk. Release only its
    // admission reservation; reservations for other concurrent uploads stay
    // included in the definitive post-upload capacity check below.
    if (typeof req.releaseEditorUploadReservation === 'function') req.releaseEditorUploadReservation();
    if (!req.file || !req.file.path) return res.status(400).json({ error: 'missing_video' });
    const existingProjects = listStmt.all(STORE_NAME).map(function (row) { try { return JSON.parse(row.data); } catch (error) { return null; } }).filter(Boolean);
    if (availableDiskBytes() < requiredEditorCapacity(req.file.size, true) + outstandingEditorCapacity(existingProjects) + uploadCapacityReservations.total()) {
      fs.rm(req.file.path, { force: true }, function () {});
      return res.status(507).json({ error: 'insufficient_storage', message: 'There is not enough free workspace to safely render and hand off this recording. Clear old Editor files or VPS storage, then try again.' });
    }
    let sourceSha256;
    try { sourceSha256 = await hashFile(req.file.path); }
    catch (error) {
      fs.rm(req.file.path, { force: true }, function () {});
      return res.status(422).json({ error: 'hash_failed', message: 'The uploaded recording could not be read completely. Please try again.' });
    }
    const duplicate = listStmt.all(STORE_NAME).map(function (row) { try { return JSON.parse(row.data); } catch (e) { return null; } }).filter(Boolean).find(function (item) {
      return item.sourceSha256 && item.sourceSha256 === sourceSha256;
    });
    if (duplicate) {
      fs.rm(req.file.path, { force: true }, function () {});
      return res.status(409).json({ error: 'duplicate_recording', existingProjectId: duplicate.id, message: 'These exact video bytes are already in the Editor.' });
    }
    let sourceClaim;
    while (true) {
      sourceClaim = sourceHashClaims.claim(sourceSha256);
      if (sourceClaim.owner) break;
      const claimedProjectId = await sourceClaim.result;
      if (claimedProjectId) {
        fs.rm(req.file.path, { force: true }, function () {});
        return res.status(409).json({ error: 'duplicate_recording', existingProjectId: claimedProjectId, message: 'These exact video bytes are already being added to the Editor.' });
      }
      // The first claimant rejected an invalid/incomplete file. Compete for a
      // fresh claim so this independently received copy can still be probed.
    }
    const id = crypto.randomUUID();
    try {
      fs.mkdirSync(projectDir(id), { recursive: true });
      fs.renameSync(req.file.path, sourcePath(id));
      const media = await probe(sourcePath(id));
      if (!media.duration || !media.width || !media.height || !media.hasAudio) throw new Error('The recording must contain playable video and audio.');
      const now = new Date().toISOString();
      const project = saveProject({
        id: id,
        name: String((req.body && req.body.name) || req.file.originalname || 'Untitled recording').slice(0, 200),
        fileName: String(req.file.originalname || 'recording.mp4').slice(0, 255),
        mimeType: normalizedVideoMimeType(req.file.originalname, req.file.mimetype),
        sizeBytes: req.file.size,
        sourceSha256: sourceSha256,
        duration: media.duration,
        width: media.width,
        height: media.height,
        videoCodec: media.videoCodec,
        audioCodec: media.audioCodec,
        sourceRotation: media.rotation,
        browserPreviewRequired: browserPreviewNeeded(req.file.originalname, media),
        browserPreviewStatus: browserPreviewNeeded(req.file.originalname, media) ? 'pending' : 'not_required',
        browserPreviewError: '',
        browserPreviewVersion: 0,
        transcriptText: '',
        words: [],
        removedWordIndices: [],
        autoRetakeRemovedWordIndices: [],
        dismissedRetakeIds: [],
        restoredAutoCutIds: [],
        autoSilenceEnabled: true,
        silenceThresholdSeconds: 1,
        retainedPauseSeconds: 0.38,
        captionsEnabled: true,
        openingPushInEnabled: true,
        layoutOverride: 'auto',
        contentTypeOverride: 'auto',
        cropCenterX: 0.5,
        visualClassification: {
          layout: media.height > media.width ? 'vertical' : 'horizontal', confidence: 'high', cropCenterX: 0.5,
          explanation: media.height > media.width ? 'Portrait camera orientation detected from the recording.' : 'Landscape camera orientation detected from the recording.'
        },
        classificationStatus: 'ready',
        classificationError: '',
        retakeAnalysisStatus: typeof analyzeRetakes === 'function' ? 'pending_transcript' : 'unavailable',
        retakeAnalysisError: '',
        retakeDecisions: [],
        planningPieceId: '',
        planningPieceTitle: '',
        planningPieceSeq: 0,
        planningPieceManuallySelected: false,
        planningMatchStatus: typeof matchPlanningPiece === 'function' ? 'pending_transcript' : 'unavailable',
        planningMatchError: '',
        planningMatch: null,
        automaticRenderStartedAt: '',
        renderProgress: 0,
        transcriptionStatus: 'pending',
        transcriptionError: '',
        renderStatus: '',
        renderRebuildPending: false,
        renderError: '',
        renderPreviewStatus: '',
        renderPreviewError: '',
        renderPreviewVersion: 0,
        audioTrackId: '',
        insertedClips: [],
        clipInsertStatus: '',
        clipInsertError: '',
        editRevision: 0,
        createdAt: now,
        updatedAt: now
      });
      sourceClaim.settle(id);
      res.status(202).json(project);
      setImmediate(function () { transcribeProject(id); generateBrowserPreview(id); });
    } catch (err) {
      sourceClaim.settle('');
      fs.rm(req.file.path, { force: true }, function () {});
      fs.rm(projectDir(id), { recursive: true, force: true }, function () {});
      res.status(422).json({ error: 'invalid_recording', message: String(err.message || err) });
    }
  }

  router.post('/', ensureUploadCapacity, cleanAbortedUpload, upload.single('video'), acceptStoredEditorUpload);

  function releaseChunkUploadSession(uploadId, removeFile) {
    const session = chunkUploadSessions.get(uploadId);
    if (!session) return false;
    chunkUploadSessions.delete(uploadId);
    if (session.reservationToken) uploadCapacityReservations.release(session.reservationToken);
    if (removeFile) fs.rm(session.path, { force: true }, function () {});
    return true;
  }

  const chunkUploadCleanupTimer = setInterval(function () {
    const cutoff = Date.now() - EDITOR_UPLOAD_SESSION_TTL_MS;
    chunkUploadSessions.forEach(function (session, uploadId) {
      if (session.touchedAt < cutoff) releaseChunkUploadSession(uploadId, true);
    });
  }, 15 * 60 * 1000);
  if (typeof chunkUploadCleanupTimer.unref === 'function') chunkUploadCleanupTimer.unref();

  router.post('/uploads', function (req, res) {
    const fileName = String(req.body && req.body.fileName || 'recording.mp4').slice(0, 255);
    const mimeType = normalizedVideoMimeType(fileName, req.body && req.body.mimeType);
    const sizeBytes = Number(req.body && req.body.sizeBytes);
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_UPLOAD_BYTES) {
      return res.status(413).json({ error: 'invalid_upload_size', message: 'This recording is empty or larger than the 4.5 GB upload limit.' });
    }
    const projects = listStmt.all(STORE_NAME).map(function (row) { try { return JSON.parse(row.data); } catch (error) { return null; } }).filter(Boolean);
    const requestedCapacity = requiredEditorCapacity(sizeBytes, false);
    if (availableDiskBytes() < requestedCapacity + outstandingEditorCapacity(projects) + uploadCapacityReservations.total()) {
      return res.status(507).json({ error: 'insufficient_storage', message: 'There is not enough free workspace to safely edit this recording. Clear old Editor files or VPS storage, then try again.' });
    }
    const uploadId = crypto.randomUUID();
    const tempPath = path.join(tempDir, 'editor-upload-' + uploadId);
    try { fs.writeFileSync(tempPath, Buffer.alloc(0), { flag: 'wx' }); }
    catch (error) { return res.status(500).json({ error: 'upload_start_failed', message: 'The upload workspace could not be prepared. Please try again.' }); }
    const reservationToken = uploadCapacityReservations.reserve(requestedCapacity);
    chunkUploadSessions.set(uploadId, {
      id: uploadId,
      path: tempPath,
      fileName: fileName,
      mimeType: mimeType,
      name: String(req.body && req.body.name || fileName.replace(/\.[^.]+$/, '')).slice(0, 200),
      sizeBytes: sizeBytes,
      receivedBytes: 0,
      nextChunkIndex: 0,
      reservationToken: reservationToken,
      touchedAt: Date.now()
    });
    res.status(201).json({ id: uploadId, chunkSize: EDITOR_UPLOAD_CHUNK_BYTES, receivedBytes: 0 });
  });

  router.post('/uploads/:uploadId/chunks/:chunkIndex', express.raw({ type: 'application/octet-stream', limit: EDITOR_UPLOAD_CHUNK_BYTES + 1024 }), async function (req, res) {
    const session = chunkUploadSessions.get(req.params.uploadId);
    if (!session) return res.status(404).json({ error: 'upload_session_missing', message: 'This upload session expired. The Editor will restart it automatically.' });
    const chunkIndex = Number(req.params.chunkIndex);
    const offset = Number(req.headers['x-upload-offset']);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || !Number.isInteger(offset) || offset < 0) {
      return res.status(400).json({ error: 'invalid_upload_chunk' });
    }
    // A response can be lost after the bytes were safely appended. Treat a
    // repeated completed chunk as success so the browser can retry without
    // duplicating any bytes in the camera master.
    if (chunkIndex < session.nextChunkIndex && offset + Buffer.byteLength(req.body || Buffer.alloc(0)) <= session.receivedBytes) {
      session.touchedAt = Date.now();
      return res.json({ receivedBytes: session.receivedBytes, nextChunkIndex: session.nextChunkIndex, duplicate: true });
    }
    if (chunkIndex !== session.nextChunkIndex || offset !== session.receivedBytes) {
      return res.status(409).json({ error: 'upload_chunk_out_of_order', receivedBytes: session.receivedBytes, nextChunkIndex: session.nextChunkIndex });
    }
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const expectedBytes = Math.min(EDITOR_UPLOAD_CHUNK_BYTES, session.sizeBytes - session.receivedBytes);
    if (!body.length || body.length !== expectedBytes) {
      return res.status(400).json({ error: 'invalid_upload_chunk_size', message: 'A video chunk arrived incomplete. The Editor will retry it.' });
    }
    try { await fs.promises.appendFile(session.path, body); }
    catch (error) {
      releaseChunkUploadSession(session.id, true);
      return res.status(507).json({ error: 'upload_write_failed', message: 'The server could not store the next part of this recording.' });
    }
    session.receivedBytes += body.length;
    session.nextChunkIndex++;
    session.touchedAt = Date.now();
    res.json({ receivedBytes: session.receivedBytes, nextChunkIndex: session.nextChunkIndex });
  });

  router.post('/uploads/:uploadId/complete', async function (req, res) {
    const session = chunkUploadSessions.get(req.params.uploadId);
    if (!session) return res.status(404).json({ error: 'upload_session_missing', message: 'This upload session expired. Please try the recording again.' });
    if (session.receivedBytes !== session.sizeBytes) {
      return res.status(409).json({ error: 'upload_incomplete', receivedBytes: session.receivedBytes, sizeBytes: session.sizeBytes });
    }
    chunkUploadSessions.delete(session.id);
    uploadCapacityReservations.release(session.reservationToken);
    return acceptStoredEditorUpload({
      file: { path: session.path, size: session.sizeBytes, originalname: session.fileName, mimetype: session.mimeType },
      body: { name: session.name }
    }, res);
  });

  router.delete('/uploads/:uploadId', function (req, res) {
    releaseChunkUploadSession(req.params.uploadId, true);
    res.status(204).end();
  });

  router.get('/audio-tracks', function (req, res) {
    if (typeof getAudioTracks !== 'function') return res.status(501).json({ error: 'audio_library_unavailable' });
    const tracks = (getAudioTracks() || []).filter(function (track) {
      return track && isId(track.id) && typeof getAudioTrackPath === 'function' && fs.existsSync(getAudioTrackPath(track.id) || '');
    }).map(function (track) {
      return { id: track.id, name: String(track.name || track.fileName || 'Untitled track').slice(0, 200), note: String(track.note || '').slice(0, 500) };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    const settings = typeof getAudioMixSettings === 'function' ? getAudioMixSettings() || {} : {};
    const mixVersion = crypto.createHash('sha256').update(AUDIO_PREVIEW_MIX_VERSION + ':' + JSON.stringify(settings)).digest('hex').slice(0, 16);
    res.json({ tracks: tracks, mixVersion: mixVersion });
  });

  router.get('/:id', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    res.json(withQueuePositions(projectDetail(project)));
    maybeAutoRender(project.id);
  });

  router.patch('/:id', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    const mutationId = /^[A-Za-z0-9_-]{8,100}$/.test(String(req.body && req.body.mutationId || '')) ? String(req.body.mutationId) : '';
    if (mutationId && (project.recentMutationIds || []).includes(mutationId)) {
      return res.json(withQueuePositions(projectDetail(project)));
    }
    if (project.productionPieceId) return res.status(409).json({ error: 'approved_read_only', message: 'This approved edit is locked. Make downstream changes in Content Production.' });
    if (productionJobs.has(project.id)) return res.status(409).json({ error: 'approval_in_progress', message: 'This edit is currently being sent to Content Production.' });
    if (renderJobs.has(project.id)) return res.status(409).json({ error: 'render_in_progress', message: 'Wait for this final edit to finish before changing its cut settings.' });
    if (Number.isFinite(Number(req.body && req.body.expectedEditRevision)) && Number(req.body.expectedEditRevision) !== (Number(project.editRevision) || 0)) {
      return res.status(409).json({ error: 'edit_conflict', message: 'This recording changed on another screen. Its latest edit has been reloaded.', editRevision: Number(project.editRevision) || 0 });
    }
    const renderWillChange = patchAffectsRender(req.body);
    const currentRemovedWordIndices = (project.removedWordIndices || []).map(Number).sort(function (a, b) { return a - b; });
    const currentDismissedRetakeIds = (project.dismissedRetakeIds || []).map(String).sort();
    const currentRestoredAutoCutIds = (project.restoredAutoCutIds || []).map(String).sort();
    const currentAutoSilenceEnabled = project.autoSilenceEnabled !== false;
    const currentSilenceThresholdSeconds = Number(project.silenceThresholdSeconds) || 1;
    const currentRetainedPauseSeconds = Number(project.retainedPauseSeconds) || 0.38;
    const nextRemovedWordIndices = Array.isArray(req.body && req.body.removedWordIndices)
      ? Array.from(new Set(req.body.removedWordIndices.map(Number).filter(function (index) { return Number.isInteger(index) && index >= 0 && index < (project.words || []).length; }))).sort(function (a, b) { return a - b; })
      : currentRemovedWordIndices;
    const nextDismissedRetakeIds = Array.isArray(req.body && req.body.dismissedRetakeIds)
      ? Array.from(new Set(req.body.dismissedRetakeIds.map(String).filter(function (id) { return /^(?:retake-\d+|smart-retake-\d+-\d+-\d+)$/.test(id); }))).sort()
      : currentDismissedRetakeIds;
    const nextRestoredAutoCutIds = Array.isArray(req.body && req.body.restoredAutoCutIds)
      ? Array.from(new Set(req.body.restoredAutoCutIds.map(String).filter(function (id) { return /^(lead|tail|gap-\d+)$/.test(id); }))).sort()
      : currentRestoredAutoCutIds;
    const nextAutoSilenceEnabled = typeof (req.body && req.body.autoSilenceEnabled) === 'boolean' ? req.body.autoSilenceEnabled : currentAutoSilenceEnabled;
    const nextSilenceThresholdSeconds = Number.isFinite(Number(req.body && req.body.silenceThresholdSeconds)) ? clamp(req.body.silenceThresholdSeconds, 0.65, 5) : currentSilenceThresholdSeconds;
    const nextRetainedPauseSeconds = Number.isFinite(Number(req.body && req.body.retainedPauseSeconds)) ? clamp(req.body.retainedPauseSeconds, 0.18, 1.2) : currentRetainedPauseSeconds;
    let decisionSnapshotSaved = false;
    function saveDecisionSnapshot() {
      if (decisionSnapshotSaved) return;
      const snapshot = {
        removedWordIndices: currentRemovedWordIndices,
        dismissedRetakeIds: currentDismissedRetakeIds,
        autoRetakeRemovedWordIndices: (project.autoRetakeRemovedWordIndices || []).map(Number),
        restoredAutoCutIds: currentRestoredAutoCutIds,
        autoSilenceEnabled: currentAutoSilenceEnabled,
        silenceThresholdSeconds: currentSilenceThresholdSeconds,
        retainedPauseSeconds: currentRetainedPauseSeconds
      };
      project.cutDecisionHistory = (Array.isArray(project.cutDecisionHistory) ? project.cutDecisionHistory : []).concat([snapshot]).slice(-50);
      decisionSnapshotSaved = true;
    }
    if (JSON.stringify(nextRemovedWordIndices) !== JSON.stringify(currentRemovedWordIndices) || JSON.stringify(nextDismissedRetakeIds) !== JSON.stringify(currentDismissedRetakeIds)) {
      saveDecisionSnapshot();
      project.removedWordIndices = nextRemovedWordIndices;
      project.dismissedRetakeIds = nextDismissedRetakeIds;
      const dismissedOwnedIndices = new Set(retakeCandidatesForProject(project).filter(function (candidate) {
        return nextDismissedRetakeIds.includes(candidate.id);
      }).flatMap(function (candidate) { return candidate.removeWordIndices; }));
      project.autoRetakeRemovedWordIndices = (project.autoRetakeRemovedWordIndices || []).map(Number).filter(function (index) {
        return nextRemovedWordIndices.includes(index) && !dismissedOwnedIndices.has(index);
      });
    }
    if (JSON.stringify(nextRestoredAutoCutIds) !== JSON.stringify(currentRestoredAutoCutIds) ||
        nextAutoSilenceEnabled !== currentAutoSilenceEnabled ||
        Number(nextSilenceThresholdSeconds) !== currentSilenceThresholdSeconds ||
        Number(nextRetainedPauseSeconds) !== currentRetainedPauseSeconds) saveDecisionSnapshot();
    if (req.body && req.body.wordCorrection && typeof req.body.wordCorrection === 'object') {
      const index = Number(req.body.wordCorrection.index);
      const word = Number.isInteger(index) && index >= 0 ? (project.words || [])[index] : null;
      const replacement = String(req.body.wordCorrection.text || '').replace(/[\r\n]+/g, ' ').trim();
      if (!word || !replacement || replacement.length > 40 || (effectiveLayout(project) === 'vertical' && /\s/.test(replacement))) {
        return res.status(400).json({ error: 'invalid_word_correction', message: 'Choose one transcript word and enter 1–40 characters.' });
      }
      if (!word.originalText) word.originalText = word.text;
      word.text = replacement;
      if (word.text === word.originalText) delete word.originalText;
      project.transcriptText = (project.words || []).map(function (item) { return item.text; }).join(' ');
    }
    project.autoSilenceEnabled = nextAutoSilenceEnabled;
    project.restoredAutoCutIds = nextRestoredAutoCutIds;
    if (typeof (req.body && req.body.captionsEnabled) === 'boolean') project.captionsEnabled = req.body.captionsEnabled;
    if (typeof (req.body && req.body.openingPushInEnabled) === 'boolean') project.openingPushInEnabled = req.body.openingPushInEnabled;
    if (['auto', 'vertical', 'horizontal'].includes(req.body && req.body.layoutOverride)) project.layoutOverride = req.body.layoutOverride;
    if (['auto', 'ultra_short', 'short', 'long_short', 'longform'].includes(req.body && req.body.contentTypeOverride)) project.contentTypeOverride = req.body.contentTypeOverride;
    if (typeof (req.body && req.body.audioTrackId) === 'string') {
      const requestedTrackId = req.body.audioTrackId;
      const available = typeof getAudioTracks === 'function' ? (getAudioTracks() || []) : [];
      if (requestedTrackId && requestedTrackId !== '__none__' && !available.some(function (track) { return track && track.id === requestedTrackId; })) {
        return res.status(400).json({ error: 'invalid_audio_track', message: 'Choose an available backing track or No backing music.' });
      }
      project.audioTrackId = requestedTrackId;
      if (requestedTrackId && typeof getAudioMixSettings === 'function') project.audioMixSettings = getAudioMixSettings() || {};
      if (!requestedTrackId) delete project.audioMixSettings;
    }
    project.silenceThresholdSeconds = nextSilenceThresholdSeconds;
    project.retainedPauseSeconds = nextRetainedPauseSeconds;
    if (typeof (req.body && req.body.planningPieceId) === 'string' && typeof getPlanningCandidates === 'function') {
      const requested = req.body.planningPieceId;
      const candidate = getPlanningCandidates(project).find(function (item) { return item.id === requested; });
      const valid = !requested || !!candidate;
      if (valid) {
        const previousPlanningPieceId = project.planningPieceId || '';
        project.planningPieceId = requested;
        project.planningPieceTitle = candidate && candidate.title || '';
        project.planningPieceSeq = candidate ? Number(candidate.seq) || 0 : 0;
        project.planningPieceManuallySelected = true;
        if (requested !== previousPlanningPieceId && typeof onPlanningPieceChanged === 'function') {
          try { onPlanningPieceChanged({ project: project, previousPlanningPieceId: previousPlanningPieceId, renderWillChange: renderWillChange }); }
          catch (error) {
            return res.status(422).json({ error: 'planning_link_update_failed', message: 'The prior planning-card stage could not be reconciled. Nothing was saved.' });
          }
        }
      }
    }
    if (renderWillChange) invalidateProjectRender(project);
    advanceEditRevision(project);
    if (mutationId) project.recentMutationIds = (Array.isArray(project.recentMutationIds) ? project.recentMutationIds : []).concat([mutationId]).slice(-100);
    saveProject(project);
    res.json(projectDetail(project));
    if (patchNeedsAutoRender(project, renderWillChange)) scheduleAutoRender(project.id, EDIT_RENDER_DEBOUNCE_MS);
  });

  router.post('/:id/undo-cut', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    const mutationId = /^[A-Za-z0-9_-]{8,100}$/.test(String(req.body && req.body.mutationId || '')) ? String(req.body.mutationId) : '';
    if (mutationId && (project.recentMutationIds || []).includes(mutationId)) {
      return res.json(withQueuePositions(projectDetail(project)));
    }
    if (project.productionPieceId) return res.status(409).json({ error: 'approved_read_only', message: 'This approved edit is locked.' });
    if (renderJobs.has(project.id)) return res.status(409).json({ error: 'render_in_progress', message: 'Wait for this final edit to finish before undoing the decision.' });
    if (Number.isFinite(Number(req.body && req.body.expectedEditRevision)) && Number(req.body.expectedEditRevision) !== (Number(project.editRevision) || 0)) {
      return res.status(409).json({ error: 'edit_conflict', message: 'This recording changed on another screen. Reloaded the latest edit instead of undoing the wrong decision.', editRevision: Number(project.editRevision) || 0 });
    }
    const history = Array.isArray(project.cutDecisionHistory) ? project.cutDecisionHistory.slice() : [];
    if (!history.length) return res.status(409).json({ error: 'nothing_to_undo', message: 'There is no earlier edit decision to restore.' });
    const snapshot = history.pop();
    if (Array.isArray(snapshot)) {
      project.removedWordIndices = snapshot;
      const restoredIndices = new Set(snapshot.map(Number));
      project.autoRetakeRemovedWordIndices = (project.autoRetakeRemovedWordIndices || []).map(Number).filter(function (index) {
        return restoredIndices.has(index);
      });
    }
    else {
      project.removedWordIndices = Array.isArray(snapshot && snapshot.removedWordIndices) ? snapshot.removedWordIndices : [];
      project.dismissedRetakeIds = Array.isArray(snapshot && snapshot.dismissedRetakeIds) ? snapshot.dismissedRetakeIds : [];
      project.autoRetakeRemovedWordIndices = Array.isArray(snapshot && snapshot.autoRetakeRemovedWordIndices) ? snapshot.autoRetakeRemovedWordIndices : [];
      if (Array.isArray(snapshot && snapshot.restoredAutoCutIds)) project.restoredAutoCutIds = snapshot.restoredAutoCutIds;
      if (typeof (snapshot && snapshot.autoSilenceEnabled) === 'boolean') project.autoSilenceEnabled = snapshot.autoSilenceEnabled;
      if (Number.isFinite(Number(snapshot && snapshot.silenceThresholdSeconds))) project.silenceThresholdSeconds = Number(snapshot.silenceThresholdSeconds);
      if (Number.isFinite(Number(snapshot && snapshot.retainedPauseSeconds))) project.retainedPauseSeconds = Number(snapshot.retainedPauseSeconds);
    }
    project.cutDecisionHistory = history;
    invalidateProjectRender(project);
    advanceEditRevision(project);
    if (mutationId) project.recentMutationIds = (Array.isArray(project.recentMutationIds) ? project.recentMutationIds : []).concat([mutationId]).slice(-100);
    saveProject(project);
    res.json(projectDetail(project));
    scheduleAutoRender(project.id, EDIT_RENDER_DEBOUNCE_MS);
  });

  router.post('/:id/transcribe', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (project.productionPieceId) return res.status(409).json({ error: 'approved_read_only', message: 'This approved edit is locked.' });
    res.status(202).json({ ok: true, status: 'running' });
    transcribeProject(project.id);
  });

  router.post('/:id/classify', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (project.productionPieceId) return res.status(409).json({ error: 'approved_read_only', message: 'This approved edit is locked.' });
    res.status(202).json({ ok: true, status: 'ready' });
    classifyProject(project.id);
  });

  router.post('/:id/analyze-retakes', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (project.productionPieceId) return res.status(409).json({ error: 'approved_read_only', message: 'This approved edit is locked.' });
    if (project.transcriptionStatus !== 'ready') return res.status(409).json({ error: 'transcript_not_ready' });
    if (typeof analyzeRetakes !== 'function') return res.status(501).json({ error: 'retake_analysis_unavailable' });
    res.status(202).json({ ok: true, status: 'running' });
    analyzeProjectRetakes(project.id);
  });

  router.post('/:id/match-planning-piece', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (project.productionPieceId) return res.status(409).json({ error: 'approved_read_only', message: 'This approved edit is locked.' });
    if (project.transcriptionStatus !== 'ready') return res.status(409).json({ error: 'transcript_not_ready' });
    if (typeof matchPlanningPiece !== 'function') return res.status(501).json({ error: 'planning_match_unavailable' });
    res.status(202).json({ ok: true, status: 'running' });
    matchProjectPlanningPiece(project.id);
  });

  router.post('/:id/insert-clip', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (project.productionPieceId) return res.status(409).json({ error: 'approved_read_only', message: 'This approved edit is locked.' });
    if (clipInsertJobs.has(project.id)) return res.status(409).json({ error: 'clip_insert_running', message: 'The current external clip is still being prepared.' });
    const afterWordIndex = Number(req.body && req.body.afterWordIndex);
    if (!Number.isInteger(afterWordIndex)) return res.status(400).json({ error: 'word_required', message: 'Select the transcript word the clip should follow.' });
    project.clipInsertStatus = 'queued'; project.clipInsertError = ''; saveProject(project);
    res.status(202).json({ ok: true, status: 'queued' });
    prepareInsertedClip(project.id, { afterWordIndex: afterWordIndex, directiveId: String(req.body && req.body.directiveId || '') });
  });

  router.delete('/:id/inserted-clips/:clipId', function (req, res) {
    if (!isId(req.params.id) || !isId(req.params.clipId)) return res.status(400).json({ error: 'invalid_id' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (project.productionPieceId) return res.status(409).json({ error: 'approved_read_only', message: 'This approved edit is locked.' });
    const before = project.insertedClips || [];
    const target = before.find(function (clip) { return clip.id === req.params.clipId; });
    if (!target) return res.status(404).json({ error: 'clip_not_found' });
    project.insertedClips = before.filter(function (clip) { return clip.id !== req.params.clipId; });
    project.clipInsertStatus = ''; project.clipInsertError = '';
    fs.rmSync(insertedClipPath(project.id, target.id), { force: true });
    invalidateProjectRender(project); advanceEditRevision(project); saveProject(project);
    res.json(projectDetail(project));
    scheduleAutoRender(project.id, 50);
  });

  router.post('/:id/render', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (project.productionPieceId) return res.status(409).json({ error: 'approved_read_only', message: 'This approved edit is locked. The approved video is already in Content Production.' });
    if (project.transcriptionStatus !== 'ready') return res.status(409).json({ error: 'transcript_not_ready' });
    if (['queued', 'preparing'].includes(project.clipInsertStatus)) return res.status(409).json({ error: 'clip_insert_running', message: 'Wait for the inserted clip to finish preparing.' });
    if (['pending', 'running', 'pending_transcript'].includes(project.retakeAnalysisStatus) || ['pending', 'running', 'pending_transcript'].includes(project.planningMatchStatus)) {
      return res.status(409).json({ error: 'automatic_edit_running', message: 'Wait for the automatic retake and planning checks to finish.' });
    }
    if (unresolvedRetakeCount(project) > 0) {
      return res.status(409).json({ error: 'retake_review_required', message: 'Review each possible retake before building the final edit.' });
    }
    const reviewFailure = blockingReviewFailure(project);
    if (reviewFailure) {
      return res.status(409).json({ error: 'automatic_review_failed', message: reviewFailure });
    }
    if (layoutReviewRequired(project)) {
      return res.status(409).json({ error: 'layout_review_required', message: 'Choose Vertical or Horizontal once to confirm this uncertain frame.' });
    }
    res.status(202).json({ ok: true, status: 'running' });
    renderProject(project.id);
  });

  router.post('/:id/retry-failed', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (project.productionPieceId) return res.status(409).json({ error: 'approved_read_only', message: 'This approved edit is locked.' });
    const retried = [];
    if (project.transcriptionStatus === 'error') {
      project.transcriptionStatus = 'pending'; project.transcriptionError = ''; retried.push('transcription');
    }
    if (project.browserPreviewRequired && project.browserPreviewStatus === 'error') {
      project.browserPreviewStatus = 'pending'; project.browserPreviewError = ''; retried.push('preview');
    }
    if (project.transcriptionStatus === 'ready' && project.retakeAnalysisStatus === 'error' && typeof analyzeRetakes === 'function') {
      project.retakeAnalysisStatus = 'pending'; project.retakeAnalysisError = ''; retried.push('retakes');
    }
    if (project.transcriptionStatus === 'ready' && project.planningMatchStatus === 'error' && typeof matchPlanningPiece === 'function') {
      project.planningMatchStatus = 'pending'; project.planningMatchError = ''; retried.push('planning');
    }
    if (project.renderStatus === 'error') {
      invalidateProjectRender(project); retried.push('render');
    }
    if (!retried.length) return res.status(409).json({ error: 'nothing_to_retry', message: 'No failed Editor step needs retrying.' });
    saveProject(project);
    res.status(202).json({ ok: true, retried: retried });
    if (retried.includes('transcription')) transcribeProject(project.id);
    if (retried.includes('preview')) generateBrowserPreview(project.id);
    if (retried.includes('retakes')) analyzeProjectRetakes(project.id);
    if (retried.includes('planning')) matchProjectPlanningPiece(project.id);
    if (retried.includes('render')) setImmediate(function () { maybeAutoRender(project.id); });
  });

  router.post('/:id/production', async function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    let project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (project.productionPieceId) {
      return res.json({ ok: true, pieceId: project.productionPieceId, alreadySent: true });
    }
    if (project.renderStatus !== 'ready' || !fs.existsSync(renderPath(project.id))) {
      return res.status(409).json({ error: 'render_not_ready', message: 'Finish the edit before sending it to production.' });
    }
    if (!project.audioTrackId) {
      return res.status(409).json({ error: 'audio_track_required', message: 'Choose a backing track or No backing music before sending this edit to Production.' });
    }
    if (project.audioTrackId !== '__none__' && (typeof getAudioTrackPath !== 'function' || !fs.existsSync(getAudioTrackPath(project.audioTrackId) || ''))) {
      return res.status(409).json({ error: 'audio_track_missing', message: 'The selected backing track is no longer available. Choose another track.' });
    }
    if (!(await verifiedRenderMatches(project, renderPath(project.id)))) {
      invalidateProjectRender(project);
      saveProject(project);
      res.status(409).json({ error: 'render_verification_stale', message: 'The final file no longer matches its verified render. Editor is rebuilding it automatically before approval.' });
      scheduleAutoRender(project.id, 0);
      return;
    }
    // Fingerprinting a large master is intentionally streamed and can take a
    // few seconds. Planning linkage is allowed to finish during that window,
    // so refresh metadata before handoff while requiring it still to reference
    // the exact render digest that was just verified.
    const verifiedRenderSha256 = project.renderSha256;
    project = getProject(project.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (project.productionPieceId) {
      return res.json({ ok: true, pieceId: project.productionPieceId, alreadySent: true });
    }
    if (project.renderStatus !== 'ready' || project.renderSha256 !== verifiedRenderSha256) {
      return res.status(409).json({ error: 'render_changed_during_approval', message: 'The edit changed while it was being approved. Review the latest finished version, then approve again.' });
    }
    if (typeof handoffToProduction !== 'function') return res.status(501).json({ error: 'production_handoff_unavailable' });
    const joinedExistingHandoff = productionJobs.has(project.id);
    let handoffJob = productionJobs.get(project.id);
    if (!handoffJob) {
      project.effectiveLayout = effectiveLayout(project);
      project.detectedContentType = contentTypeForProject(project, cutsForProject(project));
      handoffJob = Promise.resolve().then(function () {
        return handoffToProduction({ project: project, renderPath: renderPath(project.id) });
      }).then(function (result) {
        const current = getProject(project.id);
        if (current) {
          current.productionPieceId = result.pieceId;
          current.sentToProductionAt = new Date().toISOString();
          current.workflowWarning = result.workflowWarning || '';
          saveProject(current);
        }
        return result;
      });
      productionJobs.set(project.id, handoffJob);
    }
    try {
      const result = await handoffJob;
      res.status(joinedExistingHandoff ? 200 : 201).json({ ok: true, pieceId: result.pieceId, piece: result.piece || null, alreadySent: joinedExistingHandoff || !!result.alreadySent, workflowWarning: result.workflowWarning || '' });
    } catch (err) {
      res.status(422).json({ error: 'production_handoff_failed', message: String(err.message || err).slice(0, 1000) });
    } finally {
      if (productionJobs.get(project.id) === handoffJob) productionJobs.delete(project.id);
    }
  });

  router.get('/:id/source', function (req, res) {
    if (!isId(req.params.id) || !fs.existsSync(sourcePath(req.params.id))) return res.status(404).end();
    const project = getProject(req.params.id);
    if (!project) return res.status(404).end();
    let proxyExists = false;
    try { proxyExists = fs.statSync(previewPath(req.params.id)).size > 1024; } catch (error) {}
    const useProxy = project.browserPreviewRequired && project.browserPreviewStatus === 'ready' &&
      Number(project.browserPreviewVersion) === BROWSER_PREVIEW_VERSION && proxyExists;
    if (project.browserPreviewRequired && !useProxy) {
      if (project.browserPreviewStatus === 'ready') {
        project.browserPreviewStatus = 'pending';
        project.browserPreviewError = '';
        saveProject(project);
        generateBrowserPreview(project.id);
      }
      return res.status(project.browserPreviewStatus === 'error' ? 422 : 425).json({
        error: project.browserPreviewStatus === 'error' ? 'browser_preview_failed' : 'browser_preview_preparing',
        message: project.browserPreviewStatus === 'error' ? 'The browser review copy needs retrying.' : 'The browser review copy is still being prepared.'
      });
    }
    res.type(useProxy ? 'video/mp4' : normalizedVideoMimeType(project.fileName, project.mimeType));
    res.sendFile(useProxy ? previewPath(req.params.id) : sourcePath(req.params.id));
  });

  router.post('/:id/audio-preview/:trackId', async function (req, res) {
    if (!isId(req.params.id) || !isId(req.params.trackId)) return res.status(400).json({ error: 'invalid_params' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (project.renderStatus !== 'ready' || !project.renderSha256 || !fs.existsSync(renderPath(project.id))) {
      return res.status(409).json({ error: 'render_not_ready', message: 'The verified final edit must be ready before its soundtrack previews can be mixed.' });
    }
    const renderSha256 = project.renderSha256;
    try {
      const previewPath = await editorAudioPreview(project, req.params.trackId);
      const current = getProject(project.id);
      if (!current || current.renderStatus !== 'ready' || current.renderSha256 !== renderSha256) {
        return res.status(409).json({ error: 'render_changed', message: 'The edit changed while this soundtrack preview was building.' });
      }
      res.type('audio/mpeg');
      res.set('Cache-Control', 'private, max-age=7200');
      res.sendFile(previewPath);
    } catch (error) {
      res.status(422).json({ error: 'audio_preview_failed', message: String(error.message || error).slice(0, 500) });
    }
  });

  router.get('/:id/render', function (req, res) {
    if (!isId(req.params.id) || !fs.existsSync(renderPath(req.params.id))) return res.status(404).end();
    const project = getProject(req.params.id);
    if (!project || project.renderStatus !== 'ready') return res.status(404).end();
    res.type('video/mp4');
    if (req.query.inline === '1') {
      let previewExists = false;
      try { previewExists = fs.statSync(renderPreviewPath(req.params.id)).size > 1024; } catch (error) {}
      if (previewExists && project.renderPreviewStatus === 'ready' && Number(project.renderPreviewVersion) === BROWSER_PREVIEW_VERSION) {
        return res.sendFile(renderPreviewPath(req.params.id));
      }
      return res.sendFile(renderPath(req.params.id));
    }
    res.download(renderPath(req.params.id), path.parse(project.fileName || 'recording').name + '-edited.mp4');
  });

  router.delete('/:id', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    if (renderJobs.has(req.params.id)) return res.status(409).json({ error: 'render_in_progress', message: 'Wait for the final edit to finish before deleting this recording.' });
    if (clipInsertJobs.has(req.params.id)) return res.status(409).json({ error: 'clip_insert_running', message: 'Wait for the inserted clip to finish preparing before deleting this recording.' });
    if (productionJobs.has(req.params.id)) return res.status(409).json({ error: 'approval_in_progress', message: 'Wait for this edit to finish entering Content Production before deleting it.' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (typeof onProjectDeleted === 'function') {
      try { onProjectDeleted({ project: project }); }
      catch (error) { return res.status(422).json({ error: 'workflow_cleanup_failed', message: 'The linked planning card could not be reconciled, so the recording was kept safely.' }); }
    }
    if (automaticRenderTimers.has(req.params.id)) { clearTimeout(automaticRenderTimers.get(req.params.id)); automaticRenderTimers.delete(req.params.id); }
    pruneAudioPreviewCache(req.params.id);
    delStmt.run(STORE_NAME, req.params.id);
    fs.rm(projectDir(req.params.id), { recursive: true, force: true }, function () {});
    res.json({ ok: true });
  });

  return { router: router, transcribeProject: transcribeProject, generateBrowserPreview: generateBrowserPreview, classifyProject: classifyProject, analyzeProjectRetakes: analyzeProjectRetakes, matchProjectPlanningPiece: matchProjectPlanningPiece, renderProject: renderProject };
}

module.exports = {
  setup,
  maxUploadBytes: MAX_UPLOAD_BYTES,
  requiredEditorCapacity,
  outstandingEditorCapacity,
  createByteReservationLedger,
  createKeyedClaimRegistry,
  createPriorityTaskQueue,
  verifiedRenderMatches,
  normalizeWords,
  calculateAutoCuts,
  calculateManualCuts,
  mergeCuts,
  cutsForProject,
  keepSegments,
  editorTimelineSegments,
  renderCaptionGroups,
  parseInsertClipDirectives,
  clipTimestampSeconds,
  segmentAudioFades,
  mapSourceTimeToEdited,
  cameraResetStarts,
  cameraMotionState,
  cameraMotionForSegment,
  captionGroups,
  buildAss,
  displayDimensions,
  effectiveLayout,
  contentTypeForProject,
  invalidateRender,
  patchAffectsRender,
  patchNeedsAutoRender,
  hashFile,
  parseMaxVolume,
  renderDurationTolerance,
  cleanStaleTempFiles,
  cleanOrphanedEditorTempFiles,
  gapDecisions,
  retakeCandidates,
  normalizeRetakeDecisions,
  unresolvedRetakeCount,
  appliedRetakeCount,
  layoutReviewRequired,
  blockingReviewFailure,
  automaticReviewReady,
  advanceEditRevision,
  normalizedVideoMimeType,
  browserPreviewNeeded,
  openingPushInScale,
  openingPushInFilter,
  cameraMotionFilter,
  reconcileAutomaticRetakeCuts,
  projectListSummary
};
