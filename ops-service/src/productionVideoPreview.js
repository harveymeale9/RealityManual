'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// This is only the Production audition picture. The Editor render or original
// upload remains the source for thumbnails and the publish master.
function ffmpegArgs(source, output) {
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', source,
    '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
    '-vf', 'scale=640:360:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=15',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '36', '-pix_fmt', 'yuv420p',
    '-g', '15', '-threads', '1',
    '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-ar', '24000',
    '-movflags', '+faststart', '-f', 'mp4', output
  ];
}

function frameJpeg(source, seconds) {
  return new Promise(function (resolve, reject) {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin',
      '-ss', Math.max(0, Number(seconds) || 0).toFixed(3), '-i', source,
      '-frames:v', '1', '-vf', "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      '-q:v', '3', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
    const timeout = setTimeout(function () { child.kill(); }, 30000);
    const chunks = [];
    let size = 0;
    let details = '';
    child.stdout.on('data', function (chunk) {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) child.kill();
      else chunks.push(chunk);
    });
    child.stderr.on('data', function (chunk) { details = (details + chunk.toString()).slice(-500); });
    child.on('error', reject);
    child.on('close', function (code) {
      clearTimeout(timeout);
      if (code === 0 && size > 100 && size <= 8 * 1024 * 1024) resolve(Buffer.concat(chunks));
      else reject(new Error('Could not capture the source frame: ' + details.trim()));
    });
  });
}

function setup(options) {
  const rootDir = options.rootDir;
  const getVideoPath = options.getVideoPath;
  const run = options.run || function (source, output) {
    return new Promise(function (resolve, reject) {
      const child = spawn('ffmpeg', ffmpegArgs(source, output), { stdio: ['ignore', 'ignore', 'pipe'] });
      let details = '';
      child.stderr.on('data', function (chunk) { details = (details + chunk.toString()).slice(-1000); });
      child.on('error', reject);
      child.on('close', function (code) {
        if (code === 0) resolve();
        else reject(new Error('Production review encode failed (' + code + '): ' + details.trim()));
      });
    });
  };
  const jobs = new Map();
  const errors = new Map();
  fs.mkdirSync(rootDir, { recursive: true });

  function identity(id) {
    const source = getVideoPath(id);
    if (!source || !fs.existsSync(source)) return null;
    const stat = fs.statSync(source);
    const version = crypto.createHash('sha256')
      .update(JSON.stringify([source, stat.size, stat.mtimeMs, '360p-v1']))
      .digest('hex').slice(0, 20);
    return { source: source, stat: stat, version: version,
      dir: path.join(rootDir, id), path: path.join(rootDir, id, version + '.mp4') };
  }

  function readyPath(id) {
    const item = identity(id);
    if (!item) return '';
    try { return fs.statSync(item.path).size > 1024 ? item.path : ''; }
    catch (error) { return ''; }
  }

  function start(id) {
    const item = identity(id);
    if (!item) return { status: 'missing' };
    if (readyPath(id)) return { status: 'ready', version: item.version };
    if (jobs.has(item.path)) return { status: 'preparing' };
    if (errors.has(item.path)) return { status: 'error', message: errors.get(item.path) };
    fs.mkdirSync(item.dir, { recursive: true });
    const temp = item.path + '.' + crypto.randomUUID() + '.tmp.mp4';
    const job = Promise.resolve().then(function () { return run(item.source, temp); }).then(function () {
      const current = fs.statSync(item.source);
      if (current.size !== item.stat.size || current.mtimeMs !== item.stat.mtimeMs) {
        throw new Error('The source video changed while its Production preview was being made.');
      }
      if (fs.statSync(temp).size <= 1024) throw new Error('The Production preview was empty.');
      fs.renameSync(temp, item.path);
      errors.delete(item.path);
      for (const name of fs.readdirSync(item.dir)) {
        if (name.endsWith('.mp4') && name !== path.basename(item.path)) {
          fs.rm(path.join(item.dir, name), { force: true }, function () {});
        }
      }
    }).catch(function (error) {
      errors.set(item.path, String(error.message || error).slice(0, 300));
    }).finally(function () {
      fs.rm(temp, { force: true }, function () {});
      jobs.delete(item.path);
    });
    jobs.set(item.path, job);
    return { status: 'preparing' };
  }

  function retry(id) {
    const item = identity(id);
    if (item) errors.delete(item.path);
    return start(id);
  }

  function prune(activePieceIds) {
    const active = new Set(activePieceIds || []);
    for (const name of fs.readdirSync(rootDir)) {
      if (!active.has(name)) fs.rmSync(path.join(rootDir, name), { recursive: true, force: true });
    }
  }

  return { start: start, retry: retry, readyPath: readyPath, prune: prune, jobs: jobs };
}

module.exports = { setup: setup, ffmpegArgs: ffmpegArgs, frameJpeg: frameJpeg };
