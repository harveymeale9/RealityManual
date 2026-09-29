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
  if (lead > 0.45) cuts.push({ start: 0, end: Math.max(0, lead - 0.18), reason: 'leading_silence' });
  for (let i = 0; i < words.length - 1; i++) {
    const gapStart = words[i].end;
    const gapEnd = words[i + 1].start;
    const gap = gapEnd - gapStart;
    if (gap <= threshold) continue;
    const handle = retainedPause / 2;
    cuts.push({ start: gapStart + handle, end: gapEnd - handle, reason: 'long_pause' });
  }
  const tail = total - words[words.length - 1].end;
  if (tail > 0.55) cuts.push({
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
    return { start: clamp(cut.start, 0, total), end: clamp(cut.end, 0, total), reason: cut.reason || 'cut' };
  }).filter(function (cut) { return cut.end > cut.start; })
    .sort(function (a, b) { return a.start - b.start || a.end - b.end; });
  const merged = [];
  sorted.forEach(function (cut) {
    const previous = merged[merged.length - 1];
    if (!previous || cut.start > previous.end + 0.015) return merged.push(Object.assign({}, cut));
    previous.end = Math.max(previous.end, cut.end);
    if (previous.reason !== cut.reason) previous.reason = 'combined';
  });
  return merged;
}

function cutsForProject(project) {
  const auto = project.autoSilenceEnabled === false ? [] : calculateAutoCuts(project.words || [], project.duration);
  const manual = calculateManualCuts(project.words || [], project.removedWordIndices || [], project.duration);
  return mergeCuts(auto.concat(manual), project.duration);
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
  const fontSize = Math.max(30, Math.round(Math.min(width, height) * (isLongform ? 0.06 : 0.052)));
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
    if (!isLongform || !Array.isArray(group.words) || !group.words.length) {
      events.push('Dialogue: 0,' + assTime(group.start) + ',' + assTime(group.end) + ',Default,,0,0,0,,' + escapeAss(group.text));
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
    const result = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', filePath], 'video probe');
    const parsed = JSON.parse(result.stdout || '{}');
    const video = (parsed.streams || []).find(function (stream) { return stream.codec_type === 'video'; }) || {};
    return {
      duration: Number(parsed.format && parsed.format.duration) || 0,
      width: Number(video.width) || 0,
      height: Number(video.height) || 0,
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
        project.autoSilenceEnabled = true;
        project.transcriptionStatus = project.words.length ? 'ready' : 'error';
        project.transcriptionError = project.words.length ? '' : 'No timed speech was detected in this recording.';
        saveProject(project);
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
      fs.writeFileSync(assPath, buildAss(project, captionGroups(project, cuts)));
      const filters = [];
      segments.forEach(function (segment, index) {
        filters.push('[0:v]trim=start=' + segment.start.toFixed(3) + ':end=' + segment.end.toFixed(3) + ',setpts=PTS-STARTPTS[v' + index + ']');
        filters.push('[0:a]atrim=start=' + segment.start.toFixed(3) + ':end=' + segment.end.toFixed(3) + ',asetpts=PTS-STARTPTS[a' + index + ']');
      });
      const concatInputs = segments.map(function (_, index) { return '[v' + index + '][a' + index + ']'; }).join('');
      filters.push(concatInputs + 'concat=n=' + segments.length + ':v=1:a=1[joinedv][outa]');
      filters.push("[joinedv]subtitles='" + assPath.replace(/'/g, "'\\''") + "'[outv]");
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
    } catch (e) {}
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
        autoSilenceEnabled: true,
        transcriptionStatus: 'pending',
        transcriptionError: '',
        renderStatus: '',
        renderError: '',
        createdAt: now,
        updatedAt: now
      });
      res.status(202).json(project);
      setImmediate(function () { transcribeProject(id); });
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
    res.json(project);
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
    project.renderStatus = '';
    project.renderError = '';
    saveProject(project);
    project.cuts = cutsForProject(project);
    project.captionGroups = captionGroups(project, project.cuts);
    res.json(project);
  });

  router.post('/:id/transcribe', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    res.status(202).json({ ok: true, status: 'running' });
    transcribeProject(project.id);
  });

  router.post('/:id/render', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (project.transcriptionStatus !== 'ready') return res.status(409).json({ error: 'transcript_not_ready' });
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
    res.download(renderPath(req.params.id), path.parse(project.fileName || 'recording').name + '-edited.mp4');
  });

  router.delete('/:id', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    delStmt.run(STORE_NAME, req.params.id);
    fs.rm(projectDir(req.params.id), { recursive: true, force: true }, function () {});
    res.json({ ok: true });
  });

  return { router: router, transcribeProject: transcribeProject, renderProject: renderProject };
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
  buildAss
};
