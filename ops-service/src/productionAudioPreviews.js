'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function createQueue(concurrency) {
  const waiting = [];
  let active = 0;
  function drain() {
    while (active < concurrency && waiting.length) {
      const item = waiting.shift();
      active++;
      Promise.resolve().then(item.task).then(item.resolve, item.reject).finally(function () {
        active--;
        drain();
      });
    }
  }
  return function enqueue(task) {
    return new Promise(function (resolve, reject) {
      waiting.push({ task: task, resolve: resolve, reject: reject });
      drain();
    });
  };
}

function setup(options) {
  options = options || {};
  const rootDir = options.rootDir;
  const getVideoPath = options.getVideoPath;
  const getAudioTrackPath = options.getAudioTrackPath;
  const getAudioTracks = options.getAudioTracks;
  const getMixSettings = options.getMixSettings;
  const buildAudioPreview = options.buildAudioPreview;
  const enqueue = createQueue(Math.max(1, Math.min(4, Number(options.concurrency) || 2)));
  const jobs = new Map();
  fs.mkdirSync(rootDir, { recursive: true });

  function previewIdentity(pieceId, trackId) {
    const videoPath = getVideoPath(pieceId);
    const audioPath = getAudioTrackPath(trackId);
    if (!videoPath || !fs.existsSync(videoPath)) throw new Error('video_not_found');
    if (!audioPath || !fs.existsSync(audioPath)) throw new Error('invalid_audio_track');
    const video = fs.statSync(videoPath);
    const audio = fs.statSync(audioPath);
    const settings = getMixSettings() || {};
    const hash = crypto.createHash('sha256').update(JSON.stringify({
      video: [video.size, video.mtimeMs], audio: [audio.size, audio.mtimeMs], settings: settings
    })).digest('hex').slice(0, 24);
    const dir = path.join(rootDir, pieceId);
    return { videoPath: videoPath, audioPath: audioPath, settings: settings, dir: dir,
      path: path.join(dir, trackId + '-' + hash + '.mp3'), hash: hash };
  }

  function ensure(pieceId, trackId) {
    const identity = previewIdentity(pieceId, trackId);
    try { if (fs.statSync(identity.path).size > 1024) return Promise.resolve(identity.path); } catch (error) {}
    if (jobs.has(identity.path)) return jobs.get(identity.path);
    const job = enqueue(async function () {
      fs.mkdirSync(identity.dir, { recursive: true });
      const tempPath = identity.path + '.tmp-' + crypto.randomUUID();
      try {
        await buildAudioPreview(identity.videoPath, identity.audioPath, tempPath, identity.settings, { bitrate: '192k' });
        if (fs.statSync(tempPath).size <= 1024) throw new Error('The backing-audio preview was empty.');
        await fs.promises.rename(tempPath, identity.path);
        const prefix = trackId + '-';
        for (const name of fs.readdirSync(identity.dir)) {
          if (name.startsWith(prefix) && name.endsWith('.mp3') && name !== path.basename(identity.path)) {
            fs.rmSync(path.join(identity.dir, name), { force: true });
          }
        }
        return identity.path;
      } finally {
        fs.rm(tempPath, { force: true }, function () {});
      }
    }).finally(function () { jobs.delete(identity.path); });
    jobs.set(identity.path, job);
    return job;
  }

  function warm(pieceId) {
    const tracks = (getAudioTracks() || []).filter(function (track) { return track && track.id; });
    return Promise.allSettled(tracks.map(function (track) {
      return Promise.resolve().then(function () { return ensure(pieceId, track.id); });
    }));
  }

  function prune(activePieceIds) {
    const active = new Set(activePieceIds || []);
    if (!fs.existsSync(rootDir)) return;
    for (const name of fs.readdirSync(rootDir)) {
      const target = path.join(rootDir, name);
      if (!active.has(name)) fs.rmSync(target, { recursive: true, force: true });
    }
  }

  return { ensure: ensure, warm: warm, prune: prune, previewIdentity: previewIdentity };
}

module.exports = { setup: setup, createQueue: createQueue };
