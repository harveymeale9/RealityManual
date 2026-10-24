'use strict';

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { maskCaption } = require('../public/lib/captionMask');

const STORE_NAME = 'editorProjects';
// OBS long-form masters can exceed the original 4.5 GiB ceiling even when
// the Editor has ample workspace. This is only a sanity ceiling; the
// per-upload source+render reservation below remains the authoritative and
// substantially stricter admission check against current disk capacity.
// 16 MiB multipart parts keep even 128 GiB below R2's 10,000-part limit.
// Files above the old local ceiling are accepted only through R2-backed intake.
const MAX_UPLOAD_BYTES = 128 * 1024 * 1024 * 1024;
const MAX_LOCAL_UPLOAD_BYTES = 16 * 1024 * 1024 * 1024;
const CLOUD_UPLOAD_STORE = 'editorCloudUploads';
const CLOUD_INTAKE_STORE = 'editorCloudIntake';
// Raw OBS captures above this point are durable originals, not practical
// working files. Archive them to R2 and replace the local copy with a compact,
// high-quality editing master before any transcript, preview or render work.
const OVERSIZED_SOURCE_BYTES = 6 * 1024 * 1024 * 1024;
const EDITOR_UPLOAD_CHUNK_BYTES = 16 * 1024 * 1024;
const EDITOR_UPLOAD_SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const EDIT_RENDER_DEBOUNCE_MS = 2500;
const EDITOR_DISK_RESERVE_BYTES = 2 * 1024 * 1024 * 1024;
const PAGE_ZOOM_SECONDS = 3;
const HORIZONTAL_OPENING_ZOOM_SECONDS = 5;
const PAGE_CHANGE_CUT_SECONDS = 3;
const PAGE_CHANGE_FADE_SECONDS = 0.28;
const PROTECTED_ENDING_HANDLE_SECONDS = 0.08;
const PROTECTED_ENDING_MAX_HANDLE_SECONDS = 0.25;
const VIDEO_OUTRO_SECONDS = 2;
const HORIZONTAL_VISUAL_OUTRO_SECONDS = 1.7;
const HORIZONTAL_MUSIC_TAIL_SECONDS = 0.3;
// Give autoplay viewers a moment to register the book before the first word.
// Hold the first retained frame, not the camera-start footage removed by cuts.
const OPENING_PREROLL_SECONDS = 0.3;
// Footage is deliberately recorded wide enough to show a little table. The
// opening move settles toward the exact centre of the recorded frame and that
// composition remains the baseline for the rest of the shot. Initial portrait
// and horizontal openings use a gentler 112.5% target. Later vertical reveals
// also settle at 112.5%; horizontal reveal resets retain 125%. Substantial
// automatic long-pause cuts are treated as page changes and start the move again
// from the wide camera frame.
const OPENING_PUSH_IN_SCALE = 1.25;
const VERTICAL_OPENING_PUSH_IN_SCALE = 1.125;
const HORIZONTAL_OPENING_PUSH_IN_SCALE = 1.125;
const VERTICAL_REVEAL_PUSH_IN_SCALE = 1.125;
const EDITOR_RENDER_VERSION = 27;
const AUDIO_INTERLUDE_FADE_SECONDS = 0.3;
const AUTO_CUT_BOUNDARY_VERSION = 3;
const DEFAULT_RETAINED_PAUSE_SECONDS = 0.24;
const MIN_RETAINED_PAUSE_SECONDS = 0.08;
const LEADING_SPEECH_HANDLE_SECONDS = 0.08;
const TRANSCRIPT_CUT_HANDLE_SECONDS = 0.12;
const CUT_ISLAND_BRIDGE_SECONDS = 0.12;
const PAGE_CHANGE_SSIM_THRESHOLD = 0.5;
const BROWSER_PREVIEW_VERSION = 3;
const AUDIO_PREVIEW_MIX_VERSION = 3;
const AUDIO_PREVIEW_TTL_MS = 2 * 60 * 60 * 1000;

function encoderConcurrencyForCpuCount(cpuCount, configuredLimit) {
  const available = Math.max(1, Math.floor(Number(cpuCount) || 1));
  const configured = Math.floor(Number(configuredLimit) || 0);
  // One encode at a time is intentional. Giving the active encode every CPU
  // finishes the first usable preview sooner and avoids two long recordings
  // making the whole two-core ops host unresponsive. Larger hosts can opt in
  // to more workers explicitly, but never beyond the CPUs actually visible.
  return Math.min(available, Math.max(1, configured > 0 ? configured : 1));
}

const AVAILABLE_CPU_COUNT = typeof os.availableParallelism === 'function'
  ? os.availableParallelism()
  : (os.cpus() || []).length;
const EDITOR_ENCODE_CONCURRENCY = encoderConcurrencyForCpuCount(AVAILABLE_CPU_COUNT, process.env.EDITOR_ENCODE_CONCURRENCY);
const EDITOR_FFMPEG_THREADS = Math.max(1, Math.floor(Math.max(1, AVAILABLE_CPU_COUNT) / EDITOR_ENCODE_CONCURRENCY));

function renderShapeForProject(project, layout, master) {
  if (!master) return layout === 'vertical'
    ? { width: 404, height: 720 }
    : { width: 720, height: 404 };
  const sourceWidth = Math.max(2, Number(project && (project.originalWidth || project.width)) || 1920);
  const sourceHeight = Math.max(2, Number(project && (project.originalHeight || project.height)) || 1080);
  const cropWidth = layout === 'vertical'
    ? Math.min(sourceWidth, sourceHeight * 9 / 16)
    : Math.min(sourceWidth, sourceHeight * 16 / 9);
  const cropHeight = layout === 'vertical'
    ? Math.min(sourceHeight, sourceWidth * 16 / 9)
    : Math.min(sourceHeight, sourceWidth * 9 / 16);
  const scale = Math.min(1, 3840 / Math.max(cropWidth, cropHeight));
  return {
    width: Math.max(2, Math.floor((cropWidth * scale) / 2) * 2),
    height: Math.max(2, Math.floor((cropHeight * scale) / 2) * 2)
  };
}

function renderOutroTiming(layout, includeMusicTail, requestedFadeSeconds) {
  const defaultFadeSeconds = layout === 'horizontal' ? HORIZONTAL_VISUAL_OUTRO_SECONDS : VIDEO_OUTRO_SECONDS;
  const fadeSeconds = Number.isFinite(Number(requestedFadeSeconds)) && Number(requestedFadeSeconds) > 0
    ? clamp(Number(requestedFadeSeconds), 0.3, 4) : defaultFadeSeconds;
  if (layout !== 'horizontal') {
    return { visualFadeSeconds: fadeSeconds, totalSeconds: fadeSeconds, musicTailSeconds: 0 };
  }
  const musicTailSeconds = includeMusicTail ? HORIZONTAL_MUSIC_TAIL_SECONDS : 0;
  return {
    visualFadeSeconds: fadeSeconds,
    totalSeconds: fadeSeconds + musicTailSeconds,
    musicTailSeconds: musicTailSeconds
  };
}

function requiredEditorCapacity(fileBytes, fileAlreadyStored) {
  const bytes = Math.max(0, Number(fileBytes) || 0);
  // Admission needs room for the incoming camera master plus one worst-case
  // full-size Editor render. Multer/chunk completion renames the received file
  // into place rather than copying it, the two scrub proxies are deliberately
  // low-resolution, and Production is created later from the normally much
  // smaller verified render. Charging six raw-camera copies here blocked valid
  // long recordings even when the real Editor workspace fit comfortably.
  // Once the upload is already stored, current free space already reflects the
  // source allocation, so only the render allowance remains to be reserved.
  return EDITOR_DISK_RESERVE_BYTES + bytes * (fileAlreadyStored ? 1 : 2);
}

function outstandingEditorCapacity(projects) {
  return (Array.isArray(projects) ? projects : []).reduce(function (total, project) {
    if (!project || project.productionPieceId) return total;
    const bytes = Math.max(0, Number(project.sizeBytes) || 0);
    const readyRenderBytes = project.renderStatus === 'ready'
      ? Math.max(0, Number(project.renderSizeBytes) || 0)
      : 0;
    // The source is already reflected in filesystem free space. Before a
    // render exists, the only full-size file still owed by Editor is that
    // render itself. Scrub previews are low-resolution and fit inside the
    // global operating reserve; Production copies are admitted later when the
    // user actually approves the edit. Counting all of those hypothetical
    // future files as raw-camera-sized made one long recording permanently
    // block every later laptop upload even though the next recording fit.
    if (project.renderStatus !== 'ready') return total + bytes;
    // Once the real render exists, use its measured size for the Production
    // handoff and mixed-final allowance rather than the raw camera size.
    return total + (readyRenderBytes || bytes) * 2;
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

function createPriorityTaskQueue(limit) {
  const urgent = [];
  const normal = [];
  const activeKeys = new Set();
  let running = 0;
  limit = Math.max(1, Math.floor(Number(limit) || 1));
  function nextAvailable(queue) {
    const index = queue.findIndex(function (entry) { return !entry.key || !activeKeys.has(entry.key); });
    return index < 0 ? null : queue.splice(index, 1)[0];
  }
  function pump() {
    while (running < limit) {
      const entry = nextAvailable(urgent) || nextAvailable(normal);
      if (!entry) return;
      running++;
      if (entry.key) activeKeys.add(entry.key);
      Promise.resolve().then(entry.task).then(entry.resolve, entry.reject).finally(function () {
        if (entry.key) activeKeys.delete(entry.key);
        running--;
        pump();
      });
    }
  }
  return {
    enqueue: function (task, priority, key) {
      return new Promise(function (resolve, reject) {
        (priority === 'urgent' ? urgent : normal).push({ task: task, resolve: resolve, reject: reject, key: key || '' });
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

function parseIntegratedLoudness(stderr) {
  const matches = String(stderr || '').match(/\{\s*"input_i"[\s\S]*?\}/g);
  if (!matches || !matches.length) throw new Error('FFmpeg returned no integrated loudness measurement.');
  const value = Number(JSON.parse(matches[matches.length - 1]).input_i);
  if (!Number.isFinite(value) || value <= -70) throw new Error('The audio was too quiet to measure safely.');
  return Math.round(value * 100) / 100;
}

async function measureIntegratedLoudness(filePath, label) {
  const result = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', filePath, '-vn', '-af',
    'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], label || 'audio loudness measurement');
  return parseIntegratedLoudness(result.stderr);
}

function insertedClipGainDb(referenceLufs, clipLufs) {
  const reference = Number(referenceLufs);
  const measured = Number(clipLufs);
  if (!Number.isFinite(reference) || !Number.isFinite(measured)) throw new Error('Inserted-clip loudness could not be matched.');
  return Math.round(Math.max(-30, Math.min(30, reference - measured)) * 100) / 100;
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
  const url = '(https?:\\/\\/(?:www\\.)?(?:youtube\\.com|youtu\\.be)\\/[^\\s,]+)';
  const time = '(\\d+(?::\\d+){1,2}(?:\\.\\d+)?)';
  const patterns = [
    new RegExp('INSERT\\s+CLIP\\s*:\\s*' + url + '\\s+' + time + '\\s*-\\s*' + time + '(?:\\s*,?\\s*[“"]([^”"\\n]+)[”"])?', 'gi'),
    new RegExp('INSERT\\s+CLIP\\s*:\\s*' + time + '\\s*-\\s*' + time + '\\s*-\\s*' + url + '(?:\\s*,?\\s*[“"]([^”"\\n]+)[”"])?', 'gi')
  ];
  const directives = [];
  patterns.forEach(function (pattern, patternIndex) {
    let match;
    while ((match = pattern.exec(text))) {
      const sourceUrl = (patternIndex === 0 ? match[1] : match[3]).replace(/[.)\]]+$/, '');
      const start = clipTimestampSeconds(patternIndex === 0 ? match[2] : match[1]);
      const end = clipTimestampSeconds(patternIndex === 0 ? match[3] : match[2]);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 60) continue;
      directives.push({
        id: crypto.createHash('sha256').update([sourceUrl, start, end, match.index].join('|')).digest('hex').slice(0, 16),
        sourceUrl: sourceUrl, sourceStart: start, sourceEnd: end, duration: end - start,
        quote: String(match[4] || '').trim(), position: match.index
      });
    }
  });
  return directives.sort(function (a, b) { return a.position - b.position; }).map(function (item) { delete item.position; return item; });
}

function approximateWords(text, duration) {
  const tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
  const step = Math.max(0.08, Math.max(0, Number(duration) || 0) / Math.max(1, tokens.length));
  return tokens.map(function (token, index) {
    return { index: index, text: token, start: index * step, end: Math.min(Number(duration) || step, (index + 1) * step) };
  });
}

function audioInterludeVideoFilter(duration) {
  const fade = Math.min(AUDIO_INTERLUDE_FADE_SECONDS, Math.max(0.04, duration / 3));
  return '[1:v]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text=' +
    "'♪':fontcolor=0x4dffbb:fontsize=100:x=(w-text_w)/2:y=h/2-115" +
    ",drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='AUDIO PLAYING':fontcolor=0xc7e7d6:fontsize=24:x=(w-text_w)/2:y=h/2+30" +
    ',fade=t=in:st=0:d=' + fade.toFixed(3) + ':color=black' +
    ',fade=t=out:st=' + Math.max(0, duration - fade).toFixed(3) + ':d=' + fade.toFixed(3) + ':color=black' +
    ',fps=30000/1001,format=yuv420p[v]';
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
    return entry.isFile() && (/^editor-upload-/.test(entry.name) || /^editor-cloud-[A-Za-z0-9_-]+$/.test(entry.name) || /^editor-.+\.mp3$/.test(entry.name));
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

function retainedPauseForThreshold(thresholdSeconds) {
  const threshold = Number(thresholdSeconds) || 1;
  return threshold < 0.85 ? 0.10 : threshold < 1.3 ? DEFAULT_RETAINED_PAUSE_SECONDS : 0.32;
}

function effectiveRetainedPauseSeconds(project) {
  return Number(project && project.autoCutBoundaryVersion) === AUTO_CUT_BOUNDARY_VERSION
    ? Number(project.retainedPauseSeconds) || retainedPauseForThreshold(project.silenceThresholdSeconds)
    : retainedPauseForThreshold(project && project.silenceThresholdSeconds);
}

// Natural mode keeps 240ms between phrases. The 120ms handle on each spoken
// edge protects consonants without restoring the conspicuous 190ms dead beat
// that preceded the tighter cutting pass.
function calculateAutoCuts(words, duration, options) {
  options = options || {};
  const threshold = clamp(options.thresholdSeconds === undefined ? 1.0 : options.thresholdSeconds, 0.65, 5);
  const retainedPause = clamp(options.retainedPauseSeconds === undefined ? DEFAULT_RETAINED_PAUSE_SECONDS : options.retainedPauseSeconds, MIN_RETAINED_PAUSE_SECONDS, threshold - 0.05);
  const cuts = [];
  if (!words.length || !Number.isFinite(Number(duration)) || Number(duration) <= 0) return cuts;
  const total = Number(duration);
  const lead = words[0].start;
  // The recording should begin essentially when Harvey begins speaking. Keep
  // only a tiny consonant-safety handle; the previous 180ms allowance made a
  // visible setup beat survive before the first line on some long-form takes.
  // Even a short camera-start movement should not become the first frame.
  // Only skip a lead cut when it would be shorter than one perceptible edit.
  if (lead > LEADING_SPEECH_HANDLE_SECONDS + 0.08) cuts.push({ id: 'lead', start: 0, end: Number(Math.max(0, lead - LEADING_SPEECH_HANDLE_SECONDS).toFixed(3)), reason: 'leading_silence' });
  for (let i = 0; i < words.length - 1; i++) {
    const gapStart = words[i].end;
    const gapEnd = words[i + 1].start;
    const gap = gapEnd - gapStart;
    if (gap <= threshold) continue;
    const handle = retainedPause / 2;
    cuts.push({ id: 'gap-' + i, gapIndex: i, start: gapStart + handle, end: gapEnd - handle, reason: 'long_pause' });
  }
  const tail = total - words[words.length - 1].end;
  const protectedEnding = options.protectEnding === true;
  const endingHandle = protectedEnding ? PROTECTED_ENDING_HANDLE_SECONDS : 0.25;
  if (tail > (protectedEnding ? endingHandle + 0.08 : 0.55)) cuts.push({
    id: 'tail',
    start: Math.min(total, words[words.length - 1].end + endingHandle),
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
    // A transcript deletion removes the selected speech and the surrounding
    // dead space, while retaining exactly 120ms against each neighbouring word.
    // This now matches the Natural automatic-silence handle.
    const start = first > 0
      ? Math.min(words[first].start, previousEnd + TRANSCRIPT_CUT_HANDLE_SECONDS)
      : 0;
    const end = last + 1 < words.length
      ? Math.max(words[last].end, nextStart - TRANSCRIPT_CUT_HANDLE_SECONDS)
      : Number(duration);
    if (end > start) cuts.push({ start: start, end: end, reason: 'transcript_cut' });
    index++;
  }
  return cuts;
}

function normalizeManualTrimCuts(cuts, duration) {
  const total = Math.max(0, Number(duration) || 0);
  return (Array.isArray(cuts) ? cuts : []).slice(0, 50).map(function (cut, index) {
    const start = clamp(Number(cut && cut.start), 0, total);
    const end = clamp(Number(cut && cut.end), 0, total);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.02) return null;
    const suppliedId = String(cut && cut.id || '');
    return {
      id: /^[A-Za-z0-9_-]{1,100}$/.test(suppliedId) ? suppliedId : 'manual-trim-' + index,
      start: start,
      end: end,
      note: String(cut && cut.note || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300),
      reason: 'manual_trim'
    };
  }).filter(Boolean).sort(function (a, b) { return a.start - b.start || a.end - b.end; });
}

function protectedManualTrimCuts(project, cuts) {
  const normalized = normalizeManualTrimCuts(cuts, project && project.duration);
  if (!project || project.endingProtectionEnabled !== true || !(project.words || []).length) return normalized;
  const lastWordEnd = Number(project.words[project.words.length - 1].end);
  const duration = Number(project.duration) || 0;
  const latestSafeStart = Math.min(lastWordEnd + PROTECTED_ENDING_MAX_HANDLE_SECONDS, duration - 0.08);
  return normalized.map(function (cut) {
    if (!/^adjusted-tail-/.test(cut.id)) return cut;
    return Object.assign({}, cut, {
      start: Number(clamp(cut.start, Math.min(lastWordEnd + PROTECTED_ENDING_HANDLE_SECONDS, latestSafeStart),
        latestSafeStart).toFixed(3)),
      end: duration
    });
  });
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
    // A sliver between two removals cannot carry intelligible speech and plays
    // as a visual/audio glitch. Bridge those islands into one continuous cut.
    if (!previous || cut.start > previous.end + CUT_ISLAND_BRIDGE_SECONDS) return merged.push(Object.assign({}, cut));
    previous.end = Math.max(previous.end, cut.end);
    if (previous.reason !== cut.reason) previous.reason = 'combined';
    if (previous.id !== cut.id) previous.id = '';
  });
  return merged;
}

// Merged transcript/automatic cuts lose their original ID. A blank ID used
// to make one detected page turn apply to every merged cut in the recording.
function pageChangeCutKey(cut) {
  return String(cut && cut.id || '') || 'merged-' + Number(cut.start).toFixed(3) + '-' + Number(cut.end).toFixed(3);
}

function pageChangeSuppressionMatches(savedKey, currentKey) {
  if (savedKey === currentKey) return true;
  // A merged cut has no stable source ID. Small manual edge adjustments must
  // not resurrect a page-turn effect the editor already dismissed.
  const saved = /^merged-(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(String(savedKey));
  const current = /^merged-(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(String(currentKey));
  return !!(saved && current && Math.abs(Number(saved[1]) - Number(current[1])) <= 0.5 &&
    Math.abs(Number(saved[2]) - Number(current[2])) <= 0.5);
}

function confirmedPageChangeCutKeys(project, cuts) {
  const stored = new Set((project.pageChangeCutIds || []).map(String));
  const suppressed = (project.suppressedPageChangeCutKeys || []).map(String);
  return (cuts || []).filter(function (cut) {
    const key = pageChangeCutKey(cut);
    return (stored.has(key) || (!cut.id && stored.has(''))) &&
      !suppressed.some(function (saved) { return pageChangeSuppressionMatches(saved, key); });
  }).map(pageChangeCutKey);
}

function cutsForProject(project) {
  const restored = new Set(Array.isArray(project.restoredAutoCutIds) ? project.restoredAutoCutIds : []);
  const precise = protectedManualTrimCuts(project, project.manualTrimCuts);
  const hasAdjustedEnding = project.endingProtectionEnabled === true && precise.some(function (cut) { return /^adjusted-tail-/.test(cut.id); });
  const auto = calculateAutoCuts(project.words || [], project.duration, {
    thresholdSeconds: project.silenceThresholdSeconds,
    retainedPauseSeconds: effectiveRetainedPauseSeconds(project),
    protectEnding: project.endingProtectionEnabled === true
  }).filter(function (cut) {
    if (cut.id === 'tail' && project.endingProtectionEnabled === true) return !hasAdjustedEnding;
    return project.autoSilenceEnabled !== false && !restored.has(cut.id);
  });
  const manual = calculateManualCuts(project.words || [], project.removedWordIndices || [], project.duration);
  return mergeCuts(auto.concat(manual, precise), project.duration);
}

function editableTimelineCuts(project) {
  const restored = new Set(Array.isArray(project && project.restoredAutoCutIds) ? project.restoredAutoCutIds : []);
  const precise = protectedManualTrimCuts(project, project && project.manualTrimCuts).map(function (cut) {
    return Object.assign({}, cut, { editableOrigin: 'manual' });
  });
  const hasAdjustedEnding = project && project.endingProtectionEnabled === true && precise.some(function (cut) { return /^adjusted-tail-/.test(cut.id); });
  const automatic = calculateAutoCuts(project && project.words || [], project && project.duration, {
    thresholdSeconds: project && project.silenceThresholdSeconds,
    retainedPauseSeconds: effectiveRetainedPauseSeconds(project),
    protectEnding: project && project.endingProtectionEnabled === true
  }).filter(function (cut) {
    if (cut.id === 'tail' && project && project.endingProtectionEnabled === true) return !hasAdjustedEnding;
    return project && project.autoSilenceEnabled !== false && !restored.has(cut.id);
  }).map(function (cut) {
    return Object.assign({}, cut, { editableOrigin: 'automatic' });
  });
  return automatic.concat(precise).sort(function (a, b) { return a.start - b.start || a.end - b.end; });
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
  return '';
}

function automaticReviewReady(project) {
  if (!project || project.transcriptionStatus !== 'ready') return false;
  if (['queued', 'preparing'].includes(project.clipInsertStatus)) return false;
  if (!['ready', 'unavailable', 'error'].includes(project.retakeAnalysisStatus)) return false;
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
  project.pageChangeCutIds = [];
  return project;
}

function advanceEditRevision(project) {
  project.editRevision = Math.max(0, Number(project.editRevision) || 0) + 1;
  return project.editRevision;
}

function patchAffectsRender(body) {
  body = body && typeof body === 'object' ? body : {};
  return ['removedWordIndices', 'manualTrimCuts', 'wordCorrection', 'autoSilenceEnabled', 'restoredAutoCutIds', 'captionsEnabled',
    'layoutOverride', 'openingPushInEnabled', 'silenceThresholdSeconds', 'retainedPauseSeconds', 'voiceGainAdjustments',
    'suppressedPageChangeCutKeys', 'outroFadeSeconds'].some(function (key) {
    return Object.prototype.hasOwnProperty.call(body, key);
  });
}

function normalizeVoiceGainAdjustments(adjustments, duration) {
  const limit = Math.max(0, Number(duration) || 0);
  if (!Array.isArray(adjustments)) return [];
  return adjustments.slice(0, 20).map(function (adjustment) {
    if (!adjustment || !Number.isFinite(Number(adjustment.start)) || !Number.isFinite(Number(adjustment.gainDb))) return null;
    return {
      start: Number(clamp(Number(adjustment.start), 0, limit).toFixed(3)),
      gainDb: Number(clamp(Number(adjustment.gainDb), -24, 24).toFixed(2))
    };
  }).filter(Boolean).sort(function (a, b) { return a.start - b.start; });
}

function voiceGainFilter(adjustments, duration) {
  return normalizeVoiceGainAdjustments(adjustments, duration).map(function (adjustment) {
    return "volume=" + adjustment.gainDb.toFixed(2) + "dB:enable='gte(t\\," + adjustment.start.toFixed(3) + ")'";
  }).join(',');
}

function openingPushInScale(editedSeconds, durationSeconds, targetScale) {
  const duration = Math.max(0.001, Number(durationSeconds) || PAGE_ZOOM_SECONDS);
  const progress = clamp((Number(editedSeconds) || 0) / duration, 0, 1);
  const eased = progress * progress * (3 - 2 * progress);
  const restingScale = Math.max(1, Number(targetScale) || OPENING_PUSH_IN_SCALE);
  return 1 + (restingScale - 1) * eased;
}

function openingZoomExpression(elapsedStart, framesPerSecond, durationSeconds, targetScale) {
  const frameOffset = (Math.max(0, Number(elapsedStart) || 0) * framesPerSecond).toFixed(6);
  const duration = Math.max(0.001, Number(durationSeconds) || PAGE_ZOOM_SECONDS);
  const progress = 'min(max((on+' + frameOffset + ')/(' + framesPerSecond.toFixed(8) + '*' + duration.toFixed(6) + '),0),1)';
  const eased = '(' + progress + '*' + progress + '*(3-2*' + progress + '))';
  const restingScale = Math.max(1, Number(targetScale) || OPENING_PUSH_IN_SCALE);
  return '(1+' + (restingScale - 1).toFixed(3) + '*' + eased + ')';
}

function cameraResetStarts(cuts, confirmedCutIds) {
  const resetStarts = [0];
  const confirmed = Array.isArray(confirmedCutIds) ? new Set(confirmedCutIds.map(String)) : null;
  (cuts || []).forEach(function (cut) {
    if (cut.reason !== 'long_pause' && cut.reason !== 'combined') return;
    // Sentence pauses are also tightened automatically. Only a substantial
    // removed silence is a reliable voice-only signal that Harvey turned the
    // page; otherwise the camera would restart throughout ordinary speech.
    if (Number(cut.end) - Number(cut.start) < PAGE_CHANGE_CUT_SECONDS) return;
    if (confirmed && !confirmed.has(pageChangeCutKey(cut))) return;
    const boundary = mapSourceTimeToEdited(cut.end, cuts);
    if (boundary > resetStarts[resetStarts.length - 1] + 0.001) resetStarts.push(boundary);
  });
  return resetStarts;
}

function cameraMotionState(sourceSeconds, cuts, layout, confirmedCutIds) {
  const editedTime = mapSourceTimeToEdited(sourceSeconds, cuts || []);
  const resetStarts = cameraResetStarts(cuts || [], confirmedCutIds);
  let resetAt = 0;
  resetStarts.forEach(function (candidate) { if (candidate <= editedTime + 0.001) resetAt = candidate; });
  return {
    editedTime: editedTime,
    resetAt: resetAt,
    elapsed: Math.max(0, editedTime - resetAt),
    duration: layout === 'horizontal' && resetAt === 0 ? HORIZONTAL_OPENING_ZOOM_SECONDS : PAGE_ZOOM_SECONDS
  };
}

function cameraMotionForSegment(segment, cuts, layout, confirmedCutIds) {
  // Returning from an external full-screen excerpt is a new camera reveal,
  // just like returning after a page turn: begin on the completely wide book
  // frame, ease to the layout's reveal scale over three seconds, then hold.
  // Portrait footage uses the gentler 112.5% target; landscape retains 125%.
  // This must be
  // attached to the edit-decision segment rather than inferred from source
  // time, because the inserted clip advances the final timeline without
  // changing the camera recording's own timestamps.
  if (segment && segment.cameraResetAfterInsert) {
    const editedTime = mapSourceTimeToEdited(segment.start, cuts || []);
    return { editedTime: editedTime, resetAt: editedTime, elapsed: 0, duration: PAGE_ZOOM_SECONDS };
  }
  return cameraMotionState(segment && segment.start, cuts, layout, confirmedCutIds);
}

function cameraMotionTargetScale(layout, motion, revealReset) {
  const initialOpening = !revealReset && motion && Math.abs(Number(motion.resetAt) || 0) <= 0.001;
  if (!initialOpening) return layout === 'vertical' ? VERTICAL_REVEAL_PUSH_IN_SCALE : OPENING_PUSH_IN_SCALE;
  return layout === 'horizontal' ? HORIZONTAL_OPENING_PUSH_IN_SCALE : VERTICAL_OPENING_PUSH_IN_SCALE;
}

function visualPageChangeFromSsim(score) {
  return Number.isFinite(Number(score)) && Number(score) < PAGE_CHANGE_SSIM_THRESHOLD;
}

async function detectVisualPageChangeCutIds(filePath, cuts) {
  const confirmed = [];
  const candidates = (cuts || []).filter(function (cut) {
    return (cut.reason === 'long_pause' || cut.reason === 'combined') &&
      Number(cut.end) - Number(cut.start) >= PAGE_CHANGE_CUT_SECONDS;
  });
  for (const cut of candidates) {
    const before = Math.max(0, Number(cut.start) - 0.1).toFixed(3);
    const after = Math.max(0, Number(cut.end) + 0.1).toFixed(3);
    try {
      const result = await run('ffmpeg', ['-hide_banner', '-loglevel', 'info',
        '-ss', before, '-i', filePath, '-ss', after, '-i', filePath,
        '-filter_complex', '[0:v]scale=320:180,format=gray[a];[1:v]scale=320:180,format=gray[b];[a][b]ssim',
        '-frames:v', '1', '-an', '-f', 'null', '-'], 'Page-change frame comparison');
      const match = String(result.stderr || '').match(/All:([0-9.]+)/);
      if (match && visualPageChangeFromSsim(Number(match[1]))) confirmed.push(pageChangeCutKey(cut));
    } catch (error) {
      // A failed visual check must not invent camera movement. The silence cut
      // remains valid; only its optional page-reveal motion is omitted.
    }
  }
  return confirmed;
}

// One high-quality fractional resampling stage handles the centred camera
// settle for each retained shot.
function cameraMotionFilter(options) {
  options = options || {};
  const openingEnabled = options.openingEnabled === true;
  if (!openingEnabled) return '';
  const renderShape = options.renderShape;
  const framesPerSecond = 30000 / 1001;
  const zoom = openingZoomExpression(options.elapsedStart, framesPerSecond, options.durationSeconds, options.targetScale);
  // Camera placement is authoritative: every move zooms toward the exact frame
  // centre, without trying to infer the book position from the layout.
  const x = '(iw-iw/' + zoom + ')*0.5';
  const y = '(ih-ih/' + zoom + ')*0.5';
  return ",zoompan=z='" + zoom + "':x='" + x + "':y='" + y + "':d=1:s=" +
    renderShape.width + 'x' + renderShape.height + ':fps=30000/1001,setsar=1';
}

function cameraMotionPreparationFilter(renderShape, motionEnabled) {
  // Keep the cropped camera frame at native resolution until zoompan samples
  // it. Pre-scaling a 4K source to the 720px decision-preview size first made
  // zoompan's integer crop coordinates alternate by whole output pixels,
  // producing a real wobble in the encoded review file. Direct native-to-
  // output sampling keeps that quantisation below one displayed pixel.
  if (motionEnabled) return ',setsar=1';
  return ',scale=' + renderShape.width + ':' + renderShape.height + ',setsar=1';
}

function openingPushInFilter(renderShape, elapsedStart, durationSeconds) {
  return cameraMotionFilter({ renderShape: renderShape, elapsedStart: elapsedStart, durationSeconds: durationSeconds, openingEnabled: true });
}

function patchNeedsAutoRender(project, renderWillChange) {
  return false;
}

function gapDecisions(project) {
  const words = project.words || [];
  const restored = new Set(Array.isArray(project.restoredAutoCutIds) ? project.restoredAutoCutIds : []);
  return calculateAutoCuts(words, project.duration, {
    thresholdSeconds: project.silenceThresholdSeconds,
    retainedPauseSeconds: effectiveRetainedPauseSeconds(project)
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
    const likelyRestart = prefix >= Math.min(3, a.length) && b.length > a.length;
    const closeRepeat = repeatedLineEvidence(a.join(' '), b.join(' '));
    if (!likelyRestart && !closeRepeat) continue;
    output.push({
      id: 'retake-' + index,
      removeWordIndices: first.map(function (word) { return word.index; }),
      firstText: first.map(function (word) { return word.text; }).join(' '),
      replacementText: second.map(function (word) { return word.text; }).join(' '),
      confidence: likelyRestart && closeRepeat ? 'high' : 'review',
      reason: likelyRestart ? 'The next take begins the same way and continues further.' : 'These adjacent lines substantially repeat one another.'
    });
  }
  return output;
}

function transcriptToken(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9']/g, '');
}

function planningParagraphs(notesHtml) {
  return String(notesHtml || '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|li|h[1-6]|blockquote|div)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .split(/\n+/)
    .map(function (value) { return value.replace(/\s+/g, ' ').trim(); })
    .filter(function (value) { return value.split(/\s+/).length >= 4; });
}

// The transcript remains word-addressable for frame-accurate cuts, but its
// visual paragraphs should follow the way Harvey actually spoke. Long pauses
// are the strongest signal; sentence endings and bounded paragraph lengths
// keep a long uninterrupted take readable. When a planning card is linked,
// recognisable paragraph openings from that outline reinforce those breaks.
function transcriptParagraphStartIndices(words, notesHtml) {
  const timedWords = Array.isArray(words) ? words : [];
  if (!timedWords.length) return [];
  const starts = new Set([Number(timedWords[0].index)]);
  let paragraphStartPosition = 0;
  for (let position = 1; position < timedWords.length; position++) {
    const previous = timedWords[position - 1] || {};
    const current = timedWords[position] || {};
    const gap = Number(current.start) - Number(previous.end);
    const length = position - paragraphStartPosition;
    const sentenceEnded = /[.!?]["'’”)]*$/.test(String(previous.text || ''));
    const naturalBreak = length >= 8 && Number.isFinite(gap) && gap >= 1.35;
    const sentenceBreak = length >= 12 && sentenceEnded && Number.isFinite(gap) && gap >= 0.65;
    const boundedBreak = length >= 90 || (length >= 60 && sentenceEnded);
    if (naturalBreak || sentenceBreak || boundedBreak) {
      starts.add(Number(current.index));
      paragraphStartPosition = position;
    }
  }

  const transcriptTokens = timedWords.map(function (word) { return transcriptToken(word.text); });
  let searchFrom = 0;
  planningParagraphs(notesHtml).forEach(function (paragraph) {
    const anchor = paragraph.split(/\s+/).map(transcriptToken).filter(Boolean).slice(0, 5);
    if (anchor.length < 4) return;
    for (let position = searchFrom; position < transcriptTokens.length; position++) {
      let cursor = position;
      let matched = 0;
      let firstMatchPosition = -1;
      while (cursor < transcriptTokens.length && cursor < position + 14 && matched < anchor.length) {
        if (transcriptTokens[cursor] === anchor[matched]) {
          if (firstMatchPosition < 0) firstMatchPosition = cursor;
          matched++;
        }
        cursor++;
      }
      if (matched < 4) continue;
      if (firstMatchPosition >= 4) starts.add(Number(timedWords[firstMatchPosition].index));
      searchFrom = cursor;
      break;
    }
  });
  return Array.from(starts).filter(Number.isInteger).sort(function (a, b) { return a - b; });
}

// Harvey says this deliberately unusual two-word phrase whenever the words
// immediately before it were a false start. Keep the matcher tolerant of the
// small spelling variations speech-to-text commonly produces, but require
// both adjacent words so ordinary speech can never trip it accidentally.
const RETAKE_MARKER_FIRST_WORDS = new Set(['antoine', 'antoin', 'antwan', 'antwon', 'antwine']);
const RETAKE_MARKER_SECOND_WORDS = new Set(['matthias', 'mathias', 'matias', 'mattias', 'matthies', 'matthews']);
const RETAKE_MARKER_ATTEMPT_GAP_SECONDS = 0.85;

function retakeMarkerToken(value) {
  return String(value || '').toLowerCase().replace(/[^a-z]/g, '');
}

function retakeMarkerDecisions(words) {
  const timedWords = Array.isArray(words) ? words : [];
  const decisions = [];
  let previousMarkerEnd = -1;
  for (let markerStart = 0; markerStart < timedWords.length - 1; markerStart++) {
    if (!RETAKE_MARKER_FIRST_WORDS.has(retakeMarkerToken(timedWords[markerStart] && timedWords[markerStart].text)) ||
        !RETAKE_MARKER_SECOND_WORDS.has(retakeMarkerToken(timedWords[markerStart + 1] && timedWords[markerStart + 1].text))) continue;
    const markerEnd = markerStart + 1;
    // Always include the immediately preceding spoken attempt, even if Harvey
    // paused while deciding to call the retake. Pauses *within* that preceding
    // speech still delimit it from the earlier, valid material.
    let attemptStart = markerStart > previousMarkerEnd + 1 ? markerStart - 1 : markerStart;
    // The marked mistake is the current spoken attempt: walk back to the
    // latest natural pause, without ever crossing an earlier marker.
    while (attemptStart > previousMarkerEnd + 1) {
      const previous = timedWords[attemptStart - 1];
      const current = timedWords[attemptStart];
      if (Number(current && current.start) - Number(previous && previous.end) > RETAKE_MARKER_ATTEMPT_GAP_SECONDS) break;
      attemptStart--;
    }
    const removeWordIndices = [];
    for (let index = attemptStart; index <= markerEnd; index++) removeWordIndices.push(index);
    const replacementWords = [];
    for (let index = markerEnd + 1; index < timedWords.length && replacementWords.length < 24; index++) {
      if (index > markerEnd + 1 && Number(timedWords[index].start) - Number(timedWords[index - 1].end) > RETAKE_MARKER_ATTEMPT_GAP_SECONDS) break;
      replacementWords.push(timedWords[index]);
      if (/[.!?]["'’”)]*$/.test(String(timedWords[index].text || ''))) break;
    }
    decisions.push({
      id: 'marker-retake-' + decisions.length + '-' + attemptStart + '-' + markerEnd,
      removeWordIndices: removeWordIndices,
      firstText: timedWords.slice(attemptStart, markerEnd + 1).map(function (word) { return word.text; }).join(' '),
      replacementText: replacementWords.map(function (word) { return word.text; }).join(' '),
      confidence: 'high',
      reason: '“Antoine Matthias” marked the preceding words as a false start.',
      source: 'marker'
    });
    previousMarkerEnd = markerEnd;
    markerStart = markerEnd;
  }
  return decisions;
}

const RETAKE_WEAK_TOKENS = new Set(['a', 'an', 'and', 'or', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'but']);

function retakeSignalTokens(value) {
  return String(value || '').toLowerCase().split(/\s+/).map(function (token) {
    return token.replace(/[^a-z0-9']/g, '');
  }).filter(function (token) { return token && !RETAKE_WEAK_TOKENS.has(token); });
}

function retakeTokenMatches(left, right) {
  if (left === right) return true;
  // Whisper commonly transcribes an abandoned word as a truncated version of
  // the clean take (for example "manifesta-" then "manifestation").
  return Math.min(left.length, right.length) >= 5 && (left.startsWith(right) || right.startsWith(left));
}

function repeatedLineEvidence(firstText, replacementText) {
  const first = retakeSignalTokens(firstText);
  const replacement = retakeSignalTokens(replacementText);
  if (!first.length || !replacement.length) return false;
  let replacementCursor = 0;
  let matches = 0;
  first.forEach(function (token) {
    for (let index = replacementCursor; index < replacement.length; index++) {
      if (!retakeTokenMatches(token, replacement[index])) continue;
      matches++;
      replacementCursor = index + 1;
      break;
    }
  });
  const firstCoverage = matches / first.length;
  // A one-word card is useful only for an unmistakable truncated/repeated
  // word. Longer attempts must repeat at least two meaningful words and most
  // of the abandoned wording, in order, in the later take.
  if (first.length === 1) return matches === 1 && retakeTokenMatches(first[0], replacement[0]);
  return matches >= 2 && firstCoverage >= 0.6;
}

function isRepeatedLineRetakeCandidate(candidate) {
  return !!candidate && repeatedLineEvidence(candidate.firstText, candidate.replacementText);
}

function normalizeRetakeDecisions(raw, words, options) {
  options = options || {};
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
    // Articles and connective/comparative scaffolding are too weak to prove
    // that one phrase replaces another. In particular, deliberate parallel
    // constructions such as "the greater X, the greater Y" used to produce
    // review cards for a lone "the" or "greater the", which then blocked the
    // final render even though the sentence was fluent. Keep meaningful
    // wording as the evidence and discard tiny scaffold-only guesses.
    const comparativeScaffoldTokens = new Set(['a', 'an', 'and', 'or', 'the', 'greater', 'more', 'less', 'fewer']);
    const removedSignalTokens = removedTokens.filter(function (token) { return !RETAKE_WEAK_TOKENS.has(token); });
    if (!removedSignalTokens.length) return null;
    const lexicalSupport = repeatedLineEvidence(removedTokens.join(' '), replacementTokens.join(' '));
    if (!lexicalSupport && removedTokens.length <= 2 && removedTokens.every(function (token) { return comparativeScaffoldTokens.has(token); })) return null;
    // A review highlight still needs an actual repeated take. Conversational
    // bridges such as "I mean" are not mistakes just because the following
    // sentence continues more fluently.
    if (!lexicalSupport) return null;
    const requestedHigh = decision.confidence === 'high';
    const confidence = requestedHigh && lexicalSupport ? 'high' : 'review';
    const reason = String(decision.reason || 'A nearby take may replace this wording.').slice(0, 260) +
      (requestedHigh && !lexicalSupport ? ' The wording differs enough to require review.' : '');
    return {
      id: 'smart-retake-' + index + '-' + start + '-' + end,
      removeWordIndices: removeWordIndices,
      firstText: words.slice(start, end + 1).map(function (word) { return word.text; }).join(' '),
      replacementText: words.slice(replacementStart, replacementEnd + 1).map(function (word) { return word.text; }).join(' '),
      confidence: lexicalSupport ? confidence : 'review',
      reason: reason.slice(0, 300),
      source: 'semantic'
    };
  }).filter(Boolean);
}

function retakeCandidatesForProject(project) {
  if (Number(project && project.retakeWorkflowVersion) >= 2) return [];
  const candidates = Array.isArray(project.retakeDecisions) && project.retakeDecisions.length
    ? project.retakeDecisions
    : retakeCandidates(project.words || []);
  // Apply the same deterministic gate when reading old stored decisions, so
  // legacy model commentary about related ideas disappears immediately.
  return candidates.filter(function (candidate) {
    return candidate && candidate.source === 'marker' || isRepeatedLineRetakeCandidate(candidate);
  });
}

function retakeHighlightsForProject(project) {
  if (Number(project && project.retakeWorkflowVersion) < 3) return [];
  return (Array.isArray(project.retakeDecisions) ? project.retakeDecisions : []).filter(function (candidate) {
    return candidate && Array.isArray(candidate.removeWordIndices) && candidate.removeWordIndices.length &&
      (candidate.source === 'marker' || isRepeatedLineRetakeCandidate(candidate));
  });
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

function pageChangeFadesForSegment(segment, cuts, confirmedCutIds) {
  if (!segment || segment.type !== 'source') return { fadeIn: false, fadeOut: false };
  const confirmed = new Set((confirmedCutIds || []).map(String));
  const pageCuts = (cuts || []).filter(function (cut) { return confirmed.has(pageChangeCutKey(cut)); });
  return {
    fadeIn: pageCuts.some(function (cut) { return Math.abs(Number(cut.end) - Number(segment.start)) <= 0.02; }),
    fadeOut: pageCuts.some(function (cut) { return Math.abs(Number(cut.start) - Number(segment.end)) <= 0.02; })
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
    if (at - containing.start >= 0.04) replacement.push({ type: 'source', start: containing.start, end: at,
      fadeInFromAudioInsert: containing.fadeInFromAudioInsert === true, fadeOutToAudioInsert: clip.audioOnly === true });
    replacement.push({ type: 'insert', clipId: clip.id, start: 0, end: Number(clip.duration), clip: clip });
    if (containing.end - at >= 0.04) replacement.push({ type: 'source', start: at, end: containing.end,
      cameraResetAfterInsert: true, fadeInFromAudioInsert: clip.audioOnly === true, fadeOutToAudioInsert: containing.fadeOutToAudioInsert === true });
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

function buildAss(project, groups, startOffsetSeconds) {
  const startOffset = Math.max(0, Number(startOffsetSeconds) || 0);
  const width = Math.max(360, Math.round(Number(project.width) || 1080));
  const height = Math.max(360, Math.round(Number(project.height) || 1920));
  const isLongform = width >= height;
  const fontSize = isLongform
    ? Math.max(18, Math.round(Math.min(width, height) * 0.036))
    : Math.max(30, Math.round(Math.min(width, height) * 0.08));
  // Long-form phrases remain on one line, so a large inline size jump can
  // visually crowd neighbouring words. Keep their emphasis gentler and add
  // explicit word room below; vertical three-word windows retain 12%.
  const emphasizedSize = Math.round(fontSize * (isLongform ? 1.08 : 1.12));
  // ASS outline, shadow and side margins are pixel measures, unlike the font
  // size below. Scale portrait values with the frame width so the 404px Editor
  // render does not get a nearly three-times-heavier border than a 1080px
  // Production master viewed at the same size.
  const portraitScale = width / 1080;
  const outlineWidth = isLongform ? 2 : Number((3 * portraitScale).toFixed(2));
  const emphasizedOutlineWidth = isLongform ? 3 : Number((4 * portraitScale).toFixed(2));
  const shadowWidth = isLongform ? 1 : Number((2 * portraitScale).toFixed(2));
  const sideMargin = isLongform ? 40 : Math.round(40 * portraitScale);
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
    'Style: Default,Arial,' + fontSize + ',&H0063DFF4,&H0063DFF4,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,' + outlineWidth + ',' + shadowWidth + ',2,' + sideMargin + ',' + sideMargin + ',' + marginV + ',1',
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ];
  const events = [];
  (groups || []).forEach(function (group) {
    if (!Array.isArray(group.words) || !group.words.length) {
      events.push('Dialogue: 0,' + assTime(group.start + startOffset) + ',' + assTime(group.end + startOffset) + ',Default,,0,0,0,,' + escapeAss(maskCaption(group.text)));
      return;
    }
    if (!isLongform) {
      // Vertical content uses compact three-word windows. Keep the complete
      // window visible and move the same 12% spoken-word emphasis used by
      // landscape captions through it. Splitting here (rather than changing
      // transcript phrase groups) preserves sentence/long-pause blank beats.
      for (let windowStart = 0; windowStart < group.words.length; windowStart += 3) {
        const windowWords = group.words.slice(windowStart, windowStart + 3);
        const nextWindowWord = group.words[windowStart + 3];
        const windowEnd = nextWindowWord ? nextWindowWord.start : group.end;
        const windowText = windowWords.map(function (word) { return word.text; }).join(' ');
        const characterCount = Array.from(windowText).length;
        // At Arial's typical glyph width, 18 characters at the base size fit
        // comfortably inside the 40px ASS side margins. Longer trios scale
        // together, with a conservative floor that still permits libass to
        // wrap pathological words without clipping either frame edge.
        const fittedSize = Math.max(Math.round(fontSize * 0.36), Math.min(fontSize, Math.round(fontSize * 18 / Math.max(18, characterCount))));
        const fittedEmphasizedSize = Math.round(fittedSize * 1.12);
        windowWords.forEach(function (activeWord, activeIndex) {
          const eventStart = activeIndex === 0 ? windowWords[0].start : activeWord.start;
          const followingWord = windowWords[activeIndex + 1];
          const eventEnd = followingWord ? followingWord.start : windowEnd;
          if (eventEnd <= eventStart) return;
          const text = windowWords.map(function (word, wordIndex) {
            const escaped = escapeAss(maskCaption(word.text));
            if (fittedSize < fontSize) {
              return wordIndex === activeIndex
                ? '{\\fs' + fittedEmphasizedSize + '\\bord' + emphasizedOutlineWidth + '}' + escaped
                : '{\\fs' + fittedSize + '\\bord' + outlineWidth + '}' + escaped;
            }
            return wordIndex === activeIndex ? '{\\fs' + emphasizedSize + '\\bord' + emphasizedOutlineWidth + '}' + escaped + '{\\r}' : escaped;
          }).join(' ');
          events.push('Dialogue: 0,' + assTime(eventStart + startOffset) + ',' + assTime(eventEnd + startOffset) + ',Default,,0,0,0,,' + text);
        });
      }
      return;
    }
    // Keep the complete phrase on screen while moving one stable emphasis
    // through it. Segment boundaries use the next word's exact start, so the
    // active word changes in lockstep with speech without relying on karaoke
    // fill behavior that differs between ASS renderers.
    const characterCount = Array.from(String(group.text || '')).length + Math.max(0, group.words.length - 1);
    const fittedLongformSize = Math.max(Math.round(fontSize * 0.65), Math.min(fontSize, Math.round(fontSize * 50 / Math.max(50, characterCount))));
    const fittedEmphasizedSize = Math.round(fittedLongformSize * 1.08);
    group.words.forEach(function (activeWord, activeIndex) {
      const eventStart = activeIndex === 0 ? group.start : activeWord.start;
      const eventEnd = activeIndex + 1 < group.words.length ? group.words[activeIndex + 1].start : group.end;
      if (eventEnd <= eventStart) return;
      const text = group.words.map(function (word, wordIndex) {
        const escaped = escapeAss(maskCaption(word.text));
        if (fittedLongformSize < fontSize) {
          return wordIndex === activeIndex
            ? '{\\fs' + fittedEmphasizedSize + '\\bord' + emphasizedOutlineWidth + '}' + escaped
            : '{\\fs' + fittedLongformSize + '\\bord' + outlineWidth + '}' + escaped;
        }
        return wordIndex === activeIndex ? '{\\fs' + emphasizedSize + '\\bord' + emphasizedOutlineWidth + '}' + escaped + '{\\r}' : escaped;
      // Two non-collapsing spaces reserve enough room for the highlighted
      // word to grow without its outline touching either neighbour.
      }).join('\\h\\h');
      events.push('Dialogue: 0,' + assTime(eventStart + startOffset) + ',' + assTime(eventEnd + startOffset) + ',Default,,0,0,0,,' + text);
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
  summary.editStarted = editorWorkStarted(project);
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

function editorWorkStarted(project) {
  if (!project) return false;
  if (project.reviewStartedAt) return true;
  if (Array.isArray(project.cutDecisionHistory) && project.cutDecisionHistory.length > 0) return true;
  if (Array.isArray(project.manualRevisions) && project.manualRevisions.length > 0) return true;
  return Number(project.editRevision) > 2;
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
  const onProjectCreated = options.onProjectCreated;
  const onProjectSeen = options.onProjectSeen;
  const onProjectMetadataChanged = options.onProjectMetadataChanged;
  const onRenderReady = options.onRenderReady;
  const onRenderInvalidated = options.onRenderInvalidated;
  const onPlanningPieceChanged = options.onPlanningPieceChanged;
  const onProjectDeleted = options.onProjectDeleted;
  const getAudioTracks = options.getAudioTracks;
  const getAudioTrackPath = options.getAudioTrackPath;
  const getAudioMixSettings = options.getAudioMixSettings;
  const buildAudioPreview = options.buildAudioPreview;
  const queueManualRevision = options.queueManualRevision;
  const storage = options.storage;
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
  const upload = multer({ storage: uploadStorage, limits: { fileSize: MAX_LOCAL_UPLOAD_BYTES } });
  const getStmt = db.prepare('SELECT data FROM records WHERE store_name = ? AND id = ?');
  const listStmt = db.prepare('SELECT data FROM records WHERE store_name = ? ORDER BY updated_at DESC');
  const putStmt = db.prepare('INSERT INTO records (store_name, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(store_name, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at');
  const delStmt = db.prepare('DELETE FROM records WHERE store_name = ? AND id = ?');
  const transcriptionJobs = new Map();
  const previewJobs = new Map();
  const renderPreviewJobs = new Map();
  const renderJobs = new Map();
  const masterRenderJobs = new Map();
  const productionJobs = new Map();
  const audioPreviewJobs = new Map();
  const audioPreviewCache = new Map();
  const audioPreviewQueue = createConcurrentTaskQueue(2);
  // All sustained FFmpeg work shares one CPU-bounded queue. On the current
  // two-core host this deliberately runs one encode with both cores; explicit
  // review previews are urgent, while production masters wait their turn.
  const encodeQueue = createPriorityTaskQueue(EDITOR_ENCODE_CONCURRENCY);
  const classificationJobs = new Map();
  const retakeJobs = new Map();
  const planningMatchJobs = new Map();
  const clipInsertJobs = new Map();
  const automaticRenderTimers = new Map();
  const uploadCapacityReservations = createByteReservationLedger();
  const sourceHashClaims = createKeyedClaimRegistry();
  const sourcePreparationJobs = new Map();
  const chunkUploadSessions = new Map();
  const cloudChunkBusy = new Set();
  let cloudIntakeRunning = false;
  let cloudIntakeActiveId = '';
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

  function invalidateProjectRender(project, settings) {
    settings = settings || {};
    const hadVerifiedRender = project && project.renderStatus === 'ready';
    const rebuildPending = hadVerifiedRender || !!(project && project.renderRebuildPending);
    if (hadVerifiedRender && !settings.workflowAlreadyInvalidated && typeof onRenderInvalidated === 'function') {
      try { onRenderInvalidated({ project: project }); }
      catch (error) { project.workflowWarning = 'The edit changed safely, but its linked planning card could not be restored to Uploaded.'; }
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

  function markProjectRenderDirty(project) {
    if (!project) return;
    if (project.renderStatus === 'ready' && !project.renderDirty && typeof onRenderInvalidated === 'function') {
      try { onRenderInvalidated({ project: project }); }
      catch (error) { project.workflowWarning = 'The edit changed safely, but its linked planning card could not be restored to Filmed.'; }
    }
    project.renderDirty = true;
    project.renderError = '';
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
  function readCloudRecord(store, id) {
    const row = getStmt.get(store, id);
    if (!row) return null;
    try { return JSON.parse(row.data); } catch (error) { return null; }
  }
  function saveCloudRecord(store, record) {
    record.updatedAt = new Date().toISOString();
    putStmt.run(store, record.id, JSON.stringify(record), record.updatedAt);
    return record;
  }
  function cloudIntakeList() {
    return listStmt.all(CLOUD_INTAKE_STORE).map(function (row) {
      try { return JSON.parse(row.data); } catch (error) { return null; }
    }).filter(Boolean);
  }
  function manualRevisionEntries(project) {
    return Array.isArray(project && project.manualRevisions) ? project.manualRevisions : [];
  }
  function activeManualRevision(project) {
    return manualRevisionEntries(project).find(function (entry) {
      return entry && (entry.status === 'queued' || entry.status === 'running');
    }) || null;
  }
  function updateManualRevisionByVoiceMessage(voiceMessageId, update) {
    if (!voiceMessageId) return null;
    const rows = listStmt.all(STORE_NAME);
    for (const row of rows) {
      let project;
      try { project = JSON.parse(row.data); } catch (error) { continue; }
      const entries = manualRevisionEntries(project);
      const index = entries.findIndex(function (entry) { return entry.voiceMessageId === voiceMessageId; });
      if (index === -1) continue;
      const entry = Object.assign({}, entries[index], update || {});
      project.manualRevisions = entries.slice();
      project.manualRevisions[index] = entry;
      saveProject(project);
      return { project: project, revision: entry };
    }
    return null;
  }
  function markManualRevisionRunningByVoiceMessage(voiceMessageId) {
    return updateManualRevisionByVoiceMessage(voiceMessageId, {
      status: 'running', startedAt: new Date().toISOString(), error: ''
    });
  }
  function finishManualRevisionByVoiceMessage(voiceMessageId, outcome) {
    outcome = outcome || {};
    const failed = outcome.status === 'error';
    return updateManualRevisionByVoiceMessage(voiceMessageId, {
      status: failed ? 'error' : 'done',
      completedAt: new Date().toISOString(),
      summary: failed ? '' : String(outcome.summary || 'Manual revision completed.').slice(0, 8000),
      error: failed ? String(outcome.error || 'The manual revision could not be completed.').slice(0, 2000) : ''
    });
  }
  function projectDetail(project) {
    project.cuts = cutsForProject(project);
    project.pageChangeCutIds = confirmedPageChangeCutKeys(project, project.cuts);
    project.editableTimelineCuts = editableTimelineCuts(project);
    project.captionGroups = captionGroups(project, project.cuts);
    project.gapDecisions = gapDecisions(project);
    project.retakeCandidates = retakeCandidatesForProject(project);
    project.retakeHighlights = retakeHighlightsForProject(project);
    const planningPiece = project.planningPieceId && typeof getPlanningPiece === 'function' ? getPlanningPiece(project.planningPieceId) : null;
    project.transcriptParagraphStartIndices = transcriptParagraphStartIndices(project.words || [], planningPiece && planningPiece.notesHtml);
    project.unresolvedRetakeCount = unresolvedRetakeCount(project);
    project.appliedRetakeCount = appliedRetakeCount(project);
    project.layoutReviewRequired = layoutReviewRequired(project);
    project.effectiveLayout = effectiveLayout(project);
    project.detectedContentType = contentTypeForProject(project, project.cuts);
    project.planningCandidates = typeof getPlanningCandidates === 'function' ? getPlanningCandidates(project) : [];
    project.canUndoCut = Array.isArray(project.cutDecisionHistory) && project.cutDecisionHistory.length > 0;
    project.editStarted = editorWorkStarted(project);
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
    if (typeof options.availableDiskBytes === 'function') return options.availableDiskBytes();
    try {
      const stat = fs.statfsSync(dataDir);
      return Number(stat.bavail) * Number(stat.bsize || stat.frsize || 4096);
    } catch (error) { return 0; }
  }
  function ensureUploadCapacity(req, res, next) {
    const contentLength = Number(req.headers['content-length']);
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
      return res.status(411).json({ error: 'upload_length_required', message: 'Use the resumable Editor uploader for large recordings.' });
    }
    if (contentLength > MAX_LOCAL_UPLOAD_BYTES + 1024 * 1024) {
      return res.status(413).json({ error: 'local_upload_too_large', message: 'Use the resumable Editor uploader so this recording can be secured in R2.' });
    }
    const projects = listStmt.all(STORE_NAME).map(function (row) { try { return JSON.parse(row.data); } catch (error) { return null; } }).filter(Boolean);
    const outstanding = outstandingEditorCapacity(projects);
    const requestedCapacity = requiredEditorCapacity(contentLength, false);
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
      'format=duration:stream=codec_type,codec_name,width,height,pix_fmt,duration:stream_tags=rotate:stream_side_data=rotation',
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
      videoDuration: Number(video.duration) || 0,
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
      const durationValid = !Number(expectedDuration) || (
        Math.abs(media.duration - Number(expectedDuration)) <= renderDurationTolerance(expectedDuration) &&
        Math.abs(media.videoDuration - Number(expectedDuration)) <= renderDurationTolerance(expectedDuration)
      );
      const rotationBakedIn = Math.abs(Number(media.rotation) || 0) % 180 !== 90;
      return media.videoCodec === 'h264' && media.hasAudio && media.width > 0 && media.height > 0 &&
        Math.max(media.width, media.height) <= 720 && rotationBakedIn && durationValid;
    } catch (error) { return false; }
  }

  async function buildScrubProxy(inputPath, outputPath, expectedDuration, label) {
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-filter_threads', String(EDITOR_FFMPEG_THREADS), '-autorotate', '1', '-i', inputPath,
      '-map', '0:v:0', '-map', '0:a:0', '-vf',
      "scale=w='if(gte(iw,ih),trunc(min(720,iw)/2)*2,-2)':h='if(gte(iw,ih),-2,trunc(min(720,ih)/2)*2)',fps=24",
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'fastdecode', '-crf', '31', '-pix_fmt', 'yuv420p',
      '-threads', String(EDITOR_FFMPEG_THREADS),
      '-g', '12', '-keyint_min', '12', '-sc_threshold', '0',
      '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', outputPath], label);
    if (!await browserPreviewIsValid(outputPath, expectedDuration)) throw new Error('The scrub-optimized browser preview failed verification.');
  }

  async function buildEditingMaster(inputPath, outputPath, expectedDuration) {
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-filter_threads', String(EDITOR_FFMPEG_THREADS),
      '-autorotate', '1', '-i', inputPath, '-map', '0:v:0', '-map', '0:a:0', '-vf',
      "scale=w='if(gte(iw,ih),trunc(min(1920,iw)/2)*2,-2)':h='if(gte(iw,ih),-2,trunc(min(1920,ih)/2)*2)',fps=30",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-threads', String(EDITOR_FFMPEG_THREADS), '-g', '60', '-keyint_min', '30', '-sc_threshold', '0',
      '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', outputPath], 'oversized source editing master');
    const media = await probe(outputPath);
    const durationValid = Math.abs(media.duration - Number(expectedDuration)) <= renderDurationTolerance(expectedDuration) &&
      Math.abs(media.videoDuration - Number(expectedDuration)) <= renderDurationTolerance(expectedDuration);
    if (!media.hasAudio || media.videoCodec !== 'h264' || !durationValid || !media.width || !media.height) {
      throw new Error('The compact editing master failed verification.');
    }
    return media;
  }

  function prepareOversizedSource(id) {
    if (sourcePreparationJobs.has(id)) return sourcePreparationJobs.get(id);
    const job = encodeQueue.enqueue(async function () {
      let project = getProject(id);
      if (!project || !project.oversizedSource || project.sourcePreparationStatus === 'ready' || !fs.existsSync(sourcePath(id))) return;
      if (!storage || !storage.configured || typeof storage.uploadEditorSource !== 'function') {
        project.sourcePreparationStatus = 'error';
        project.sourcePreparationError = 'R2 storage is unavailable, so this oversized recording was kept safely but cannot enter the Editor yet.';
        saveProject(project);
        return;
      }
      const compactPath = path.join(projectDir(id), 'source-compacting.mp4');
      try {
        if (!project.sourceStorageObjectKey) {
          project.sourcePreparationStatus = 'archiving';
          project.sourcePreparationError = '';
          saveProject(project);
          const remote = await storage.uploadEditorSource(id, sourcePath(id), project.mimeType || 'video/mp4');
          project = getProject(id);
          if (!project) return;
          project.sourceStorageProvider = 'cloudflare_r2';
          project.sourceStorageObjectKey = remote.key;
          project.sourceStorageSizeBytes = remote.sizeBytes;
          project.sourceStorageEtag = remote.etag;
          project.sourceStoredAt = new Date().toISOString();
        }
        project.sourcePreparationStatus = 'compacting';
        project.sourcePreparationError = '';
        saveProject(project);
        fs.rmSync(compactPath, { force: true });
        const compactMedia = await buildEditingMaster(sourcePath(id), compactPath, project.duration);
        const compactStat = fs.statSync(compactPath);
        fs.renameSync(compactPath, sourcePath(id));
        project = getProject(id);
        if (!project) return;
        project.originalSizeBytes = Number(project.originalSizeBytes) || Number(project.sizeBytes) || 0;
        project.originalWidth = Number(project.originalWidth) || Number(project.width) || 0;
        project.originalHeight = Number(project.originalHeight) || Number(project.height) || 0;
        project.sizeBytes = compactStat.size;
        project.videoCodec = compactMedia.videoCodec;
        project.audioCodec = compactMedia.audioCodec;
        project.width = compactMedia.width;
        project.height = compactMedia.height;
        project.sourceRotation = compactMedia.rotation;
        project.sourcePreparationStatus = 'ready';
        project.sourcePreparationError = '';
        project.sourcePreparedAt = new Date().toISOString();
        // The compact master is already H.264/AAC with fast-start metadata and
        // bounded dimensions, so it is also the browser-safe editing source.
        // Do not spend another full-duration encode producing a second proxy.
        project.browserPreviewRequired = false;
        project.browserPreviewStatus = 'not_required';
        project.browserPreviewVersion = 0;
        saveProject(project);
        setImmediate(function () { transcribeProject(id); });
      } catch (error) {
        fs.rm(compactPath, { force: true }, function () {});
        try { project = getProject(id); } catch (readError) { return; }
        if (project) {
          project.sourcePreparationStatus = 'error';
          project.sourcePreparationError = String(error.message || error).slice(0, 500);
          saveProject(project);
        }
      }
    }, 'urgent', id).finally(function () { sourcePreparationJobs.delete(id); });
    sourcePreparationJobs.set(id, job);
    return job;
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
    }, 'normal', id).finally(function () { previewJobs.delete(id); });
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
    }, 'normal', id).finally(function () { renderPreviewJobs.delete(id); });
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
        project.autoRetakeRemovedWordIndices = [];
        project.dismissedRetakeIds = [];
        project.restoredAutoCutIds = [];
        project.autoSilenceEnabled = true;
        project.transcriptionStatus = project.words.length ? 'ready' : 'error';
        project.transcriptionError = project.words.length ? '' : 'No timed speech was detected in this recording.';
        project.retakeAnalysisStatus = project.words.length && typeof analyzeRetakes === 'function' ? 'pending' : 'unavailable';
        project.retakeAnalysisError = '';
        project.retakeDecisions = [];
        project.retakeWorkflowVersion = 3;
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
        const markerDecisions = retakeMarkerDecisions(project.words || []);
        const markerIndices = new Set(markerDecisions.flatMap(function (decision) { return decision.removeWordIndices; }));
        const repeatedTakeDecisions = retakeCandidates(project.words || []).filter(function (decision) {
          return !decision.removeWordIndices.some(function (index) { return markerIndices.has(index); });
        });
        const deterministicIndices = new Set(markerDecisions.concat(repeatedTakeDecisions).flatMap(function (decision) { return decision.removeWordIndices; }));
        const semanticDecisions = normalizeRetakeDecisions(raw && raw.decisions, project.words || [], { highlightOnly: true }).filter(function (decision) {
          return !decision.removeWordIndices.some(function (index) { return deterministicIndices.has(index); });
        });
        project.retakeDecisions = markerDecisions.concat(repeatedTakeDecisions, semanticDecisions);
        project.autoRetakeRemovedWordIndices = [];
        project.retakeAnalysisStatus = 'ready';
        project.retakeAnalysisError = '';
        saveProject(project);
        setImmediate(function () { maybeAutoRender(id); });
      } catch (err) {
        project = getProject(id);
        if (project) {
          project.retakeAnalysisStatus = 'error';
          project.retakeAnalysisError = String(err.message || err).slice(0, 500);
          saveProject(project);
          setImmediate(function () { maybeAutoRender(id); });
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
        if (typeof onProjectMetadataChanged === 'function') onProjectMetadataChanged({ project: project });
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
        const audioOnly = request.audioOnly === true;
        const clip = Object.assign({}, directive, { id: clipId, directiveId: directive.id, afterWordIndex: Number(word.index), afterSourceTime: Number(word.end), audioOnly: audioOnly, status: 'preparing', planningPieceId: planningPiece.id, planningPieceTitle: planningPiece.title || '', createdAt: new Date().toISOString() });
        project.insertedClips = (project.insertedClips || []).concat([clip]);
        project.clipInsertStatus = 'preparing'; project.clipInsertError = '';
        invalidateProjectRender(project); advanceEditRevision(project); saveProject(project);

        const prefix = 'editor-youtube-' + clipId;
        tempPrefix = prefix;
        const template = path.join(tempDir, prefix + '.%(ext)s');
        const target = insertedClipPath(id, clipId);
        const requestedDuration = directive.sourceEnd - directive.sourceStart;
        const reused = audioOnly && (project.insertedClips || []).find(function (item) {
          return item.id !== clipId && item.status === 'ready' && item.audioOnly === true && item.sourceUrl === directive.sourceUrl &&
            Number(item.sourceStart) === directive.sourceStart && Number(item.sourceEnd) === directive.sourceEnd && fs.existsSync(insertedClipPath(id, item.id));
        });
        if (reused) {
          fs.copyFileSync(insertedClipPath(id, reused.id), target);
        } else {
          const downloadArgs = ['--no-playlist', '--no-warnings', '--download-sections', '*' + directive.sourceStart + '-' + directive.sourceEnd];
          if (audioOnly) downloadArgs.push('-f', 'ba/b');
          else downloadArgs.push('--force-keyframes-at-cuts', '-f', 'bv*[height<=1080]+ba/b[height<=1080]', '--merge-output-format', 'mp4');
          downloadArgs.push('-o', template, directive.sourceUrl);
          await run('yt-dlp', downloadArgs, 'YouTube clip download');
          const downloadedName = fs.readdirSync(tempDir).find(function (name) { return name.indexOf(prefix + '.') === 0; });
          if (!downloadedName) throw new Error('YouTube returned no downloadable clip.');
          const downloaded = path.join(tempDir, downloadedName);
          if (audioOnly) {
            await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', downloaded, '-f', 'lavfi', '-i',
              'color=c=black:s=640x360:r=30000/1001:d=' + requestedDuration.toFixed(3), '-filter_complex', audioInterludeVideoFilter(requestedDuration),
              '-t', requestedDuration.toFixed(3), '-map', '[v]', '-map', '0:a:0', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
              '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', target], 'audio interlude normalization');
          } else {
            await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', downloaded, '-t', requestedDuration.toFixed(3),
              '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', target], 'clip normalization');
          }
          fs.rmSync(downloaded, { force: true });
        }
        const media = await probe(target);
        if (!media.hasAudio || !media.hasVideo || media.duration < 0.2) throw new Error('The selected YouTube range did not contain usable audio and video.');
        const audioPath = path.join(tempDir, 'editor-clip-audio-' + clipId + '.mp3');
        let words = [];
        if (!audioOnly) try {
          await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', target, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', audioPath], 'clip audio extraction');
          const transcription = await transcribeDetailed(fs.readFileSync(audioPath), 'audio/mpeg');
          words = normalizeWords(transcription.words).filter(function (item) { return item.start < media.duration + 0.1; });
        } catch (error) {
          words = approximateWords(directive.quote, media.duration);
        } finally { fs.rmSync(audioPath, { force: true }); }
        if (!audioOnly && !words.length) throw new Error('The clip downloaded, but its speech could not be transcribed and the outline did not include a quoted caption fallback.');
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
    // The Editor is deliberately decision-first: prepare the transcript and
    // lightweight source preview, let Harvey make every cut, then perform one
    // lightweight decision-preview rebuild when he explicitly asks for it.
    // Starting a full render here used to lock the transcript after every
    // upload and made a fresh recording look as though an edit was rebuilding.
    return false;
  }

  function scheduleAutoRender(id, delayMs) {
    if (automaticRenderTimers.has(id)) clearTimeout(automaticRenderTimers.get(id));
    const timer = setTimeout(function () {
      automaticRenderTimers.delete(id);
      maybeAutoRender(id);
    }, Math.max(0, Number(delayMs) || 0));
    automaticRenderTimers.set(id, timer);
  }

  async function renderProject(id, options) {
    options = options || {};
    const masterOutputPath = options.masterOutputPath ? path.resolve(String(options.masterOutputPath)) : '';
    const master = !!masterOutputPath;
    const renderSourcePath = options.sourceOverridePath ? path.resolve(String(options.sourceOverridePath)) : sourcePath(id);
    const jobMap = master ? masterRenderJobs : renderJobs;
    if (jobMap.has(id)) return jobMap.get(id);
    let queuedProject = getProject(id);
    if (!queuedProject) return;
    if (master && !queuedProject.productionPieceId) throw new Error('This edit has not been sent to Production yet.');
    if (!master) {
      queuedProject.renderStatus = 'queued';
      queuedProject.renderError = '';
      queuedProject.renderProgress = 0;
      saveProject(queuedProject);
    }
    const job = encodeQueue.enqueue(async function () {
      let project = getProject(id);
      if (!project) return;
      if (!master) {
        project.renderStatus = 'running';
        project.renderError = '';
        project.renderProgress = 0;
        saveProject(project);
      }
      const cuts = cutsForProject(project);
      const detectedPageChanges = await detectVisualPageChangeCutIds(renderSourcePath, cuts);
      const suppressedPageChanges = (project.suppressedPageChangeCutKeys || []).map(String);
      project.pageChangeCutIds = detectedPageChanges.filter(function (key) {
        return !suppressedPageChanges.some(function (saved) { return pageChangeSuppressionMatches(saved, key); });
      });
      saveProject(project);
      const segments = editorTimelineSegments(project, cuts);
      if (!segments.length) throw new Error('Every part of the recording is currently cut. Restore some transcript first.');
      const contentDuration = segments.reduce(function (sum, segment) { return sum + segment.end - segment.start; }, 0);
      const layout = effectiveLayout(project);
      // Landscape footage must be fully black before a hand reaching for the
      // camera can become visible. Editor/no-music renders end at that point;
      // a music-backed production master retains a short black-only tail.
      const outro = renderOutroTiming(layout, master && options.includeMusicTail === true, project.outroFadeSeconds);
      const expectedDuration = OPENING_PREROLL_SECONDS + contentDuration + outro.totalSeconds;
      const assPath = path.join(projectDir(id), 'captions.ass');
      const renderShape = renderShapeForProject(project, layout, master);
      const outputPath = master ? masterOutputPath : renderPath(id);
      if (project.captionsEnabled !== false) fs.writeFileSync(assPath, buildAss(renderShape, renderCaptionGroups(project, cuts, segments), OPENING_PREROLL_SECONDS));
      const filters = [];
      const readyClips = (project.insertedClips || []).filter(function (clip) { return clip.status === 'ready'; });
      const clipInputIndex = new Map(readyClips.map(function (clip, index) { return [clip.id, index + 1]; }));
      const clipAudioBalance = new Map();
      let mainVoiceLufs = null;
      if (readyClips.length) {
        // Match each external speaker to Harvey's actual recording before the
        // timeline is concatenated. Normalizing only the completed programme
        // cannot remove a local volume jump at a clip boundary.
        mainVoiceLufs = await measureIntegratedLoudness(renderSourcePath, 'main voice loudness measurement');
        for (const clip of readyClips) {
          const measuredLufs = await measureIntegratedLoudness(insertedClipPath(id, clip.id), 'inserted clip loudness measurement');
          clipAudioBalance.set(clip.id, {
            measuredLufs: measuredLufs,
            gainDb: insertedClipGainDb(mainVoiceLufs, measuredLufs)
          });
        }
      }
      segments.forEach(function (segment, index) {
        const segmentDuration = segment.end - segment.start;
        const inputIndex = segment.type === 'insert' ? clipInputIndex.get(segment.clipId) : 0;
        // Resample every retained shot to the render rate before zoompan. The
        // camera-motion filter emits one output frame per input frame; without
        // this stage a 24/25 fps phone recording is later timestamped as
        // 29.97 fps and its visual stream ends well before its audio.
        let videoFilter = '[' + inputIndex + ':v]trim=start=' + segment.start.toFixed(3) + ':end=' + segment.end.toFixed(3) + ',setpts=PTS-STARTPTS,fps=30000/1001';
        if (layout === 'vertical') {
          videoFilter += ",crop=w='min(iw\\,ih*9/16)':h='min(ih\\,iw*16/9)':x='(iw-ow)/2':y='(ih-oh)/2'";
        } else {
          videoFilter += ",crop=w='min(iw\\,ih*16/9)':h='min(ih\\,iw*9/16)':x='(iw-ow)/2':y='(ih-oh)/2'";
        }
        const cameraMotionEnabled = segment.type === 'source' && project.openingPushInEnabled !== false;
        videoFilter += cameraMotionPreparationFilter(renderShape, cameraMotionEnabled);
        if (segment.type === 'source') {
          const motion = cameraMotionForSegment(segment, cuts, layout, project.pageChangeCutIds);
          videoFilter += cameraMotionFilter({ renderShape: renderShape, layout: layout, elapsedStart: motion.elapsed, durationSeconds: motion.duration, targetScale: cameraMotionTargetScale(layout, motion, segment.cameraResetAfterInsert === true), openingEnabled: project.openingPushInEnabled !== false });
          const pageFades = pageChangeFadesForSegment(segment, cuts, project.pageChangeCutIds);
          const pageFadeDuration = Math.min(PAGE_CHANGE_FADE_SECONDS, Math.max(0.02, segmentDuration / 2));
          if (pageFades.fadeIn) videoFilter += ',fade=t=in:st=0:d=' + pageFadeDuration.toFixed(3) + ':color=black';
          if (pageFades.fadeOut) videoFilter += ',fade=t=out:st=' + Math.max(0, segmentDuration - pageFadeDuration).toFixed(3) + ':d=' + pageFadeDuration.toFixed(3) + ':color=black';
          const insertFadeDuration = Math.min(AUDIO_INTERLUDE_FADE_SECONDS, Math.max(0.02, segmentDuration / 2));
          if (segment.fadeInFromAudioInsert) videoFilter += ',fade=t=in:st=0:d=' + insertFadeDuration.toFixed(3) + ':color=black';
          if (segment.fadeOutToAudioInsert) videoFilter += ',fade=t=out:st=' + Math.max(0, segmentDuration - insertFadeDuration).toFixed(3) + ':d=' + insertFadeDuration.toFixed(3) + ':color=black';
        }
        videoFilter += ',format=yuv420p';
        filters.push(videoFilter + '[v' + index + ']');
        // Tiny boundary fades prevent waveform discontinuities from creating
        // a click at transcript/jump cuts, without audibly crossfading words.
        let audioFilter = '[' + inputIndex + ':a]atrim=start=' + segment.start.toFixed(3) + ':end=' + segment.end.toFixed(3) + ',asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
        if (segment.type === 'insert') {
          const balance = clipAudioBalance.get(segment.clipId);
          // Preserve the measured speech relationship while catching peaks
          // introduced by a positive gain. The later production loudness pass
          // can then move the whole programme without changing this match.
          audioFilter += ',volume=' + balance.gainDb.toFixed(2) + 'dB,alimiter=limit=0.841395:level=false';
        }
        if (index > 0) audioFilter += ',afade=t=in:st=0:d=0.008';
        if (index + 1 < segments.length) audioFilter += ',afade=t=out:st=' + Math.max(0, segmentDuration - 0.008).toFixed(3) + ':d=0.008';
        filters.push(audioFilter + '[a' + index + ']');
      });
      const concatInputs = segments.map(function (_, index) { return '[v' + index + '][a' + index + ']'; }).join('');
      filters.push(concatInputs + 'concat=n=' + segments.length + ':v=1:a=1[joinedv][outa]');
      // zoompan/concat can leave a coarse inherited time base. Normalize it
      // before extending the stream, otherwise FFmpeg may drop the held frames
      // or interpret a two-second pad as hundreds of seconds.
      // A black first encoded frame can become the static cover on short-form
      // feeds even if autoplay fades up immediately. Portrait videos therefore
      // show the first retained book frame throughout the speech preroll;
      // landscape videos keep their black-to-book opening treatment.
      filters.push('[joinedv]settb=AVTB,setpts=N/(30000/1001*TB)' +
        ',tpad=start_mode=clone:start_duration=' + OPENING_PREROLL_SECONDS.toFixed(3) +
        ',setpts=N/(30000/1001*TB)' +
        (layout === 'horizontal' ? ',fade=t=in:st=0:d=' + OPENING_PREROLL_SECONDS.toFixed(3) + ':color=black' : '') +
        '[normalizedv]');
      if (project.captionsEnabled !== false) filters.push("[normalizedv]subtitles='" + assPath.replace(/'/g, "'\\''") + "'[captionedv]");
      else filters.push('[normalizedv]null[captionedv]');
      // Avoid the abrupt end-card cut: hold the final composed frame, fade it
      // to black, and keep a silent dialogue bed beneath the soundtrack tail.
      filters.push('[captionedv]tpad=stop_mode=clone:stop_duration=' + outro.totalSeconds.toFixed(3) +
        ',fade=t=out:st=' + (OPENING_PREROLL_SECONDS + contentDuration).toFixed(3) + ':d=' + outro.visualFadeSeconds.toFixed(3) +
        ',fps=30000/1001[outv]');
      const requestedVoiceGain = voiceGainFilter(project.voiceGainAdjustments, contentDuration);
      if (requestedVoiceGain) filters.push('[outa]' + requestedVoiceGain + '[leveledouta]');
      filters.push('[' + (requestedVoiceGain ? 'leveledouta' : 'outa') + ']adelay=delays=' + Math.round(OPENING_PREROLL_SECONDS * 1000) +
        ':all=1,apad=pad_dur=' + outro.totalSeconds.toFixed(3) + '[outaextended]');
      let lastReportedProgress = -1;
      const ffmpegInputs = ['-hide_banner', '-loglevel', 'error', '-y', '-filter_complex_threads', String(EDITOR_FFMPEG_THREADS), '-autorotate', '1', '-i', renderSourcePath];
      readyClips.forEach(function (clip) { ffmpegInputs.push('-i', insertedClipPath(id, clip.id)); });
      await runWithProgress('ffmpeg', ffmpegInputs.concat(['-filter_complex', filters.join(';'),
        '-map', '[outv]', '-map', '[outaextended]', '-c:v', 'libx264',
        '-preset', master ? 'veryfast' : 'ultrafast', '-crf', master ? '18' : '30',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', master ? '192k' : '96k',
        '-threads', String(EDITOR_FFMPEG_THREADS),
        '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', outputPath]), master ? 'production master render' : 'editor decision preview', function (encodedSeconds) {
        const percent = Math.min(99, Math.max(0, Math.floor(encodedSeconds / Math.max(0.01, expectedDuration) * 100)));
        if (percent < lastReportedProgress + 2) return;
        lastReportedProgress = percent;
        if (typeof options.onProgress === 'function') options.onProgress(percent);
        if (!master) {
          const current = getProject(id);
          if (current && current.renderStatus === 'running') { current.renderProgress = percent; saveProject(current); }
        }
      });
      project = getProject(id);
      if (!project) return;
      const stat = fs.statSync(outputPath);
      const renderedMedia = await probe(outputPath);
      const volumeResult = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', outputPath, '-map', '0:a:0',
        '-af', 'volumedetect', '-f', 'null', '-'], 'render audio verification');
      const audioPeakDb = parseMaxVolume(volumeResult.stderr);
      const durationTolerance = renderDurationTolerance(expectedDuration);
      const qualityChecks = {
        playableFile: stat.size > 1024,
        correctFrame: renderedMedia.width === renderShape.width && renderedMedia.height === renderShape.height,
        standardPixelFormat: renderedMedia.pixelFormat === 'yuv420p',
        audioPresent: renderedMedia.hasAudio,
        audibleAudio: Number.isFinite(audioPeakDb) && audioPeakDb > -55,
        durationMatches: Math.abs(renderedMedia.duration - expectedDuration) <= durationTolerance,
        visualDurationMatches: Math.abs(renderedMedia.videoDuration - expectedDuration) <= durationTolerance
      };
      if (Object.keys(qualityChecks).some(function (key) { return !qualityChecks[key]; })) {
        const failedChecks = Object.keys(qualityChecks).filter(function (key) { return !qualityChecks[key]; });
        const durationDetail = failedChecks.includes('durationMatches')
          ? ' (expected ' + expectedDuration.toFixed(3) + 's, received ' + Number(renderedMedia.duration).toFixed(3) + 's)' : '';
        throw new Error('Rendered output failed technical verification: ' + failedChecks.join(', ') + durationDetail);
      }
      if (master) {
        if (typeof options.onProgress === 'function') options.onProgress(100);
        return {
          path: outputPath,
          width: renderedMedia.width,
          height: renderedMedia.height,
          duration: renderedMedia.duration,
          sizeBytes: stat.size
        };
      }
      const renderSha256 = await hashFile(outputPath);
      project.renderStatus = 'ready';
      project.renderRebuildPending = false;
      project.renderDirty = false;
      project.renderVersion = EDITOR_RENDER_VERSION;
      project.renderProgress = 100;
      project.renderSizeBytes = stat.size;
      project.renderSha256 = renderSha256;
      project.renderPreviewStatus = 'not_required';
      project.renderPreviewError = '';
      project.renderPreviewVersion = 0;
      project.editedDuration = expectedDuration;
      project.renderQuality = {
        status: 'passed', checkedAt: new Date().toISOString(), checks: qualityChecks,
        width: renderedMedia.width, height: renderedMedia.height, pixelFormat: renderedMedia.pixelFormat,
        duration: renderedMedia.duration, videoDuration: renderedMedia.videoDuration,
        contentDuration: contentDuration, openingPrerollSeconds: OPENING_PREROLL_SECONDS, outroSeconds: outro.totalSeconds,
        visualFadeSeconds: outro.visualFadeSeconds, musicTailSeconds: outro.musicTailSeconds, audioPeakDb: audioPeakDb,
        insertedClipLoudness: mainVoiceLufs === null ? null : {
          mainVoiceLufs: mainVoiceLufs,
          clips: readyClips.map(function (clip) {
            const balance = clipAudioBalance.get(clip.id);
            return { id: clip.id, measuredLufs: balance.measuredLufs, gainDb: balance.gainDb };
          })
        }
      };
      project.lastRenderAt = new Date().toISOString();
      saveProject(project);
      if (typeof onRenderReady === 'function') {
        try {
          await Promise.resolve(onRenderReady({ project: project, renderPath: outputPath }));
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
    }, master ? 'normal' : 'urgent', id).catch(function (err) {
      if (master) {
        fs.rm(masterOutputPath, { force: true }, function () {});
        throw err;
      }
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
    }).finally(function () { jobMap.delete(id); });
    jobMap.set(id, job);
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
      if (typeof project.renderDirty !== 'boolean') { project.renderDirty = false; migrated = true; }
      if (!Number.isFinite(Number(project.editRevision))) { project.editRevision = 0; migrated = true; }
      if (!Number.isFinite(Number(project.renderProgress))) { project.renderProgress = 0; migrated = true; }
      if (!Array.isArray(project.insertedClips)) { project.insertedClips = []; migrated = true; }
      if (!Array.isArray(project.manualRevisions)) { project.manualRevisions = []; migrated = true; }
      if (['queued', 'preparing'].includes(project.clipInsertStatus)) {
        project.insertedClips = project.insertedClips.filter(function (clip) { return clip.status === 'ready'; });
        project.clipInsertStatus = 'error'; project.clipInsertError = 'Clip preparation was interrupted by a service restart. Press Insert clip to retry.'; migrated = true;
      }
      if (!project.audioTrackId) { project.audioTrackId = '__none__'; migrated = true; }
      if (!project.retakeAnalysisStatus) { project.retakeAnalysisStatus = 'unavailable'; migrated = true; }
      if (!project.planningMatchStatus) { project.planningMatchStatus = canResumeWork && typeof matchPlanningPiece === 'function' ? (project.transcriptionStatus === 'ready' ? 'pending' : 'pending_transcript') : 'unavailable'; migrated = true; }
      if (!canResumeWork) {
        if (migrated) saveProject(project);
        return;
      }
      if (Number(project.retakeWorkflowVersion) !== 3) {
        const automaticRetakeIndices = new Set((project.autoRetakeRemovedWordIndices || []).map(Number));
        if (automaticRetakeIndices.size) {
          project.removedWordIndices = (project.removedWordIndices || []).map(Number).filter(function (index) {
            return !automaticRetakeIndices.has(index);
          });
          if (project.renderStatus === 'ready') markProjectRenderDirty(project);
          else project.renderDirty = true;
        }
        project.autoRetakeRemovedWordIndices = [];
        project.retakeDecisions = [];
        project.dismissedRetakeIds = [];
        project.retakeAnalysisStatus = project.transcriptionStatus === 'ready' && typeof analyzeRetakes === 'function' ? 'pending' : 'unavailable';
        project.retakeAnalysisError = '';
        project.retakeWorkflowVersion = 3;
        migrated = true;
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
      const sourceNeedsPreparation = project.oversizedSource && project.sourcePreparationStatus !== 'ready';
      if (sourceNeedsPreparation && ['archiving', 'compacting'].includes(project.sourcePreparationStatus)) {
        project.sourcePreparationStatus = 'queued';
        project.sourcePreparationError = '';
        migrated = true;
      }
      const resumeTranscription = !sourceNeedsPreparation && (project.transcriptionStatus === 'running' || project.transcriptionStatus === 'pending');
      const resumePreview = !sourceNeedsPreparation && project.browserPreviewRequired && ['running', 'pending'].includes(project.browserPreviewStatus);
      // Before the decision-first workflow, fresh uploads marked their first
      // automatic full render with automaticRenderStartedAt. Those jobs are
      // redundant now and must not be resumed after this migration. Explicit
      // user rebuilds never carry that marker and remain restart-safe.
      // A startup migration may mark an old automatic take dirty above; it
      // still is not an explicitly requested rebuild and must not resume.
      const legacyAutomaticRender = !!project.automaticRenderStartedAt &&
        !project.renderSha256 && !project.lastRenderAt;
      const resumeRender = (project.renderStatus === 'running' || project.renderStatus === 'queued') && !legacyAutomaticRender;
      const resumeRetakes = ['running', 'pending', 'pending_transcript'].includes(project.retakeAnalysisStatus);
      const resumePlanning = ['running', 'pending', 'pending_transcript'].includes(project.planningMatchStatus);
      const orphanedRenderKickoff = !project.renderStatus && !!project.automaticRenderStartedAt && !legacyAutomaticRender;
      // Older recovery cleared an interrupted explicit rebuild to a blank
      // status, then refused to restart it because renderDirty was true.
      // Positive saved progress distinguishes that orphan from edits which
      // Harvey has not yet asked to render.
      const orphanedExplicitRebuild = !project.renderStatus && project.renderRebuildPending &&
        Number(project.renderProgress) > 0 && Number(project.renderProgress) < 100;
      const resumeInterruptedRender = resumeRender || orphanedRenderKickoff || orphanedExplicitRebuild;
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
        if (legacyAutomaticRender && !project.renderDirty) project.renderProgress = 0;
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
      if (migrated || resumeTranscription || resumePreview || resumeRender || resumeRetakes || resumePlanning || orphanedRenderKickoff || orphanedExplicitRebuild) saveProject(project);
      setImmediate(function () {
        if (sourceNeedsPreparation && project.sourcePreparationStatus !== 'error') prepareOversizedSource(project.id);
        if (resumeTranscription) transcribeProject(project.id);
        if (resumePreview) generateBrowserPreview(project.id);
        if (!resumeTranscription && project.transcriptionStatus === 'ready' && resumeRetakes) analyzeProjectRetakes(project.id);
        if (!resumeTranscription && project.transcriptionStatus === 'ready' && resumePlanning) matchProjectPlanningPiece(project.id);
        // Only a render that was explicitly in flight is resumed. A newly
        // uploaded recording stays editable until Rebuild preview is pressed.
        if (resumeInterruptedRender) renderProject(project.id);
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
      if (!project || project.productionPieceId || (project.oversizedSource && project.sourcePreparationStatus !== 'ready') ||
          !isId(project.id) || !fs.existsSync(sourcePath(project.id))) return;
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
        // Startup recovery may already have queued or started this proxy while
        // the asynchronous probe above was running. Preserve that live job's
        // state and output file instead of resetting it to pending (or
        // unlinking the file FFmpeg is currently writing).
        const previewJobActive = previewJobs.has(current.id);
        const dimensionsChanged = current.width !== media.width || current.height !== media.height;
        const previewMetadataChanged = !current.videoCodec || current.browserPreviewRequired === undefined || current.sourceRotation === undefined;
        const expectedPreviewStatus = needsPreview
          ? (previewValid ? 'ready' : (previewJobActive ? current.browserPreviewStatus : 'pending'))
          : 'not_required';
        const previewStateChanged = current.browserPreviewRequired !== needsPreview || current.browserPreviewStatus !== expectedPreviewStatus;
        if (!dimensionsChanged && !previewMetadataChanged && !previewStateChanged) return;
        current.videoCodec = media.videoCodec;
        current.audioCodec = media.audioCodec;
        current.sourceRotation = media.rotation;
        current.browserPreviewRequired = needsPreview;
        if (needsPreview && !previewValid && !previewJobActive) {
          await fs.promises.rm(previewFile, { force: true });
          current.browserPreviewStatus = 'pending';
          current.browserPreviewError = '';
          current.browserPreviewVersion = 0;
        } else if (needsPreview && previewValid) {
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

  // Existing verified edits may predate a dedicated low-resolution review
  // file. Build it in the background without touching their authoritative
  // stored output.
  setImmediate(function () {
    listStmt.all(STORE_NAME).forEach(function (row) {
      let project;
      try { project = JSON.parse(row.data); } catch (error) { return; }
      if (!project || project.productionPieceId || project.renderStatus !== 'ready' || !isId(project.id) || !fs.existsSync(renderPath(project.id))) return;
      if (project.renderPreviewStatus === 'not_required') return;
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
      if (!snapshot || snapshot.productionPieceId || !isId(snapshot.id)) continue;
      // A renderer-version upgrade may have invalidated this preview during a
      // previous restart. Finish that one-time migration automatically even
      // though ordinary transcript edits deliberately require Harvey's
      // explicit Rebuild preview click.
      if (snapshot.renderStatus !== 'ready' || !snapshot.renderSha256) {
        if (snapshot.renderRebuildPending && Number(snapshot.renderVersion) !== EDITOR_RENDER_VERSION &&
          !snapshot.renderDirty && automaticReviewReady(snapshot)) {
          const projectId = snapshot.id;
          setImmediate(function () { renderProject(projectId).catch(function () {}); });
        }
        continue;
      }
      if (Number(snapshot.renderVersion) !== EDITOR_RENDER_VERSION) {
        const current = getProject(snapshot.id);
        if (!current || current.productionPieceId || current.renderStatus !== 'ready' || current.renderSha256 !== snapshot.renderSha256) continue;
        invalidateProjectRender(current);
        saveProject(current);
        if (!snapshot.renderDirty && automaticReviewReady(current)) {
          const projectId = current.id;
          setImmediate(function () { renderProject(projectId).catch(function () {}); });
        }
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
    res.json(cloudIntakeList().filter(function (intake) { return !projects.some(function (project) { return project.id === intake.id; }); }).concat(projects));
  });

  async function acceptStoredEditorUpload(req, res) {
    // Multer has now materialized this request on disk. Release only its
    // admission reservation; reservations for other concurrent uploads stay
    // included in the definitive post-upload capacity check below.
    if (typeof req.releaseEditorUploadReservation === 'function') req.releaseEditorUploadReservation();
    if (!req.file || !req.file.path) return res.status(400).json({ error: 'missing_video' });
    if (req.file.size > OVERSIZED_SOURCE_BYTES && (!storage || !storage.configured || typeof storage.uploadEditorSource !== 'function')) {
      fs.rm(req.file.path, { force: true }, function () {});
      return res.status(503).json({ error: 'large_recording_storage_unavailable', message: 'R2 storage must be available before a recording over 6 GiB can enter the Editor.' });
    }
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
    const id = req.cloudIntake ? req.cloudIntake.id : crypto.randomUUID();
    try {
      fs.mkdirSync(projectDir(id), { recursive: true });
      fs.renameSync(req.file.path, sourcePath(id));
      const media = await probe(sourcePath(id));
      if (!media.duration || !media.width || !media.height || !media.hasAudio) throw new Error('The recording must contain playable video and audio.');
      const now = new Date().toISOString();
      const oversizedSource = !!req.cloudIntake || req.file.size > OVERSIZED_SOURCE_BYTES;
      const project = saveProject({
        id: id,
        name: String((req.body && req.body.name) || req.file.originalname || 'Untitled recording').slice(0, 200),
        fileName: String(req.file.originalname || 'recording.mp4').slice(0, 255),
        mimeType: normalizedVideoMimeType(req.file.originalname, req.file.mimetype),
        sizeBytes: req.file.size,
        originalSizeBytes: req.file.size,
        sourceSha256: sourceSha256,
        oversizedSource: oversizedSource,
        sourcePreparationStatus: oversizedSource ? 'queued' : 'not_required',
        sourcePreparationError: '',
        sourceStorageProvider: req.cloudIntake ? 'cloudflare_r2' : '',
        sourceStorageObjectKey: req.cloudIntake ? req.cloudIntake.key : '',
        sourceStorageSizeBytes: req.cloudIntake ? req.cloudIntake.sizeBytes : 0,
        sourceStorageEtag: req.cloudIntake ? req.cloudIntake.etag : '',
        sourceStoredAt: req.cloudIntake ? req.cloudIntake.storedAt : '',
        sourcePreparedAt: '',
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
        suppressedPageChangeCutKeys: [],
        endingProtectionEnabled: true,
        outroFadeSeconds: 1.5,
        autoSilenceEnabled: true,
        silenceThresholdSeconds: 1,
        retainedPauseSeconds: DEFAULT_RETAINED_PAUSE_SECONDS,
        autoCutBoundaryVersion: AUTO_CUT_BOUNDARY_VERSION,
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
        retakeWorkflowVersion: 3,
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
        renderDirty: false,
        renderError: '',
        renderPreviewStatus: '',
        renderPreviewError: '',
        renderPreviewVersion: 0,
        audioTrackId: '__none__',
        insertedClips: [],
        manualRevisions: [],
        clipInsertStatus: '',
        clipInsertError: '',
        editRevision: 0,
        ingestSource: req.desktopUploaderDeviceId ? 'desktop_listener' : 'browser',
        desktopUploaderDeviceId: req.desktopUploaderDeviceId || '',
        createdAt: now,
        updatedAt: now
      });
      const videoPiece = typeof onProjectCreated === 'function'
        ? await Promise.resolve(onProjectCreated({ project: project }))
        : null;
      sourceClaim.settle(id);
      res.status(202).json(Object.assign({}, project, { videoPiece: videoPiece }));
      setImmediate(function () {
        if (oversizedSource) prepareOversizedSource(id);
        else { transcribeProject(id); generateBrowserPreview(id); }
      });
    } catch (err) {
      sourceClaim.settle('');
      const failedProject = getProject(id);
      if (failedProject && typeof onProjectDeleted === 'function') {
        try { onProjectDeleted({ project: failedProject }); } catch (cleanupError) {}
      }
      delStmt.run(STORE_NAME, id);
      fs.rm(req.file.path, { force: true }, function () {});
      fs.rm(projectDir(id), { recursive: true, force: true }, function () {});
      res.status(422).json({ error: 'invalid_recording', message: String(err.message || err) });
    }
  }

  async function processCloudIntake() {
    if (cloudIntakeRunning || !storage || !storage.configured) return;
    cloudIntakeRunning = true;
    try {
      for (const intake of cloudIntakeList().sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); })) {
        if (!isId(intake.id)) continue;
        const existing = getProject(intake.id);
        if (existing && fs.existsSync(sourcePath(intake.id))) {
          delStmt.run(CLOUD_INTAKE_STORE, intake.id);
          continue;
        }
        if (intake.cloudQueueStatus === 'error') continue;
        const projects = listStmt.all(STORE_NAME).map(function (row) { try { return JSON.parse(row.data); } catch (error) { return null; } }).filter(Boolean);
        const needed = requiredEditorCapacity(intake.sizeBytes, false);
        if (availableDiskBytes() < needed + outstandingEditorCapacity(projects) + uploadCapacityReservations.total()) break;
        const reservation = uploadCapacityReservations.reserve(needed);
        const temporary = path.join(tempDir, 'editor-cloud-' + intake.id);
        cloudIntakeActiveId = intake.id;
        try {
          intake.cloudQueueStatus = 'preparing';
          intake.cloudQueueError = '';
          saveCloudRecord(CLOUD_INTAKE_STORE, intake);
          await fs.promises.rm(temporary, { force: true });
          const downloaded = await storage.downloadKey(intake.key, temporary, {
            minimumFreeBytes: requiredEditorCapacity(intake.sizeBytes, true) + outstandingEditorCapacity(projects)
          });
          if (downloaded.sizeBytes !== intake.sizeBytes) throw new Error('R2 recording size changed during retrieval.');
          uploadCapacityReservations.release(reservation);
          const outcome = await new Promise(function (resolve, reject) {
            const response = { status: function (code) { this.code = code; return this; }, json: function (body) { resolve({ code: this.code || 200, body: body }); } };
            acceptStoredEditorUpload({
              file: { path: temporary, size: downloaded.sizeBytes, originalname: intake.fileName, mimetype: intake.mimeType },
              body: { name: intake.name }, desktopUploaderDeviceId: intake.desktopUploaderDeviceId || '', cloudIntake: intake
            }, response).catch(reject);
          });
          if (outcome.code !== 202) {
            const failure = new Error(outcome.body && outcome.body.message || 'The recording could not enter the Editor.');
            failure.permanent = outcome.code >= 400 && outcome.code < 500;
            throw failure;
          }
          delStmt.run(CLOUD_INTAKE_STORE, intake.id);
          await prepareOversizedSource(intake.id);
        } catch (error) {
          uploadCapacityReservations.release(reservation);
          await fs.promises.rm(temporary, { force: true }).catch(function () {});
          // Invalid media needs human attention, but transient R2/network
          // failures can be retried by the next intake sweep.
          const current = readCloudRecord(CLOUD_INTAKE_STORE, intake.id);
          if (current) {
            current.cloudQueueStatus = error.permanent ? 'error' : 'queued';
            current.cloudQueueError = String(error.message || error).slice(0, 300);
            saveCloudRecord(CLOUD_INTAKE_STORE, current);
          }
          console.warn('Cloud Editor intake deferred:', intake.id, String(error.message || error).slice(0, 200));
          break;
        } finally { cloudIntakeActiveId = ''; }
      }
    } finally { cloudIntakeRunning = false; }
  }

  listStmt.all(CLOUD_INTAKE_STORE).forEach(function (row) {
    try {
      const intake = JSON.parse(row.data);
      if (intake.cloudQueueStatus === 'preparing') {
        intake.cloudQueueStatus = 'queued';
        saveCloudRecord(CLOUD_INTAKE_STORE, intake);
      }
    } catch (error) {}
  });
  setImmediate(function () { processCloudIntake().catch(function (error) { console.error('Cloud Editor intake failed:', error.message); }); });
  const cloudIntakeTimer = setInterval(function () { processCloudIntake().catch(function (error) { console.error('Cloud Editor intake failed:', error.message); }); }, 60 * 1000);
  if (cloudIntakeTimer.unref) cloudIntakeTimer.unref();

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
    const cloudCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    listStmt.all(CLOUD_UPLOAD_STORE).forEach(function (row) {
      let session;
      try { session = JSON.parse(row.data); } catch (error) { return; }
      if (!session || !isId(session.id) || cloudChunkBusy.has(session.id) || Number(session.touchedAt || Date.parse(session.updatedAt)) >= cloudCutoff) return;
      delStmt.run(CLOUD_UPLOAD_STORE, session.id);
      if (session.status !== 'complete' && session.r2UploadId) {
        storage.abortEditorSource(session.id, session.r2UploadId).catch(function (error) { console.warn('Could not abort stale R2 upload:', error.message); });
      }
    });
  }, 15 * 60 * 1000);
  if (typeof chunkUploadCleanupTimer.unref === 'function') chunkUploadCleanupTimer.unref();

  router.post('/uploads', async function (req, res) {
    const fileName = String(req.body && req.body.fileName || 'recording.mp4').slice(0, 255);
    const mimeType = normalizedVideoMimeType(fileName, req.body && req.body.mimeType);
    const sizeBytes = Number(req.body && req.body.sizeBytes);
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_UPLOAD_BYTES) {
      return res.status(413).json({ error: 'invalid_upload_size', message: 'This recording is empty or larger than the 128 GiB upload limit.' });
    }
    if (sizeBytes > OVERSIZED_SOURCE_BYTES && (!storage || !storage.configured || typeof storage.uploadEditorSource !== 'function')) {
      return res.status(503).json({ error: 'large_recording_storage_unavailable', message: 'R2 storage must be available before a recording over 6 GiB can enter the Editor.' });
    }
    const projects = listStmt.all(STORE_NAME).map(function (row) { try { return JSON.parse(row.data); } catch (error) { return null; } }).filter(Boolean);
    const requestedCapacity = requiredEditorCapacity(sizeBytes, false);
    const availableBytes = availableDiskBytes();
    const outstandingBytes = outstandingEditorCapacity(projects);
    const reservedBytes = uploadCapacityReservations.total();
    const cloudThreshold = Number.isFinite(options.cloudIntakeThresholdBytes) ? options.cloudIntakeThresholdBytes : OVERSIZED_SOURCE_BYTES;
    const useCloud = !!(storage && storage.configured && typeof storage.beginEditorSource === 'function' &&
      (sizeBytes > cloudThreshold || availableBytes < requestedCapacity + outstandingBytes + reservedBytes));
    if (useCloud) {
      const uploadId = crypto.randomUUID();
      let remote;
      try {
        remote = await storage.beginEditorSource(uploadId, mimeType);
        saveCloudRecord(CLOUD_UPLOAD_STORE, {
          id: uploadId, key: remote.key, r2UploadId: remote.uploadId,
          fileName: fileName, mimeType: mimeType,
          name: String(req.body && req.body.name || fileName.replace(/\.[^.]+$/, '')).slice(0, 200),
          sizeBytes: sizeBytes, receivedBytes: 0, nextChunkIndex: 0, parts: [],
          status: 'uploading', desktopUploaderDeviceId: req.desktopUploaderDeviceId || '',
          createdAt: new Date().toISOString()
        });
        return res.status(201).json({ id: uploadId, chunkSize: EDITOR_UPLOAD_CHUNK_BYTES, receivedBytes: 0 });
      } catch (error) {
        if (remote) storage.abortEditorSource(uploadId, remote.uploadId).catch(function () {});
        console.warn('Editor R2 upload could not start:', String(error.message || error).slice(0, 200));
        return res.status(503).json({ error: 'cloud_upload_unavailable', message: 'R2 intake is temporarily unavailable. The recording remains safely on your computer and will retry.' });
      }
    }
    if (sizeBytes > MAX_LOCAL_UPLOAD_BYTES) return res.status(507).json({ error: 'insufficient_storage', message: 'This recording needs R2 intake, which is not available. The original remains on your computer.' });
    if (availableBytes < requestedCapacity + outstandingBytes + reservedBytes) {
      console.warn('editor upload rejected for capacity', JSON.stringify({
        fileName: fileName, sizeBytes: sizeBytes, availableBytes: availableBytes,
        requestedCapacity: requestedCapacity, outstandingBytes: outstandingBytes,
        reservedBytes: reservedBytes, desktopUploaderDeviceId: req.desktopUploaderDeviceId || ''
      }));
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
      touchedAt: Date.now(),
      desktopUploaderDeviceId: req.desktopUploaderDeviceId || ''
    });
    res.status(201).json({ id: uploadId, chunkSize: EDITOR_UPLOAD_CHUNK_BYTES, receivedBytes: 0 });
  });

  router.get('/uploads/:uploadId', function (req, res) {
    const session = chunkUploadSessions.get(req.params.uploadId) || readCloudRecord(CLOUD_UPLOAD_STORE, req.params.uploadId);
    if (!session || (req.desktopUploaderDeviceId && session.desktopUploaderDeviceId !== req.desktopUploaderDeviceId)) {
      return res.status(404).json({ error: 'upload_session_missing' });
    }
    session.touchedAt = Date.now();
    if (session.r2UploadId) saveCloudRecord(CLOUD_UPLOAD_STORE, session);
    res.json({ id: session.id, chunkSize: EDITOR_UPLOAD_CHUNK_BYTES, receivedBytes: session.receivedBytes, sizeBytes: session.sizeBytes, nextChunkIndex: session.nextChunkIndex });
  });

  router.post('/uploads/:uploadId/chunks/:chunkIndex', express.raw({ type: 'application/octet-stream', limit: EDITOR_UPLOAD_CHUNK_BYTES + 1024 }), async function (req, res) {
    const session = chunkUploadSessions.get(req.params.uploadId) || readCloudRecord(CLOUD_UPLOAD_STORE, req.params.uploadId);
    if (!session) return res.status(404).json({ error: 'upload_session_missing', message: 'This upload session expired. The Editor will restart it automatically.' });
    if (req.desktopUploaderDeviceId && session.desktopUploaderDeviceId !== req.desktopUploaderDeviceId) return res.status(404).json({ error: 'upload_session_missing' });
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
    if (session.r2UploadId) {
      if (session.status !== 'uploading') return res.status(409).json({ error: 'upload_already_complete' });
      if (cloudChunkBusy.has(session.id)) return res.status(409).json({ error: 'upload_chunk_busy', message: 'The previous chunk is still being secured. Retry this chunk.' });
      cloudChunkBusy.add(session.id);
      try {
        const part = await storage.uploadEditorSourcePart(session.id, session.r2UploadId, chunkIndex + 1, body);
        session.parts.push(part);
        session.receivedBytes += body.length;
        session.nextChunkIndex++;
        session.touchedAt = Date.now();
        saveCloudRecord(CLOUD_UPLOAD_STORE, session);
        return res.json({ receivedBytes: session.receivedBytes, nextChunkIndex: session.nextChunkIndex });
      } catch (error) {
        return res.status(503).json({ error: 'cloud_chunk_failed', message: 'R2 could not secure this chunk. The uploader will retry it.' });
      } finally { cloudChunkBusy.delete(session.id); }
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
    const session = chunkUploadSessions.get(req.params.uploadId) || readCloudRecord(CLOUD_UPLOAD_STORE, req.params.uploadId);
    if (!session) return res.status(404).json({ error: 'upload_session_missing', message: 'This upload session expired. Please try the recording again.' });
    if (req.desktopUploaderDeviceId && session.desktopUploaderDeviceId !== req.desktopUploaderDeviceId) return res.status(404).json({ error: 'upload_session_missing' });
    if (session.r2UploadId && session.status === 'complete') {
      const secured = getProject(session.id) || readCloudRecord(CLOUD_INTAKE_STORE, session.id);
      return secured ? res.status(202).json(secured) : res.status(410).json({ error: 'recording_removed', message: 'This recording was removed from the Editor. The laptop original has not been deleted.' });
    }
    if (session.receivedBytes !== session.sizeBytes) {
      // Installed desktop listeners historically treated any 409 from
      // completion as a duplicate and marked the local file done. Cloud
      // intake must never use 409 for an incomplete original.
      return res.status(session.r2UploadId ? 503 : 409).json({ error: 'upload_incomplete', receivedBytes: session.receivedBytes, sizeBytes: session.sizeBytes });
    }
    if (session.r2UploadId) {
      if (cloudChunkBusy.has(session.id)) return res.status(503).json({ error: 'upload_chunk_busy' });
      let remote;
      try {
        remote = await storage.finishEditorSource(session.id, session.r2UploadId, session.parts, session.sizeBytes);
      } catch (error) {
        // CompleteMultipartUpload may have succeeded just before a network
        // timeout. A verified HeadObject makes the final step idempotent.
        try {
          remote = await storage.headKey(session.key);
          if (remote.sizeBytes !== session.sizeBytes) throw error;
        } catch (headError) {
          return res.status(503).json({ error: 'cloud_completion_failed', message: 'R2 could not verify the complete recording. Please retry completion.' });
        }
      }
      const intake = {
        id: session.id, key: session.key, name: session.name,
        fileName: session.fileName, mimeType: session.mimeType, sizeBytes: session.sizeBytes,
        etag: remote.etag, storedAt: new Date().toISOString(),
        cloudQueueStatus: 'queued', cloudQueueError: '',
        desktopUploaderDeviceId: session.desktopUploaderDeviceId,
        createdAt: session.createdAt
      };
      try {
        db.transaction(function () {
          saveCloudRecord(CLOUD_INTAKE_STORE, intake);
          session.status = 'complete';
          session.touchedAt = Date.now();
          saveCloudRecord(CLOUD_UPLOAD_STORE, session);
        })();
      } catch (error) {
        return res.status(503).json({ error: 'cloud_queue_unavailable', message: 'R2 secured the recording but the Editor queue could not save it yet. Retry completion.' });
      }
      setImmediate(function () { processCloudIntake().catch(function (error) { console.error('Cloud Editor intake failed:', error.message); }); });
      return res.status(202).json(intake);
    }
    chunkUploadSessions.delete(session.id);
    uploadCapacityReservations.release(session.reservationToken);
    return acceptStoredEditorUpload({
      file: { path: session.path, size: session.sizeBytes, originalname: session.fileName, mimetype: session.mimeType },
      body: { name: session.name },
      desktopUploaderDeviceId: session.desktopUploaderDeviceId || ''
    }, res);
  });

  router.delete('/uploads/:uploadId', function (req, res) {
    const session = chunkUploadSessions.get(req.params.uploadId) || readCloudRecord(CLOUD_UPLOAD_STORE, req.params.uploadId);
    if (session && req.desktopUploaderDeviceId && session.desktopUploaderDeviceId !== req.desktopUploaderDeviceId) return res.status(404).json({ error: 'upload_session_missing' });
    if (session && session.r2UploadId) {
      if (session.status === 'complete') return res.status(409).json({ error: 'recording_already_secured' });
      if (cloudChunkBusy.has(session.id)) return res.status(409).json({ error: 'upload_chunk_busy' });
      delStmt.run(CLOUD_UPLOAD_STORE, session.id);
      storage.abortEditorSource(session.id, session.r2UploadId).catch(function (error) { console.warn('Could not abort unfinished R2 upload:', error.message); });
      return res.status(204).end();
    }
    releaseChunkUploadSession(req.params.uploadId, true);
    res.status(204).end();
  });

  router.post('/:id/source-preparation/retry', function (req, res) {
    const project = isId(req.params.id) && getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (!project.oversizedSource) return res.status(409).json({ error: 'source_preparation_not_required' });
    if (project.sourcePreparationStatus !== 'error') return res.status(409).json({ error: 'source_preparation_not_retryable' });
    project.sourcePreparationStatus = 'queued';
    project.sourcePreparationError = '';
    saveProject(project);
    prepareOversizedSource(project.id);
    res.status(202).json({ ok: true });
  });

  router.post('/:id/seen', function (req, res) {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    const piece = typeof onProjectSeen === 'function' ? onProjectSeen({ project: project }) : null;
    res.json({ ok: true, videoPiece: piece || null });
  });

  router.post('/:id/review-started', function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (!project.productionPieceId && !project.reviewStartedAt) {
      project.reviewStartedAt = new Date().toISOString();
      saveProject(project);
    }
    res.json({ ok: true, reviewStartedAt: project.reviewStartedAt || '', editStarted: editorWorkStarted(project) });
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
    if (!project) {
      const intake = readCloudRecord(CLOUD_INTAKE_STORE, req.params.id);
      return intake ? res.json(intake) : res.status(404).json({ error: 'not_found' });
    }
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
    if (renderJobs.has(project.id)) return res.status(409).json({ error: 'render_in_progress', message: 'Wait for this editing preview to finish before changing its cut settings.' });
    if (Number.isFinite(Number(req.body && req.body.expectedEditRevision)) && Number(req.body.expectedEditRevision) !== (Number(project.editRevision) || 0)) {
      return res.status(409).json({ error: 'edit_conflict', message: 'This recording changed on another screen. Its latest edit has been reloaded.', editRevision: Number(project.editRevision) || 0 });
    }
    const renderWillChange = patchAffectsRender(req.body);
    const currentRemovedWordIndices = (project.removedWordIndices || []).map(Number).sort(function (a, b) { return a - b; });
    const currentDismissedRetakeIds = (project.dismissedRetakeIds || []).map(String).sort();
    const currentRestoredAutoCutIds = (project.restoredAutoCutIds || []).map(String).sort();
    const currentSuppressedPageChangeCutKeys = (project.suppressedPageChangeCutKeys || []).map(String).sort();
    const currentManualTrimCuts = protectedManualTrimCuts(project, project.manualTrimCuts);
    const currentAutoSilenceEnabled = project.autoSilenceEnabled !== false;
    const currentSilenceThresholdSeconds = Number(project.silenceThresholdSeconds) || 1;
    const currentRetainedPauseSeconds = effectiveRetainedPauseSeconds(project);
    const currentVoiceGainAdjustments = normalizeVoiceGainAdjustments(project.voiceGainAdjustments, project.duration);
    const currentOutroFadeSeconds = Number(project.outroFadeSeconds) || 0;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'outroFadeSeconds') &&
        (!Number.isFinite(Number(req.body.outroFadeSeconds)) || Number(req.body.outroFadeSeconds) < 0.3 || Number(req.body.outroFadeSeconds) > 4)) {
      return res.status(400).json({ error: 'invalid_outro_fade', message: 'Fade to black must be between 0.3 and 4 seconds.' });
    }
    const nextOutroFadeSeconds = Object.prototype.hasOwnProperty.call(req.body || {}, 'outroFadeSeconds')
      ? Number(Number(req.body.outroFadeSeconds).toFixed(2)) : currentOutroFadeSeconds;
    const nextRemovedWordIndices = Array.isArray(req.body && req.body.removedWordIndices)
      ? Array.from(new Set(req.body.removedWordIndices.map(Number).filter(function (index) { return Number.isInteger(index) && index >= 0 && index < (project.words || []).length; }))).sort(function (a, b) { return a - b; })
      : currentRemovedWordIndices;
    const nextDismissedRetakeIds = Array.isArray(req.body && req.body.dismissedRetakeIds)
      ? Array.from(new Set(req.body.dismissedRetakeIds.map(String).filter(function (id) { return /^(?:retake-\d+|smart-retake-\d+-\d+-\d+|marker-retake-\d+-\d+-\d+)$/.test(id); }))).sort()
      : currentDismissedRetakeIds;
    const nextRestoredAutoCutIds = Array.isArray(req.body && req.body.restoredAutoCutIds)
      ? Array.from(new Set(req.body.restoredAutoCutIds.map(String).filter(function (id) { return /^(lead|tail|gap-\d+)$/.test(id); }))).sort()
      : currentRestoredAutoCutIds;
    const validPageChangeKeys = new Set(cutsForProject(project).filter(function (cut) {
      return (cut.reason === 'long_pause' || cut.reason === 'combined') && cut.end - cut.start >= PAGE_CHANGE_CUT_SECONDS;
    }).map(pageChangeCutKey));
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'suppressedPageChangeCutKeys') &&
        (!Array.isArray(req.body.suppressedPageChangeCutKeys) || req.body.suppressedPageChangeCutKeys.some(function (key) {
          return !validPageChangeKeys.has(String(key)) && !currentSuppressedPageChangeCutKeys.includes(String(key));
        }))) {
      return res.status(400).json({ error: 'invalid_page_change', message: 'That page-turn marker is no longer on this timeline.' });
    }
    const nextSuppressedPageChangeCutKeys = Array.isArray(req.body && req.body.suppressedPageChangeCutKeys)
      ? Array.from(new Set(req.body.suppressedPageChangeCutKeys.map(String))).sort()
      : currentSuppressedPageChangeCutKeys;
    const nextManualTrimCuts = Array.isArray(req.body && req.body.manualTrimCuts)
      ? protectedManualTrimCuts(project, req.body.manualTrimCuts)
      : currentManualTrimCuts;
    const nextAutoSilenceEnabled = typeof (req.body && req.body.autoSilenceEnabled) === 'boolean' ? req.body.autoSilenceEnabled : currentAutoSilenceEnabled;
    const nextSilenceThresholdSeconds = Number.isFinite(Number(req.body && req.body.silenceThresholdSeconds)) ? clamp(req.body.silenceThresholdSeconds, 0.65, 5) : currentSilenceThresholdSeconds;
    const nextRetainedPauseSeconds = Number.isFinite(Number(req.body && req.body.retainedPauseSeconds)) ? clamp(req.body.retainedPauseSeconds, MIN_RETAINED_PAUSE_SECONDS, 1.2) : currentRetainedPauseSeconds;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'voiceGainAdjustments') && !Array.isArray(req.body.voiceGainAdjustments)) {
      return res.status(400).json({ error: 'invalid_voice_gain_adjustments', message: 'Voice gain adjustments must be a list.' });
    }
    const nextVoiceGainAdjustments = Object.prototype.hasOwnProperty.call(req.body || {}, 'voiceGainAdjustments')
      ? normalizeVoiceGainAdjustments(req.body.voiceGainAdjustments, project.duration)
      : currentVoiceGainAdjustments;
    let decisionSnapshotSaved = false;
    function saveDecisionSnapshot() {
      if (decisionSnapshotSaved) return;
      const snapshot = {
        removedWordIndices: currentRemovedWordIndices,
        dismissedRetakeIds: currentDismissedRetakeIds,
        autoRetakeRemovedWordIndices: (project.autoRetakeRemovedWordIndices || []).map(Number),
        restoredAutoCutIds: currentRestoredAutoCutIds,
        suppressedPageChangeCutKeys: currentSuppressedPageChangeCutKeys,
        manualTrimCuts: currentManualTrimCuts,
        autoSilenceEnabled: currentAutoSilenceEnabled,
        silenceThresholdSeconds: currentSilenceThresholdSeconds,
        retainedPauseSeconds: currentRetainedPauseSeconds,
        outroFadeSeconds: currentOutroFadeSeconds
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
        JSON.stringify(nextSuppressedPageChangeCutKeys) !== JSON.stringify(currentSuppressedPageChangeCutKeys) ||
        JSON.stringify(nextManualTrimCuts) !== JSON.stringify(currentManualTrimCuts) ||
        nextAutoSilenceEnabled !== currentAutoSilenceEnabled ||
        Number(nextSilenceThresholdSeconds) !== currentSilenceThresholdSeconds ||
        Number(nextRetainedPauseSeconds) !== currentRetainedPauseSeconds ||
        nextOutroFadeSeconds !== currentOutroFadeSeconds) saveDecisionSnapshot();
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
    project.suppressedPageChangeCutKeys = nextSuppressedPageChangeCutKeys;
    project.manualTrimCuts = nextManualTrimCuts;
    if (typeof (req.body && req.body.captionsEnabled) === 'boolean') project.captionsEnabled = req.body.captionsEnabled;
    if (typeof (req.body && req.body.openingPushInEnabled) === 'boolean') project.openingPushInEnabled = req.body.openingPushInEnabled;
    if (['auto', 'vertical', 'horizontal'].includes(req.body && req.body.layoutOverride)) project.layoutOverride = req.body.layoutOverride;
    if (['auto', 'ultra_short', 'short', 'long_short', 'longform'].includes(req.body && req.body.contentTypeOverride)) project.contentTypeOverride = req.body.contentTypeOverride;
    if (typeof (req.body && req.body.audioTrackId) === 'string') {
      const requestedTrackId = req.body.audioTrackId;
      const available = typeof getAudioTracks === 'function' ? (getAudioTracks() || []) : [];
      if (requestedTrackId && requestedTrackId !== '__none__' && !available.some(function (track) { return track && track.id === requestedTrackId; })) {
        return res.status(400).json({ error: 'invalid_audio_track', message: 'Choose an available backing track or No backing audio.' });
      }
      project.audioTrackId = requestedTrackId;
      if (requestedTrackId && typeof getAudioMixSettings === 'function') project.audioMixSettings = getAudioMixSettings() || {};
      if (!requestedTrackId) delete project.audioMixSettings;
    }
    project.silenceThresholdSeconds = nextSilenceThresholdSeconds;
    project.retainedPauseSeconds = nextRetainedPauseSeconds;
    project.outroFadeSeconds = nextOutroFadeSeconds;
    project.voiceGainAdjustments = nextVoiceGainAdjustments;
    project.autoCutBoundaryVersion = AUTO_CUT_BOUNDARY_VERSION;
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
    if (renderWillChange) markProjectRenderDirty(project);
    advanceEditRevision(project);
    if (mutationId) project.recentMutationIds = (Array.isArray(project.recentMutationIds) ? project.recentMutationIds : []).concat([mutationId]).slice(-100);
    if (typeof onProjectMetadataChanged === 'function') onProjectMetadataChanged({ project: project });
    saveProject(project);
    res.json(projectDetail(project));
  });

  router.post('/:id/manual-revisions', async function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    let project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (project.productionPieceId) return res.status(409).json({ error: 'approved_read_only', message: 'This approved edit is locked in Content Production.' });
    if (activeManualRevision(project)) return res.status(409).json({ error: 'manual_revision_active', message: 'A manual revision is already being applied to this recording.' });
    if (typeof queueManualRevision !== 'function') return res.status(503).json({ error: 'manual_revision_unavailable', message: 'Project Manager is not available to accept this revision right now.' });
    const request = String(req.body && req.body.request || '').trim();
    if (!request) return res.status(400).json({ error: 'request_required', message: 'Describe the change you want made.' });
    if (request.length > 4000) return res.status(400).json({ error: 'request_too_long', message: 'Keep the revision request under 4,000 characters.' });
    const now = new Date().toISOString();
    const revision = {
      id: crypto.randomUUID(), request: request, status: 'queued',
      requestedAt: now, startedAt: '', completedAt: '', voiceMessageId: '', summary: '', error: ''
    };
    project.manualRevisions = manualRevisionEntries(project).concat([revision]).slice(-50);
    saveProject(project);
    try {
      const voiceMessageId = await Promise.resolve(queueManualRevision({ project: project, revision: revision }));
      if (!voiceMessageId) throw new Error('Project Manager did not accept the revision.');
      project = getProject(project.id);
      const queued = manualRevisionEntries(project).find(function (entry) { return entry.id === revision.id; });
      if (queued) queued.voiceMessageId = String(voiceMessageId);
      saveProject(project);
      res.status(202).json(withQueuePositions(projectDetail(project)));
    } catch (error) {
      project = getProject(project.id);
      const failed = manualRevisionEntries(project).find(function (entry) { return entry.id === revision.id; });
      if (failed) {
        failed.status = 'error'; failed.completedAt = new Date().toISOString();
        failed.error = String(error.message || error).slice(0, 2000);
      }
      saveProject(project);
      res.status(502).json({ error: 'manual_revision_queue_failed', message: 'The revision could not be queued. Please try again.' });
    }
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
    if (renderJobs.has(project.id)) return res.status(409).json({ error: 'render_in_progress', message: 'Wait for this editing preview to finish before undoing the decision.' });
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
      if (Array.isArray(snapshot && snapshot.suppressedPageChangeCutKeys)) project.suppressedPageChangeCutKeys = snapshot.suppressedPageChangeCutKeys;
      if (Array.isArray(snapshot && snapshot.manualTrimCuts)) project.manualTrimCuts = snapshot.manualTrimCuts;
      if (typeof (snapshot && snapshot.autoSilenceEnabled) === 'boolean') project.autoSilenceEnabled = snapshot.autoSilenceEnabled;
      if (Number.isFinite(Number(snapshot && snapshot.silenceThresholdSeconds))) project.silenceThresholdSeconds = Number(snapshot.silenceThresholdSeconds);
      if (Number.isFinite(Number(snapshot && snapshot.retainedPauseSeconds))) project.retainedPauseSeconds = Number(snapshot.retainedPauseSeconds);
      if (Number.isFinite(Number(snapshot && snapshot.outroFadeSeconds))) project.outroFadeSeconds = Number(snapshot.outroFadeSeconds);
    }
    project.cutDecisionHistory = history;
    markProjectRenderDirty(project);
    advanceEditRevision(project);
    if (mutationId) project.recentMutationIds = (Array.isArray(project.recentMutationIds) ? project.recentMutationIds : []).concat([mutationId]).slice(-100);
    saveProject(project);
    res.json(projectDetail(project));
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
    return res.status(410).json({ error: 'retake_analysis_disabled', message: 'Retake removal is now handled manually in the transcript editor.' });
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
    prepareInsertedClip(project.id, { afterWordIndex: afterWordIndex, directiveId: String(req.body && req.body.directiveId || ''), audioOnly: req.body && req.body.audioOnly === true });
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
    if (['pending', 'running', 'pending_transcript'].includes(project.planningMatchStatus)) {
      return res.status(409).json({ error: 'automatic_edit_running', message: 'Wait for the planning check to finish.' });
    }
    const reviewFailure = blockingReviewFailure(project);
    if (reviewFailure) {
      return res.status(409).json({ error: 'automatic_review_failed', message: reviewFailure });
    }
    if (layoutReviewRequired(project)) {
      return res.status(409).json({ error: 'layout_review_required', message: 'Choose Vertical or Horizontal once to confirm this uncertain frame.' });
    }
    if (project.renderStatus === 'ready' || project.renderDirty) {
      invalidateProjectRender(project, { workflowAlreadyInvalidated: !!project.renderDirty });
      saveProject(project);
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
    if (retried.includes('render')) setImmediate(function () { renderProject(project.id); });
  });

  router.post('/:id/production', async function (req, res) {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
    let project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    // Do not trust productionPieceId as proof that the downstream record and
    // media still exist. The handoff callback is idempotent and also repairs
    // an orphaned "Sent" Editor project if its Production item was removed.
    if (project.renderDirty || project.renderStatus !== 'ready' || !fs.existsSync(renderPath(project.id))) {
      return res.status(409).json({ error: 'render_not_ready', message: 'Finish the edit before sending it to production.' });
    }
    if (!(await verifiedRenderMatches(project, renderPath(project.id)))) {
      invalidateProjectRender(project);
      saveProject(project);
      res.status(409).json({ error: 'render_verification_stale', message: 'The editing preview no longer matches its verified file. Rebuild the preview before approval.' });
      setImmediate(function () { renderProject(project.id); });
      return;
    }
    // Fingerprinting a large master is intentionally streamed and can take a
    // few seconds. Planning linkage is allowed to finish during that window,
    // so refresh metadata before handoff while requiring it still to reference
    // the exact render digest that was just verified.
    const verifiedRenderSha256 = project.renderSha256;
    project = getProject(project.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
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
      res.status(joinedExistingHandoff || result.alreadySent ? 200 : 201).json({
        ok: true, pieceId: result.pieceId, piece: result.piece || null,
        planningPiece: result.planningPiece || null,
        alreadySent: joinedExistingHandoff || !!result.alreadySent,
        workflowWarning: result.workflowWarning || ''
      });
    } catch (err) {
      res.status(422).json({ error: 'production_handoff_failed', message: String(err.message || err).slice(0, 1000) });
    } finally {
      if (productionJobs.get(project.id) === handoffJob) productionJobs.delete(project.id);
    }
  });

  router.get('/:id/source', function (req, res) {
    if (!isId(req.params.id)) return res.status(404).end();
    const project = getProject(req.params.id);
    if (!project) return res.status(404).end();
    if (project.oversizedSource && project.sourcePreparationStatus !== 'ready') {
      return res.status(project.sourcePreparationStatus === 'error' ? 422 : 425).json({
        error: project.sourcePreparationStatus === 'error' ? 'source_preparation_failed' : 'source_preparing',
        message: project.sourcePreparationStatus === 'error'
          ? (project.sourcePreparationError || 'The oversized recording could not be prepared.')
          : 'The original recording is being archived and compacted for fast editing.'
      });
    }
    if (!fs.existsSync(sourcePath(req.params.id))) return res.status(404).end();
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

  async function sendEditorAudioPreview(req, res) {
    if (!isId(req.params.id) || !isId(req.params.trackId)) return res.status(400).json({ error: 'invalid_params' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (project.renderStatus !== 'ready' || !project.renderSha256 || !fs.existsSync(renderPath(project.id))) {
      return res.status(409).json({ error: 'render_not_ready', message: 'The verified editing preview must be ready before its soundtrack previews can be mixed.' });
    }
    const renderSha256 = project.renderSha256;
    try {
      const previewPath = await editorAudioPreview(project, req.params.trackId);
      const current = getProject(project.id);
      if (!current || current.renderStatus !== 'ready' || current.renderSha256 !== renderSha256) {
        return res.status(409).json({ error: 'render_changed', message: 'The edit changed while this soundtrack preview was building.' });
      }
      res.type('audio/mpeg');
      // The browser URL includes the verified render hash, saved mix profile,
      // and track-library identity. That makes it safe to retain completed
      // previews across a page reload: any meaningful input change produces a
      // different URL rather than serving stale audio.
      res.set('Cache-Control', req.method === 'GET' && req.query.v
        ? 'private, max-age=31536000, immutable'
        : 'private, max-age=7200');
      res.sendFile(previewPath);
    } catch (error) {
      res.status(422).json({ error: 'audio_preview_failed', message: String(error.message || error).slice(0, 500) });
    }
  }

  router.get('/:id/audio-preview/:trackId', sendEditorAudioPreview);
  // Keep the original POST route temporarily for already-open tabs while the
  // frontend cache-key release propagates.
  router.post('/:id/audio-preview/:trackId', sendEditorAudioPreview);

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
    const queued = readCloudRecord(CLOUD_INTAKE_STORE, req.params.id);
    if (queued) {
      if (cloudIntakeActiveId === queued.id) return res.status(409).json({ error: 'cloud_intake_in_progress', message: 'Wait for this recording to finish entering the Editor before deleting it.' });
      delStmt.run(CLOUD_INTAKE_STORE, queued.id);
      storage.deleteKey(queued.key).catch(function (error) { console.warn('Could not remove queued R2 recording:', error.message); });
      return res.json({ ok: true });
    }
    if (sourcePreparationJobs.has(req.params.id)) return res.status(409).json({ error: 'source_preparation_in_progress', message: 'Wait for this large recording to finish archiving and compacting before deleting it.' });
    if (renderJobs.has(req.params.id)) return res.status(409).json({ error: 'render_in_progress', message: 'Wait for the editing preview to finish before deleting this recording.' });
    if (clipInsertJobs.has(req.params.id)) return res.status(409).json({ error: 'clip_insert_running', message: 'Wait for the inserted clip to finish preparing before deleting this recording.' });
    if (productionJobs.has(req.params.id)) return res.status(409).json({ error: 'approval_in_progress', message: 'Wait for this edit to finish entering Content Production before deleting it.' });
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'not_found' });
    if (project.productionPieceId) {
      return res.status(409).json({
        error: 'production_source_required',
        message: 'This source is retained until Production builds the full-resolution Final Check master.'
      });
    }
    if (typeof onProjectDeleted === 'function') {
      try { onProjectDeleted({ project: project }); }
      catch (error) { return res.status(422).json({ error: 'workflow_cleanup_failed', message: 'The linked planning card could not be reconciled, so the recording was kept safely.' }); }
    }
    if (automaticRenderTimers.has(req.params.id)) { clearTimeout(automaticRenderTimers.get(req.params.id)); automaticRenderTimers.delete(req.params.id); }
    pruneAudioPreviewCache(req.params.id);
    delStmt.run(STORE_NAME, req.params.id);
    fs.rm(projectDir(req.params.id), { recursive: true, force: true }, function () {});
    if (project.sourceStorageObjectKey && storage && storage.configured && typeof storage.deleteKey === 'function') {
      storage.deleteKey(project.sourceStorageObjectKey).catch(function (error) {
        console.error('[editor-source] could not remove R2 archive for ' + project.id + ':', error.message);
      });
    }
    res.json({ ok: true });
  });

  return {
    router: router,
    processCloudIntake: processCloudIntake,
    transcribeProject: transcribeProject,
    generateBrowserPreview: generateBrowserPreview,
    classifyProject: classifyProject,
    analyzeProjectRetakes: analyzeProjectRetakes,
    matchProjectPlanningPiece: matchProjectPlanningPiece,
    renderProject: renderProject,
    renderProductionMaster: async function (id, outputPath, onProgress, renderOptions) {
      renderOptions = renderOptions || {};
      const project = getProject(id);
      if (!project) throw new Error('The Editor project no longer exists.');
      if (!project.sourceStorageObjectKey) {
        return renderProject(id, { masterOutputPath: outputPath, onProgress: onProgress,
          includeMusicTail: renderOptions.includeMusicTail === true });
      }
      if (!storage || !storage.configured || typeof storage.readStream !== 'function') {
        throw new Error('The archived camera master is temporarily unavailable.');
      }
      const restoredSourcePath = path.join(projectDir(id), 'production-source-restored');
      await fs.promises.rm(restoredSourcePath, { force: true });
      try {
        const remote = await storage.readStream(project.sourceStorageObjectKey);
        await pipeline(remote.body, fs.createWriteStream(restoredSourcePath, { flags: 'wx' }));
        return await renderProject(id, {
          masterOutputPath: outputPath,
          sourceOverridePath: restoredSourcePath,
          onProgress: onProgress,
          includeMusicTail: renderOptions.includeMusicTail === true
        });
      } finally {
        fs.rm(restoredSourcePath, { force: true }, function () {});
      }
    },
    markManualRevisionRunningByVoiceMessage: markManualRevisionRunningByVoiceMessage,
    finishManualRevisionByVoiceMessage: finishManualRevisionByVoiceMessage
  };
}

module.exports = {
  setup,
  maxUploadBytes: MAX_UPLOAD_BYTES,
  oversizedSourceBytes: OVERSIZED_SOURCE_BYTES,
  requiredEditorCapacity,
  outstandingEditorCapacity,
  createByteReservationLedger,
  createKeyedClaimRegistry,
  createPriorityTaskQueue,
  encoderConcurrencyForCpuCount,
  renderShapeForProject,
  renderOutroTiming,
  verifiedRenderMatches,
  parseIntegratedLoudness,
  insertedClipGainDb,
  audioInterludeVideoFilter,
  normalizeWords,
  calculateAutoCuts,
  calculateManualCuts,
  normalizeManualTrimCuts,
  mergeCuts,
  pageChangeCutKey,
  pageChangeSuppressionMatches,
  confirmedPageChangeCutKeys,
  cutsForProject,
  editableTimelineCuts,
  keepSegments,
  editorTimelineSegments,
  renderCaptionGroups,
  parseInsertClipDirectives,
  clipTimestampSeconds,
  segmentAudioFades,
  pageChangeFadeSeconds: PAGE_CHANGE_FADE_SECONDS,
  pageChangeFadesForSegment,
  mapSourceTimeToEdited,
  cameraResetStarts,
  cameraMotionState,
  cameraMotionForSegment,
  cameraMotionTargetScale,
  visualPageChangeFromSsim,
  detectVisualPageChangeCutIds,
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
  transcriptParagraphStartIndices,
  retakeMarkerDecisions,
  repeatedLineEvidence,
  retakeCandidatesForProject,
  retakeHighlightsForProject,
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
  cameraMotionPreparationFilter,
  normalizeVoiceGainAdjustments,
  voiceGainFilter,
  reconcileAutomaticRetakeCuts,
  projectListSummary,
  editorWorkStarted
};
