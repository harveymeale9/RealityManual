'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

// This is only a lightweight viewing copy. Publishing always uses <id>-final.
// Copying the AAC stream means the audio Harvey checks is bit-for-bit the
// mastered audio in that publish file, even though the picture is 720p.
function ffmpegArgs(source, output, picture) {
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', picture || source,
    ...(picture ? ['-i', source] : []),
    '-map', '0:v:0', '-map', picture ? '1:a:0?' : '0:a:0?', '-sn', '-dn',
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '29', '-pix_fmt', 'yuv420p',
    '-threads', '2', '-c:a', 'copy', '-movflags', '+faststart', output
  ];
}

function matchingPicture(source, picture) {
  if (!picture || !fs.existsSync(picture)) return '';
  try {
    function probe(file) {
      const result = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=duration,width,height', '-of', 'json', file], { timeout: 10000 }));
      return result.streams && result.streams[0];
    }
    const master = probe(source);
    const small = probe(picture);
    if (!master || !small || !Number.isFinite(Number(master.duration)) || !Number.isFinite(Number(small.duration))) return '';
    if (Math.abs(Number(master.duration) - Number(small.duration)) > 0.1) return '';
    if (Number(small.width) > 1280 || Number(small.height) > 720) return '';
    return picture;
  } catch (error) { return ''; }
}

function fresh(source, output) {
  try {
    const original = fs.statSync(source);
    const preview = fs.statSync(output);
    return preview.size > 1024 && preview.mtimeMs >= original.mtimeMs;
  } catch (error) { return false; }
}

function setup(options) {
  const run = options && options.run || function (source, output, picture) {
    return new Promise(function (resolve, reject) {
      const child = spawn('ffmpeg', ffmpegArgs(source, output, picture), { stdio: ['ignore', 'ignore', 'pipe'] });
      let errorText = '';
      child.stderr.on('data', function (chunk) { errorText = (errorText + chunk.toString()).slice(-1000); });
      child.on('error', reject);
      child.on('close', function (code) {
        if (code === 0) resolve();
        else reject(new Error('720p review encode failed (' + code + '): ' + errorText.trim()));
      });
    });
  };
  const jobs = new Map();
  const errors = new Map();

  function start(id, source, output, picture) {
    if (fresh(source, output)) return { status: 'ready' };
    if (jobs.has(id)) return { status: 'preparing' };
    if (errors.has(id)) return { status: 'error', message: errors.get(id) };
    if (!fs.existsSync(source)) return { status: 'missing' };
    const sourceStat = fs.statSync(source);
    const temp = path.join(path.dirname(output), path.basename(output) + '.' + crypto.randomUUID() + '.tmp.mp4');
    const reviewPicture = matchingPicture(source, picture);
    const job = Promise.resolve().then(function () { return run(source, temp, reviewPicture); }).then(function () {
      const current = fs.statSync(source);
      if (current.size !== sourceStat.size || current.mtimeMs !== sourceStat.mtimeMs) {
        throw new Error('The publish master changed while its review copy was being made.');
      }
      if (fs.statSync(temp).size <= 1024) throw new Error('The 720p review copy was empty.');
      fs.renameSync(temp, output);
      errors.delete(id);
    }).catch(function (error) {
      errors.set(id, String(error.message || error).slice(0, 300));
    }).finally(function () {
      fs.rm(temp, { force: true }, function () {});
      jobs.delete(id);
    });
    jobs.set(id, job);
    return { status: 'preparing' };
  }

  function retry(id, source, output, picture) {
    errors.delete(id);
    return start(id, source, output, picture);
  }

  return { start: start, retry: retry, fresh: fresh, jobs: jobs };
}

module.exports = { setup: setup, ffmpegArgs: ffmpegArgs, fresh: fresh, matchingPicture: matchingPicture };
