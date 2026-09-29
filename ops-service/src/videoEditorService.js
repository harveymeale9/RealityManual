'use strict';

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const STORE_NAME = 'editorProjects';
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const EDIT_RENDER_DEBOUNCE_MS = 2500;
const EDITOR_DISK_RESERVE_BYTES = 2 * 1024 * 1024 * 1024;

function requiredEditorCapacity(fileBytes, fileAlreadyStored) {
  const bytes = Math.max(0, Number(fileBytes) || 0);
  // Source, Editor render, Production copy, and the later mixed final can all
  // coexist. Once Multer has stored the source, only the latter three remain
  // additional allocations.
  return EDITOR_DISK_RESERVE_BYTES + bytes * (fileAlreadyStored ? 3 : 4);
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

function hashFile(filePath) {
  return new Promise(function (resolve, reject) {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', function (chunk) { hash.update(chunk); });
    stream.on('error', reject);
    stream.on('end', function () { resolve(hash.digest('hex')); });
  });
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
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
  // A physically portrait master is already an unambiguous vertical piece.
  // Visual analysis is for Harvey's shared landscape overhead-camera setup,
  // where one dominant page means crop vertically and two full pages means
  // preserve the spread horizontally.
  if (sourceLayout(project) === 'vertical') return 'vertical';
  if (project && project.visualClassification && (project.visualClassification.layout === 'vertical' || project.visualClassification.layout === 'horizontal')) {
    return project.visualClassification.layout;
  }
  return sourceLayout(project);
}

function layoutReviewRequired(project) {
  return !!(sourceLayout(project) === 'horizontal' &&
    (!project.layoutOverride || project.layoutOverride === 'auto') &&
    project.visualClassification && project.visualClassification.confidence === 'low');
}

function blockingReviewFailure(project) {
  if (project && project.retakeAnalysisStatus === 'error') {
    return 'The automatic retake check failed. Retry it before building the final edit.';
  }
  if (project && sourceLayout(project) === 'horizontal' &&
      (!project.layoutOverride || project.layoutOverride === 'auto') && project.classificationStatus === 'error') {
    return 'Automatic framing failed. Retry it or choose Vertical or Horizontal yourself.';
  }
  return '';
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
    'layoutOverride', 'cropCenterX', 'silenceThresholdSeconds', 'retainedPauseSeconds'].some(function (key) {
    return Object.prototype.hasOwnProperty.call(body, key);
  });
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
  return (Array.isArray(raw) ? raw : []).map(function (decision, index) {
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
    return {
      id: 'smart-retake-' + index + '-' + start + '-' + end,
      removeWordIndices: removeWordIndices,
      firstText: words.slice(start, end + 1).map(function (word) { return word.text; }).join(' '),
      replacementText: words.slice(replacementStart, replacementEnd + 1).map(function (word) { return word.text; }).join(' '),
      confidence: decision.confidence === 'high' ? 'high' : 'review',
      reason: String(decision.reason || 'A nearby take may replace this wording.').slice(0, 300),
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
  const fontSize = Math.max(30, Math.round(Math.min(width, height) * (isLongform ? 0.06 : 0.111)));
  const emphasizedSize = Math.round(fontSize * 1.18);
  const marginV = Math.round(height * (isLongform ? 0.27 : 0.365));
  const header = [
    '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: ' + width, 'PlayResY: ' + height,
    'ScaledBorderAndShadow: yes', '', '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Arial,' + fontSize + ',&H0000FFFF,&H0000FFFF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,40,40,' + marginV + ',1',
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
    group.words.forEach(function (activeWord, activeIndex) {
      const eventStart = activeIndex === 0 ? group.start : activeWord.start;
      const eventEnd = activeIndex + 1 < group.words.length ? group.words[activeIndex + 1].start : group.end;
      if (eventEnd <= eventStart) return;
      const text = group.words.map(function (word, wordIndex) {
        const escaped = escapeAss(word.text);
        return wordIndex === activeIndex ? '{\\fs' + emphasizedSize + '\\bord4}' + escaped + '{\\r}' : escaped;
      }).join(' ');
      events.push('Dialogue: 0,' + assTime(eventStart) + ',' + assTime(eventEnd) + ',Default,,0,0,0,,' + text);
    });
  });
  return header.concat(events).join('\n') + '\n';
}

function setup(options) {
  options = options || {};
  const db = options.db;
  const dataDir = options.dataDir;
  const transcribeDetailed = options.transcribeDetailed;
  const handoffToProduction = options.handoffToProduction;
  const classifyVisualLayout = options.classifyVisualLayout;
  const analyzeRetakes = options.analyzeRetakes;
  const getPlanningCandidates = options.getPlanningCandidates;
  const matchPlanningPiece = options.matchPlanningPiece;
  const onRenderReady = options.onRenderReady;
  const onRenderInvalidated = options.onRenderInvalidated;
  const onPlanningPieceChanged = options.onPlanningPieceChanged;
  const onProjectDeleted = options.onProjectDeleted;
  if (!db || !dataDir || typeof transcribeDetailed !== 'function') throw new Error('video editor setup is incomplete');
  const router = express.Router();
  const rootDir = path.join(dataDir, 'editor');
  const tempDir = path.join(dataDir, 'tmp');
  fs.mkdirSync(rootDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });
  cleanStaleTempFiles(tempDir).catch(function () {});
  const tempCleanupTimer = setInterval(function () { cleanStaleTempFiles(tempDir).catch(function () {}); }, 6 * 60 * 60 * 1000);
  if (typeof tempCleanupTimer.unref === 'function') tempCleanupTimer.unref();
  const upload = multer({ dest: tempDir, limits: { fileSize: MAX_UPLOAD_BYTES } });
  const getStmt = db.prepare('SELECT data FROM records WHERE store_name = ? AND id = ?');
  const listStmt = db.prepare('SELECT data FROM records WHERE store_name = ? ORDER BY updated_at DESC');
  const putStmt = db.prepare('INSERT INTO records (store_name, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(store_name, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at');
  const delStmt = db.prepare('DELETE FROM records WHERE store_name = ? AND id = ?');
  const transcriptionJobs = new Map();
  const renderJobs = new Map();
  const productionJobs = new Map();
  let renderChain = Promise.resolve();
  const classificationJobs = new Map();
  const retakeJobs = new Map();
  const planningMatchJobs = new Map();
  const automaticRenderTimers = new Map();
  let transcriptionChain = Promise.resolve();
  let classificationChain = Promise.resolve();
  let retakeChain = Promise.resolve();
  let planningMatchChain = Promise.resolve();

  function invalidateProjectRender(project) {
    const hadVerifiedRender = project && project.renderStatus === 'ready';
    if (hadVerifiedRender && typeof onRenderInvalidated === 'function') {
      try { onRenderInvalidated({ project: project }); }
      catch (error) { project.workflowWarning = 'The edit changed safely, but its linked planning card could not be returned to Filmed.'; }
    }
    return invalidateRender(project);
  }

  function withQueuePositions(project) {
    if (!project) return project;
    const item = Object.assign({}, project);
    function position(jobs) {
      const index = Array.from(jobs.keys()).indexOf(project.id);
      return index === -1 ? 0 : index + 1;
    }
    item.transcriptionQueuePosition = position(transcriptionJobs);
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
  function projectDir(id) { return path.join(rootDir, id); }
  function sourcePath(id) { return path.join(projectDir(id), 'source'); }
  function renderPath(id) { return path.join(projectDir(id), 'render.mp4'); }
  function isId(id) { return /^[A-Za-z0-9_-]{1,128}$/.test(String(id || '')); }
  function availableDiskBytes() {
    try {
      const stat = fs.statfsSync(dataDir);
      return Number(stat.bavail) * Number(stat.bsize || stat.frsize || 4096);
    } catch (error) { return Infinity; }
  }
  function ensureUploadCapacity(req, res, next) {
    const contentLength = Number(req.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > 0 && availableDiskBytes() < requiredEditorCapacity(contentLength, false)) {
      return res.status(507).json({ error: 'insufficient_storage', message: 'There is not enough free workspace to safely edit this recording. Clear old Editor files or VPS storage, then try again.' });
    }
    next();
  }

  async function probe(filePath) {
    const result = await run('ffprobe', ['-v', 'error', '-show_entries',
      'format=duration:stream=codec_type,width,height,pix_fmt:stream_tags=rotate:stream_side_data=rotation',
      '-of', 'json', filePath], 'video probe');
    const parsed = JSON.parse(result.stdout || '{}');
    const video = (parsed.streams || []).find(function (stream) { return stream.codec_type === 'video'; }) || {};
    const sideRotation = (video.side_data_list || []).map(function (entry) { return Number(entry.rotation); })
      .find(function (value) { return Number.isFinite(value); });
    const tagRotation = video.tags && Number(video.tags.rotate);
    const dimensions = displayDimensions(video.width, video.height,
      Number.isFinite(sideRotation) ? sideRotation : Number.isFinite(tagRotation) ? tagRotation : 0);
    return {
      duration: Number(parsed.format && parsed.format.duration) || 0,
      width: dimensions.width,
      height: dimensions.height,
      pixelFormat: String(video.pix_fmt || ''),
      hasAudio: (parsed.streams || []).some(function (stream) { return stream.codec_type === 'audio'; })
    };
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
        const result = await transcribeDetailed(fs.readFileSync(audioPath), 'audio/mpeg');
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
        const removed = new Set((project.removedWordIndices || []).map(Number));
        decisions.filter(function (decision) { return decision.confidence === 'high'; }).forEach(function (decision) {
          decision.removeWordIndices.forEach(function (index) { removed.add(index); });
        });
        project.removedWordIndices = Array.from(removed).sort(function (a, b) { return a - b; });
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
        let result = { pieceId: '', confidence: 'none', reason: candidates.length ? 'No confident planning-card match.' : 'No Filmed cards are waiting.' };
        if (candidates.length) {
          try {
            result = await matchPlanningPiece({ project: project, candidates: candidates });
          } catch (firstError) {
            await new Promise(function (resolve) { setTimeout(resolve, 750); });
            result = await matchPlanningPiece({ project: project, candidates: candidates });
          }
        }
        project = getProject(id);
        if (!project) return;
        const matched = candidates.find(function (candidate) { return candidate.id === (result && result.pieceId); });
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
        saveProject(project);
        setImmediate(function () { maybeAutoRender(id); });
      } catch (err) {
        project = getProject(id);
        if (project) {
          project.planningMatchStatus = 'error';
          project.planningMatchError = String(err.message || err).slice(0, 500);
          saveProject(project);
        }
      }
    }).finally(function () { planningMatchJobs.delete(id); });
    planningMatchChain = job.catch(function () {});
    planningMatchJobs.set(id, job);
    return job;
  }

  async function classifyProject(id) {
    if (classificationJobs.has(id)) return classificationJobs.get(id);
    if (typeof classifyVisualLayout !== 'function') return;
    const job = classificationChain.catch(function () {}).then(async function () {
      let project = getProject(id);
      if (!project) return;
      project.classificationStatus = 'running';
      project.classificationError = '';
      saveProject(project);
      const sheetPath = path.join(projectDir(id), 'classification.jpg');
      try {
        if (sourceLayout(project) === 'vertical') {
          project.visualClassification = {
            layout: 'vertical', confidence: 'high', cropCenterX: 0.5,
            explanation: 'The camera master is already portrait, so this is an unambiguous vertical composition.'
          };
          project.classificationStatus = 'ready';
          project.classificationError = '';
          advanceEditRevision(project);
          saveProject(project);
          setImmediate(function () { maybeAutoRender(id); });
          return;
        }
        const sampleRate = Math.max(0.01, 3 / Math.max(1, Number(project.duration) || 1));
        await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath(id), '-vf',
          'fps=' + sampleRate.toFixed(6) + ',scale=480:-2,tile=3x1', '-frames:v', '1', '-q:v', '3', sheetPath], 'classification frames');
        const result = await classifyVisualLayout({ imagePath: sheetPath, width: project.width, height: project.height, duration: project.duration });
        project = getProject(id);
        if (!project) return;
        if (!result || !['vertical', 'horizontal'].includes(result.layout)) throw new Error('The visual classifier returned no usable layout.');
        project.visualClassification = {
          layout: result.layout,
          confidence: ['high', 'medium', 'low'].includes(result.confidence) ? result.confidence : 'low',
          explanation: String(result.explanation || '').slice(0, 300),
          cropCenterX: clamp(result.cropCenterX === undefined ? 0.5 : result.cropCenterX, 0, 1)
        };
        if (project.layoutOverride === 'auto' || !project.layoutOverride) project.cropCenterX = project.visualClassification.cropCenterX;
        project.classificationStatus = 'ready';
        project.classificationError = '';
        invalidateProjectRender(project);
        advanceEditRevision(project);
        saveProject(project);
        setImmediate(function () { maybeAutoRender(id); });
      } catch (err) {
        project = getProject(id);
        if (project) {
          project.classificationStatus = 'error';
          project.classificationError = String(err.message || err).slice(0, 500);
          saveProject(project);
        }
      } finally {
        fs.rm(sheetPath, { force: true }, function () {});
      }
    }).finally(function () { classificationJobs.delete(id); });
    classificationChain = job.catch(function () {});
    classificationJobs.set(id, job);
    return job;
  }

  function maybeAutoRender(id) {
    const project = getProject(id);
    if (!project || project.productionPieceId || project.automaticRenderStartedAt || project.renderStatus || project.transcriptionStatus !== 'ready') return false;
    if (!['ready', 'unavailable'].includes(project.classificationStatus)) return false;
    if (!['ready', 'unavailable'].includes(project.retakeAnalysisStatus)) return false;
    if (!['ready', 'unavailable'].includes(project.planningMatchStatus)) return false;
    if (unresolvedRetakeCount(project) > 0 || layoutReviewRequired(project)) return false;
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
    const job = renderChain.catch(function () {}).then(async function () {
      let project = getProject(id);
      if (!project) return;
      project.renderStatus = 'running';
      project.renderError = '';
      project.renderProgress = 0;
      saveProject(project);
      const cuts = cutsForProject(project);
      const segments = keepSegments(project.duration, cuts);
      if (!segments.length) throw new Error('Every part of the recording is currently cut. Restore some transcript first.');
      const expectedDuration = segments.reduce(function (sum, segment) { return sum + segment.end - segment.start; }, 0);
      const assPath = path.join(projectDir(id), 'captions.ass');
      const layout = effectiveLayout(project);
      const renderShape = layout === 'vertical' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
      if (project.captionsEnabled !== false) fs.writeFileSync(assPath, buildAss(renderShape, captionGroups(project, cuts)));
      const filters = [];
      const cropPosition = clamp(project.cropCenterX === undefined ? 0.5 : Number(project.cropCenterX), 0, 1);
      segments.forEach(function (segment, index) {
        const segmentDuration = segment.end - segment.start;
        let videoFilter = '[0:v]trim=start=' + segment.start.toFixed(3) + ':end=' + segment.end.toFixed(3) + ',setpts=PTS-STARTPTS';
        if (layout === 'vertical') {
          videoFilter += ",crop=w='min(iw\\,ih*9/16)':h='min(ih\\,iw*16/9)':x='(iw-ow)*" + cropPosition.toFixed(3) + "':y='(ih-oh)/2',scale=1080:1920,setsar=1";
        } else {
          videoFilter += ",crop=w='min(iw\\,ih*16/9)':h='min(ih\\,iw*9/16)':x='(iw-ow)/2':y='(ih-oh)/2',scale=1920:1080,setsar=1";
        }
        filters.push(videoFilter + '[v' + index + ']');
        // Tiny boundary fades prevent waveform discontinuities from creating
        // a click at transcript/jump cuts, without audibly crossfading words.
        filters.push('[0:a]atrim=start=' + segment.start.toFixed(3) + ':end=' + segment.end.toFixed(3) + ',asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.008,afade=t=out:st=' + Math.max(0, segmentDuration - 0.008).toFixed(3) + ':d=0.008[a' + index + ']');
      });
      const concatInputs = segments.map(function (_, index) { return '[v' + index + '][a' + index + ']'; }).join('');
      filters.push(concatInputs + 'concat=n=' + segments.length + ':v=1:a=1[joinedv][outa]');
      if (project.captionsEnabled !== false) filters.push("[joinedv]subtitles='" + assPath.replace(/'/g, "'\\''") + "'[outv]");
      else filters.push('[joinedv]null[outv]');
      let lastReportedProgress = -1;
      await runWithProgress('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath(id), '-filter_complex', filters.join(';'),
        '-map', '[outv]', '-map', '[outa]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', renderPath(id)], 'editor render', function (encodedSeconds) {
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
      const durationTolerance = Math.max(0.35, expectedDuration * 0.01);
      const qualityChecks = {
        playableFile: stat.size > 1024,
        correctFrame: renderedMedia.width === renderShape.width && renderedMedia.height === renderShape.height,
        standardPixelFormat: renderedMedia.pixelFormat === 'yuv420p',
        audioPresent: renderedMedia.hasAudio,
        durationMatches: Math.abs(renderedMedia.duration - expectedDuration) <= durationTolerance
      };
      if (Object.keys(qualityChecks).some(function (key) { return !qualityChecks[key]; })) {
        throw new Error('Rendered output failed technical verification: ' + Object.keys(qualityChecks).filter(function (key) { return !qualityChecks[key]; }).join(', '));
      }
      project.renderStatus = 'ready';
      project.renderProgress = 100;
      project.renderSizeBytes = stat.size;
      project.editedDuration = expectedDuration;
      project.renderQuality = {
        status: 'passed', checkedAt: new Date().toISOString(), checks: qualityChecks,
        width: renderedMedia.width, height: renderedMedia.height, pixelFormat: renderedMedia.pixelFormat, duration: renderedMedia.duration
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
      if (project) {
        project.renderStatus = 'error';
        project.renderProgress = 0;
        project.renderError = String(err.message || err).slice(0, 1000);
        project.renderQuality = { status: 'failed', checkedAt: new Date().toISOString(), message: project.renderError };
        saveProject(project);
      }
    }).finally(function () { renderJobs.delete(id); });
    renderChain = job.catch(function () {});
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
      if (!Number.isFinite(Number(project.editRevision))) { project.editRevision = 0; migrated = true; }
      if (!Number.isFinite(Number(project.renderProgress))) { project.renderProgress = 0; migrated = true; }
      if (!project.classificationStatus) { project.classificationStatus = canResumeWork && typeof classifyVisualLayout === 'function' ? 'pending' : 'unavailable'; migrated = true; }
      if (!project.retakeAnalysisStatus) { project.retakeAnalysisStatus = canResumeWork && typeof analyzeRetakes === 'function' ? (project.transcriptionStatus === 'ready' ? 'pending' : 'pending_transcript') : 'unavailable'; migrated = true; }
      if (!project.planningMatchStatus) { project.planningMatchStatus = canResumeWork && typeof matchPlanningPiece === 'function' ? (project.transcriptionStatus === 'ready' ? 'pending' : 'pending_transcript') : 'unavailable'; migrated = true; }
      if (!canResumeWork) {
        if (migrated) saveProject(project);
        return;
      }
      const resumeTranscription = project.transcriptionStatus === 'running' || project.transcriptionStatus === 'pending';
      const resumeRender = project.renderStatus === 'running' || project.renderStatus === 'queued';
      const resumeClassification = project.classificationStatus === 'running' || project.classificationStatus === 'pending';
      const resumeRetakes = ['running', 'pending', 'pending_transcript'].includes(project.retakeAnalysisStatus);
      const resumePlanning = ['running', 'pending', 'pending_transcript'].includes(project.planningMatchStatus);
      if (project.transcriptionStatus === 'running' || project.transcriptionStatus === 'pending') {
        project.transcriptionStatus = 'pending';
        project.transcriptionError = '';
      }
      if (project.renderStatus === 'running' || project.renderStatus === 'queued') {
        project.renderStatus = '';
        project.renderError = '';
        project.automaticRenderStartedAt = '';
      }
      if (project.classificationStatus === 'running' || project.classificationStatus === 'pending') {
        project.classificationStatus = 'pending';
        project.classificationError = '';
      }
      if (['running', 'pending', 'pending_transcript'].includes(project.retakeAnalysisStatus)) {
        project.retakeAnalysisStatus = project.transcriptionStatus === 'ready' ? 'pending' : 'pending_transcript';
        project.retakeAnalysisError = '';
      }
      if (['running', 'pending', 'pending_transcript'].includes(project.planningMatchStatus)) {
        project.planningMatchStatus = project.transcriptionStatus === 'ready' ? 'pending' : 'pending_transcript';
        project.planningMatchError = '';
      }
      if (migrated || resumeTranscription || resumeRender || resumeClassification || resumeRetakes || resumePlanning) saveProject(project);
      setImmediate(function () {
        if (resumeTranscription) transcribeProject(project.id);
        if (resumeClassification) classifyProject(project.id);
        if (!resumeTranscription && project.transcriptionStatus === 'ready' && resumeRetakes) analyzeProjectRetakes(project.id);
        if (!resumeTranscription && project.transcriptionStatus === 'ready' && resumePlanning) matchProjectPlanningPiece(project.id);
        if (resumeRender) maybeAutoRender(project.id);
      });
    } catch (e) {}
  });

  // Older Editor uploads were probed without display-matrix rotation. Phone
  // recordings can therefore be physically 1920x1080 but displayed 1080x1920,
  // which selected landscape captions even though the browser visibly showed
  // a portrait video. Re-probe persisted sources once on startup and invalidate
  // only a stale render when the display dimensions change.
  setImmediate(function () {
    listStmt.all(STORE_NAME).forEach(function (row) {
      let project;
      try { project = JSON.parse(row.data); } catch (e) { return; }
      if (!project || project.productionPieceId || !isId(project.id) || !fs.existsSync(sourcePath(project.id))) return;
      probe(sourcePath(project.id)).then(function (media) {
        const current = getProject(project.id);
        if (!current || (current.width === media.width && current.height === media.height)) return;
        current.width = media.width;
        current.height = media.height;
        invalidateProjectRender(current);
        saveProject(current);
        setImmediate(function () { maybeAutoRender(current.id); });
      }).catch(function () {});
    });
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
        project.unresolvedRetakeCount = unresolvedRetakeCount(project);
        project.appliedRetakeCount = appliedRetakeCount(project);
        project.layoutReviewRequired = layoutReviewRequired(project);
        project.canUndoCut = Array.isArray(project.cutDecisionHistory) && project.cutDecisionHistory.length > 0;
        delete project.cutDecisionHistory;
        return withQueuePositions(project);
      } catch (e) { return null; }
    }).filter(Boolean);
    res.json(projects);
  });

  router.post('/', ensureUploadCapacity, upload.single('video'), async function (req, res) {
    if (!req.file || !req.file.path) return res.status(400).json({ error: 'missing_video' });
    if (availableDiskBytes() < requiredEditorCapacity(req.file.size, true)) {
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
        transcriptText: '',
        words: [],
        removedWordIndices: [],
        dismissedRetakeIds: [],
        restoredAutoCutIds: [],
        autoSilenceEnabled: true,
        silenceThresholdSeconds: 1,
        retainedPauseSeconds: 0.38,
        captionsEnabled: true,
        layoutOverride: 'auto',
        contentTypeOverride: 'auto',
        cropCenterX: 0.5,
        visualClassification: null,
        classificationStatus: typeof classifyVisualLayout === 'function' ? 'pending' : 'unavailable',
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
        renderError: '',
        editRevision: 0,
        createdAt: now,
        updatedAt: now
      });
      res.status(202).json(project);
      setImmediate(function () { transcribeProject(id); classifyProject(id); });
    } catch (err) {
      fs.rm(req.file.path, { force: true }, function () {});
      fs.rm(projectDir(id), { recursive: true, force: true }, function () {});
      res.status(422).json({ error: 'invalid_recording', message: String(err.message || err) });
    }
  });

  router.get('/:id', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
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
    res.json(withQueuePositions(project));
    maybeAutoRender(project.id);
  });

  router.patch('/:id', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (project.productionPieceId) return res.status(409).json({ error: 'approved_read_only', message: 'This approved edit is locked. Make downstream changes in Content Production.' });
    if (productionJobs.has(project.id)) return res.status(409).json({ error: 'approval_in_progress', message: 'This edit is currently being sent to Content Production.' });
    if (renderJobs.has(project.id)) return res.status(409).json({ error: 'render_in_progress', message: 'Wait for this final edit to finish before changing its cut settings.' });
    if (Number.isFinite(Number(req.body && req.body.expectedEditRevision)) && Number(req.body.expectedEditRevision) !== (Number(project.editRevision) || 0)) {
      return res.status(409).json({ error: 'edit_conflict', message: 'This recording changed on another screen. Its latest edit has been reloaded.', editRevision: Number(project.editRevision) || 0 });
    }
    const renderWillChange = patchAffectsRender(req.body);
    const currentRemovedWordIndices = (project.removedWordIndices || []).map(Number).sort(function (a, b) { return a - b; });
    const currentDismissedRetakeIds = (project.dismissedRetakeIds || []).map(String).sort();
    const nextRemovedWordIndices = Array.isArray(req.body && req.body.removedWordIndices)
      ? Array.from(new Set(req.body.removedWordIndices.map(Number).filter(function (index) { return Number.isInteger(index) && index >= 0 && index < (project.words || []).length; }))).sort(function (a, b) { return a - b; })
      : currentRemovedWordIndices;
    const nextDismissedRetakeIds = Array.isArray(req.body && req.body.dismissedRetakeIds)
      ? Array.from(new Set(req.body.dismissedRetakeIds.map(String).filter(function (id) { return /^(?:retake-\d+|smart-retake-\d+-\d+-\d+)$/.test(id); }))).sort()
      : currentDismissedRetakeIds;
    if (JSON.stringify(nextRemovedWordIndices) !== JSON.stringify(currentRemovedWordIndices) || JSON.stringify(nextDismissedRetakeIds) !== JSON.stringify(currentDismissedRetakeIds)) {
      const snapshot = { removedWordIndices: currentRemovedWordIndices, dismissedRetakeIds: currentDismissedRetakeIds };
      project.cutDecisionHistory = (Array.isArray(project.cutDecisionHistory) ? project.cutDecisionHistory : []).concat([snapshot]).slice(-50);
      project.removedWordIndices = nextRemovedWordIndices;
      project.dismissedRetakeIds = nextDismissedRetakeIds;
    }
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
    if (typeof (req.body && req.body.autoSilenceEnabled) === 'boolean') project.autoSilenceEnabled = req.body.autoSilenceEnabled;
    if (Array.isArray(req.body && req.body.restoredAutoCutIds)) {
      project.restoredAutoCutIds = Array.from(new Set(req.body.restoredAutoCutIds.map(String).filter(function (id) {
        return /^(lead|tail|gap-\d+)$/.test(id);
      })));
    }
    if (typeof (req.body && req.body.captionsEnabled) === 'boolean') project.captionsEnabled = req.body.captionsEnabled;
    if (['auto', 'vertical', 'horizontal'].includes(req.body && req.body.layoutOverride)) project.layoutOverride = req.body.layoutOverride;
    if (['auto', 'ultra_short', 'short', 'long_short', 'longform'].includes(req.body && req.body.contentTypeOverride)) project.contentTypeOverride = req.body.contentTypeOverride;
    if (Number.isFinite(Number(req.body && req.body.cropCenterX))) project.cropCenterX = clamp(req.body.cropCenterX, 0, 1);
    if (Number.isFinite(Number(req.body && req.body.silenceThresholdSeconds))) project.silenceThresholdSeconds = clamp(req.body.silenceThresholdSeconds, 0.65, 5);
    if (Number.isFinite(Number(req.body && req.body.retainedPauseSeconds))) project.retainedPauseSeconds = clamp(req.body.retainedPauseSeconds, 0.18, 1.2);
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
    saveProject(project);
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
    res.json(project);
    if (patchNeedsAutoRender(project, renderWillChange)) scheduleAutoRender(project.id, EDIT_RENDER_DEBOUNCE_MS);
  });

  router.post('/:id/undo-cut', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (project.productionPieceId) return res.status(409).json({ error: 'approved_read_only', message: 'This approved edit is locked.' });
    if (renderJobs.has(project.id)) return res.status(409).json({ error: 'render_in_progress', message: 'Wait for this final edit to finish before undoing the decision.' });
    if (Number.isFinite(Number(req.body && req.body.expectedEditRevision)) && Number(req.body.expectedEditRevision) !== (Number(project.editRevision) || 0)) {
      return res.status(409).json({ error: 'edit_conflict', message: 'This recording changed on another screen. Reloaded the latest edit instead of undoing the wrong decision.', editRevision: Number(project.editRevision) || 0 });
    }
    const history = Array.isArray(project.cutDecisionHistory) ? project.cutDecisionHistory.slice() : [];
    if (!history.length) return res.status(409).json({ error: 'nothing_to_undo', message: 'There is no earlier edit decision to restore.' });
    const snapshot = history.pop();
    if (Array.isArray(snapshot)) project.removedWordIndices = snapshot;
    else {
      project.removedWordIndices = Array.isArray(snapshot && snapshot.removedWordIndices) ? snapshot.removedWordIndices : [];
      project.dismissedRetakeIds = Array.isArray(snapshot && snapshot.dismissedRetakeIds) ? snapshot.dismissedRetakeIds : [];
    }
    project.cutDecisionHistory = history;
    invalidateProjectRender(project);
    advanceEditRevision(project);
    saveProject(project);
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
    project.canUndoCut = history.length > 0;
    delete project.cutDecisionHistory;
    res.json(project);
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
    if (typeof classifyVisualLayout !== 'function') return res.status(501).json({ error: 'classification_unavailable' });
    res.status(202).json({ ok: true, status: 'running' });
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

  router.post('/:id/render', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (project.productionPieceId) return res.status(409).json({ error: 'approved_read_only', message: 'This approved edit is locked. The approved video is already in Content Production.' });
    if (project.transcriptionStatus !== 'ready') return res.status(409).json({ error: 'transcript_not_ready' });
    if (['pending', 'running'].includes(project.classificationStatus) || ['pending', 'running', 'pending_transcript'].includes(project.retakeAnalysisStatus) || ['pending', 'running', 'pending_transcript'].includes(project.planningMatchStatus)) {
      return res.status(409).json({ error: 'automatic_edit_running', message: 'Wait for the automatic framing, retake, and planning checks to finish.' });
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
    if (project.classificationStatus === 'error' && typeof classifyVisualLayout === 'function') {
      project.classificationStatus = 'pending'; project.classificationError = ''; retried.push('classification');
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
    if (retried.includes('classification')) classifyProject(project.id);
    if (retried.includes('retakes')) analyzeProjectRetakes(project.id);
    if (retried.includes('planning')) matchProjectPlanningPiece(project.id);
    if (retried.includes('render')) setImmediate(function () { maybeAutoRender(project.id); });
  });

  router.post('/:id/production', async function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    let project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (project.renderStatus !== 'ready' || !fs.existsSync(renderPath(project.id))) {
      return res.status(409).json({ error: 'render_not_ready', message: 'Finish the edit before sending it to production.' });
    }
    if (project.productionPieceId) {
      return res.json({ ok: true, pieceId: project.productionPieceId, alreadySent: true });
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
    res.type(normalizedVideoMimeType(project.fileName, project.mimeType));
    res.sendFile(sourcePath(req.params.id));
  });

  router.get('/:id/render', function (req, res) {
    if (!isId(req.params.id) || !fs.existsSync(renderPath(req.params.id))) return res.status(404).end();
    const project = getProject(req.params.id);
    if (!project || project.renderStatus !== 'ready') return res.status(404).end();
    res.type('video/mp4');
    if (req.query.inline === '1') return res.sendFile(renderPath(req.params.id));
    res.download(renderPath(req.params.id), path.parse(project.fileName || 'recording').name + '-edited.mp4');
  });

  router.delete('/:id', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    if (renderJobs.has(req.params.id)) return res.status(409).json({ error: 'render_in_progress', message: 'Wait for the final edit to finish before deleting this recording.' });
    if (productionJobs.has(req.params.id)) return res.status(409).json({ error: 'approval_in_progress', message: 'Wait for this edit to finish entering Content Production before deleting it.' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (typeof onProjectDeleted === 'function') {
      try { onProjectDeleted({ project: project }); }
      catch (error) { return res.status(422).json({ error: 'workflow_cleanup_failed', message: 'The linked planning card could not be reconciled, so the recording was kept safely.' }); }
    }
    if (automaticRenderTimers.has(req.params.id)) { clearTimeout(automaticRenderTimers.get(req.params.id)); automaticRenderTimers.delete(req.params.id); }
    delStmt.run(STORE_NAME, req.params.id);
    fs.rm(projectDir(req.params.id), { recursive: true, force: true }, function () {});
    res.json({ ok: true });
  });

  return { router: router, transcribeProject: transcribeProject, classifyProject: classifyProject, analyzeProjectRetakes: analyzeProjectRetakes, matchProjectPlanningPiece: matchProjectPlanningPiece, renderProject: renderProject };
}

module.exports = {
  setup,
  requiredEditorCapacity,
  normalizeWords,
  calculateAutoCuts,
  calculateManualCuts,
  mergeCuts,
  cutsForProject,
  keepSegments,
  mapSourceTimeToEdited,
  captionGroups,
  buildAss,
  displayDimensions,
  effectiveLayout,
  contentTypeForProject,
  invalidateRender,
  patchAffectsRender,
  patchNeedsAutoRender,
  hashFile,
  cleanStaleTempFiles,
  gapDecisions,
  retakeCandidates,
  normalizeRetakeDecisions,
  unresolvedRetakeCount,
  appliedRetakeCount,
  layoutReviewRequired,
  blockingReviewFailure,
  advanceEditRevision,
  normalizedVideoMimeType
};
