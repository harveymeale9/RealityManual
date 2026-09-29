'use strict';

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const STORE_NAME = 'editorProjects';
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

function run(command, args, label) {
  return new Promise(function (resolve, reject) {
    execFile(command, args, { maxBuffer: 20 * 1024 * 1024 }, function (err, stdout, stderr) {
      if (err) return reject(new Error(label + ' failed: ' + String(stderr || err.message).slice(-2000)));
      resolve({ stdout: stdout, stderr: stderr });
    });
  });
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
    const start = Math.max(0, Math.floor(Number(decision.removeStartIndex)));
    const end = Math.min(words.length - 1, Math.floor(Number(decision.removeEndIndex)));
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start || end - start > 250) return null;
    const removeWordIndices = [];
    for (let wordIndex = start; wordIndex <= end; wordIndex++) removeWordIndices.push(wordIndex);
    const replacementStart = Math.max(0, Math.floor(Number(decision.replacementStartIndex)));
    const replacementEnd = Math.min(words.length - 1, Math.floor(Number(decision.replacementEndIndex)));
    return {
      id: 'smart-retake-' + index + '-' + start + '-' + end,
      removeWordIndices: removeWordIndices,
      firstText: words.slice(start, end + 1).map(function (word) { return word.text; }).join(' '),
      replacementText: replacementEnd >= replacementStart
        ? words.slice(replacementStart, replacementEnd + 1).map(function (word) { return word.text; }).join(' ')
        : String(decision.replacementText || ''),
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
  const fontSize = Math.max(30, Math.round(Math.min(width, height) * (isLongform ? 0.06 : 0.085)));
  const emphasizedSize = Math.round(fontSize * 1.18);
  const marginV = Math.round(height * 0.27);
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
        events.push('Dialogue: 0,' + assTime(eventStart) + ',' + assTime(eventEnd) + ',Default,,0,0,0,,' + escapeAss(word.text));
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
  if (!db || !dataDir || typeof transcribeDetailed !== 'function') throw new Error('video editor setup is incomplete');
  const router = express.Router();
  const rootDir = path.join(dataDir, 'editor');
  const tempDir = path.join(dataDir, 'tmp');
  fs.mkdirSync(rootDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });
  const upload = multer({ dest: tempDir, limits: { fileSize: MAX_UPLOAD_BYTES } });
  const getStmt = db.prepare('SELECT data FROM records WHERE store_name = ? AND id = ?');
  const listStmt = db.prepare('SELECT data FROM records WHERE store_name = ? ORDER BY updated_at DESC');
  const putStmt = db.prepare('INSERT INTO records (store_name, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(store_name, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at');
  const delStmt = db.prepare('DELETE FROM records WHERE store_name = ? AND id = ?');
  const transcriptionJobs = new Map();
  const renderJobs = new Map();
  const classificationJobs = new Map();
  const retakeJobs = new Map();
  const planningMatchJobs = new Map();

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

  async function probe(filePath) {
    const result = await run('ffprobe', ['-v', 'error', '-show_entries',
      'format=duration:stream=codec_type,width,height:stream_tags=rotate:stream_side_data=rotation',
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
      hasAudio: (parsed.streams || []).some(function (stream) { return stream.codec_type === 'audio'; })
    };
  }

  async function transcribeProject(id) {
    if (transcriptionJobs.has(id)) return transcriptionJobs.get(id);
    const job = (async function () {
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
        saveProject(project);
        if (project.words.length && typeof analyzeRetakes === 'function') setImmediate(function () { analyzeProjectRetakes(id); });
        if (project.words.length && typeof matchPlanningPiece === 'function') setImmediate(function () { matchProjectPlanningPiece(id); });
        setImmediate(function () { maybeAutoRender(id); });
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
    })().finally(function () { transcriptionJobs.delete(id); });
    transcriptionJobs.set(id, job);
    return job;
  }

  async function analyzeProjectRetakes(id) {
    if (retakeJobs.has(id)) return retakeJobs.get(id);
    if (typeof analyzeRetakes !== 'function') return;
    const job = (async function () {
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
        project.renderStatus = '';
        project.renderError = '';
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
    })().finally(function () { retakeJobs.delete(id); });
    retakeJobs.set(id, job);
    return job;
  }

  async function matchProjectPlanningPiece(id) {
    if (planningMatchJobs.has(id)) return planningMatchJobs.get(id);
    if (typeof matchPlanningPiece !== 'function' || typeof getPlanningCandidates !== 'function') return;
    const job = (async function () {
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
        if (matched && result.confidence === 'high' && !project.planningPieceManuallySelected) project.planningPieceId = matched.id;
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
    })().finally(function () { planningMatchJobs.delete(id); });
    planningMatchJobs.set(id, job);
    return job;
  }

  async function classifyProject(id) {
    if (classificationJobs.has(id)) return classificationJobs.get(id);
    if (typeof classifyVisualLayout !== 'function') return;
    const job = (async function () {
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
    })().finally(function () { classificationJobs.delete(id); });
    classificationJobs.set(id, job);
    return job;
  }

  function maybeAutoRender(id) {
    const project = getProject(id);
    if (!project || project.automaticRenderStartedAt || project.renderStatus || project.transcriptionStatus !== 'ready') return false;
    if (!['ready', 'unavailable'].includes(project.classificationStatus)) return false;
    if (!['ready', 'unavailable'].includes(project.retakeAnalysisStatus)) return false;
    if (!['ready', 'unavailable'].includes(project.planningMatchStatus)) return false;
    if (unresolvedRetakeCount(project) > 0) return false;
    project.automaticRenderStartedAt = new Date().toISOString();
    saveProject(project);
    setImmediate(function () { renderProject(id); });
    return true;
  }

async function renderProject(id) {
    if (renderJobs.has(id)) return renderJobs.get(id);
    const job = (async function () {
      let project = getProject(id);
      if (!project) return;
      project.renderStatus = 'running';
      project.renderError = '';
      saveProject(project);
      const cuts = cutsForProject(project);
      const segments = keepSegments(project.duration, cuts);
      if (!segments.length) throw new Error('Every part of the recording is currently cut. Restore some transcript first.');
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
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath(id), '-filter_complex', filters.join(';'),
        '-map', '[outv]', '-map', '[outa]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart', renderPath(id)], 'editor render');
      project = getProject(id);
      if (!project) return;
      const stat = fs.statSync(renderPath(id));
      project.renderStatus = 'ready';
      project.renderSizeBytes = stat.size;
      project.editedDuration = segments.reduce(function (sum, segment) { return sum + segment.end - segment.start; }, 0);
      project.lastRenderAt = new Date().toISOString();
      saveProject(project);
      if (typeof onRenderReady === 'function') {
        try { await Promise.resolve(onRenderReady({ project: project, renderPath: renderPath(id) })); }
        catch (workflowError) {
          project = getProject(id);
          if (project) {
            project.workflowWarning = String(workflowError.message || workflowError).slice(0, 500);
            saveProject(project);
          }
        }
      }
    })().catch(function (err) {
      const project = getProject(id);
      if (project) {
        project.renderStatus = 'error';
        project.renderError = String(err.message || err).slice(0, 1000);
        saveProject(project);
      }
    }).finally(function () { renderJobs.delete(id); });
    renderJobs.set(id, job);
    return job;
  }

  // A service restart cannot resume an external STT request or FFmpeg process.
  // Make interrupted work explicitly retryable rather than displaying a
  // permanent spinner.
  listStmt.all(STORE_NAME).forEach(function (row) {
    try {
      const project = JSON.parse(row.data);
      if (project.transcriptionStatus === 'running') {
        project.transcriptionStatus = 'error';
        project.transcriptionError = 'Transcription was interrupted by a service restart. Press Retry transcription.';
        saveProject(project);
      }
      if (project.renderStatus === 'running') {
        project.renderStatus = 'error';
        project.renderError = 'Rendering was interrupted by a service restart. Press Render video again.';
        saveProject(project);
      }
      if (project.classificationStatus === 'running') {
        project.classificationStatus = 'error';
        project.classificationError = 'Frame analysis was interrupted by a service restart. Press Analyze again.';
        saveProject(project);
      }
      if (project.retakeAnalysisStatus === 'running') {
        project.retakeAnalysisStatus = 'error';
        project.retakeAnalysisError = 'Retake analysis was interrupted by a service restart. Press Analyze retakes.';
        saveProject(project);
      }
      if (project.planningMatchStatus === 'running') {
        project.planningMatchStatus = 'error';
        project.planningMatchError = 'Planning-card matching was interrupted by a service restart. Press Match again.';
        saveProject(project);
      }
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
      if (!project || !isId(project.id) || !fs.existsSync(sourcePath(project.id))) return;
      probe(sourcePath(project.id)).then(function (media) {
        const current = getProject(project.id);
        if (!current || (current.width === media.width && current.height === media.height)) return;
        current.width = media.width;
        current.height = media.height;
        current.renderStatus = '';
        current.renderError = '';
        saveProject(current);
      }).catch(function () {});
    });
  });

  router.get('/', function (req, res) {
    const projects = listStmt.all(STORE_NAME).map(function (row) { try { return JSON.parse(row.data); } catch (e) { return null; } }).filter(Boolean);
    res.json(projects);
  });

  router.post('/', upload.single('video'), async function (req, res) {
    if (!req.file || !req.file.path) return res.status(400).json({ error: 'missing_video' });
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
        mimeType: req.file.mimetype || 'video/mp4',
        sizeBytes: req.file.size,
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
        planningPieceManuallySelected: false,
        planningMatchStatus: typeof matchPlanningPiece === 'function' ? 'pending_transcript' : 'unavailable',
        planningMatchError: '',
        planningMatch: null,
        automaticRenderStartedAt: '',
        transcriptionStatus: 'pending',
        transcriptionError: '',
        renderStatus: '',
        renderError: '',
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
    project.effectiveLayout = effectiveLayout(project);
    project.detectedContentType = contentTypeForProject(project, project.cuts);
    project.planningCandidates = typeof getPlanningCandidates === 'function' ? getPlanningCandidates(project) : [];
    res.json(project);
    setImmediate(function () { maybeAutoRender(project.id); });
  });

  router.patch('/:id', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (Array.isArray(req.body && req.body.removedWordIndices)) {
      project.removedWordIndices = Array.from(new Set(req.body.removedWordIndices.map(Number)
        .filter(function (index) { return Number.isInteger(index) && index >= 0 && index < (project.words || []).length; }))).sort(function (a, b) { return a - b; });
    }
    if (typeof (req.body && req.body.autoSilenceEnabled) === 'boolean') project.autoSilenceEnabled = req.body.autoSilenceEnabled;
    if (Array.isArray(req.body && req.body.restoredAutoCutIds)) {
      project.restoredAutoCutIds = Array.from(new Set(req.body.restoredAutoCutIds.map(String).filter(function (id) {
        return /^(lead|tail|gap-\d+)$/.test(id);
      })));
    }
    if (Array.isArray(req.body && req.body.dismissedRetakeIds)) {
      project.dismissedRetakeIds = Array.from(new Set(req.body.dismissedRetakeIds.map(String).filter(function (id) {
        return /^(?:retake-\d+|smart-retake-\d+-\d+-\d+)$/.test(id);
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
      const valid = !requested || getPlanningCandidates(project).some(function (candidate) { return candidate.id === requested; });
      if (valid) {
        project.planningPieceId = requested;
        project.planningPieceManuallySelected = true;
      }
    }
    project.renderStatus = '';
    project.renderError = '';
    saveProject(project);
    project.cuts = cutsForProject(project);
    project.captionGroups = captionGroups(project, project.cuts);
    project.gapDecisions = gapDecisions(project);
    project.retakeCandidates = retakeCandidatesForProject(project);
    project.unresolvedRetakeCount = unresolvedRetakeCount(project);
    project.effectiveLayout = effectiveLayout(project);
    project.detectedContentType = contentTypeForProject(project, project.cuts);
    project.planningCandidates = typeof getPlanningCandidates === 'function' ? getPlanningCandidates(project) : [];
    res.json(project);
    setImmediate(function () { maybeAutoRender(project.id); });
  });

  router.post('/:id/transcribe', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    res.status(202).json({ ok: true, status: 'running' });
    transcribeProject(project.id);
  });

  router.post('/:id/classify', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (typeof classifyVisualLayout !== 'function') return res.status(501).json({ error: 'classification_unavailable' });
    res.status(202).json({ ok: true, status: 'running' });
    classifyProject(project.id);
  });

  router.post('/:id/analyze-retakes', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (project.transcriptionStatus !== 'ready') return res.status(409).json({ error: 'transcript_not_ready' });
    if (typeof analyzeRetakes !== 'function') return res.status(501).json({ error: 'retake_analysis_unavailable' });
    res.status(202).json({ ok: true, status: 'running' });
    analyzeProjectRetakes(project.id);
  });

  router.post('/:id/match-planning-piece', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (project.transcriptionStatus !== 'ready') return res.status(409).json({ error: 'transcript_not_ready' });
    if (typeof matchPlanningPiece !== 'function') return res.status(501).json({ error: 'planning_match_unavailable' });
    res.status(202).json({ ok: true, status: 'running' });
    matchProjectPlanningPiece(project.id);
  });

  router.post('/:id/render', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (project.transcriptionStatus !== 'ready') return res.status(409).json({ error: 'transcript_not_ready' });
    if (['pending', 'running'].includes(project.classificationStatus) || ['pending', 'running', 'pending_transcript'].includes(project.retakeAnalysisStatus) || ['pending', 'running', 'pending_transcript'].includes(project.planningMatchStatus)) {
      return res.status(409).json({ error: 'automatic_edit_running', message: 'Wait for the automatic framing, retake, and planning checks to finish.' });
    }
    if (unresolvedRetakeCount(project) > 0) {
      return res.status(409).json({ error: 'retake_review_required', message: 'Review each possible retake before building the final edit.' });
    }
    res.status(202).json({ ok: true, status: 'running' });
    renderProject(project.id);
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
    try {
      project.effectiveLayout = effectiveLayout(project);
      project.detectedContentType = contentTypeForProject(project, cutsForProject(project));
      const result = await handoffToProduction({ project: project, renderPath: renderPath(project.id) });
      project = getProject(project.id);
      if (project) {
        project.productionPieceId = result.pieceId;
        project.sentToProductionAt = new Date().toISOString();
        saveProject(project);
      }
      res.status(201).json({ ok: true, pieceId: result.pieceId, piece: result.piece || null, alreadySent: !!result.alreadySent });
    } catch (err) {
      res.status(422).json({ error: 'production_handoff_failed', message: String(err.message || err).slice(0, 1000) });
    }
  });

  router.get('/:id/source', function (req, res) {
    if (!isId(req.params.id) || !fs.existsSync(sourcePath(req.params.id))) return res.status(404).end();
    const project = getProject(req.params.id);
    if (!project) return res.status(404).end();
    res.type(project.mimeType || 'video/mp4');
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
    delStmt.run(STORE_NAME, req.params.id);
    fs.rm(projectDir(req.params.id), { recursive: true, force: true }, function () {});
    res.json({ ok: true });
  });

  return { router: router, transcribeProject: transcribeProject, classifyProject: classifyProject, analyzeProjectRetakes: analyzeProjectRetakes, matchProjectPlanningPiece: matchProjectPlanningPiece, renderProject: renderProject };
}

module.exports = {
  setup,
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
  gapDecisions,
  retakeCandidates,
  normalizeRetakeDecisions,
  unresolvedRetakeCount
};
