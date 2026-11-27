'use strict';

const fs = require('fs');
const { execFileSync, spawn } = require('child_process');

// A failed multi-gigabyte transfer must not endlessly resend the same bytes.
// Keep YouTube's reviewed master untouched; only a Facebook retry uses this copy.
const COMPACT_FROM_BYTES = 1.5 * 1024 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1.4 * 1024 * 1024 * 1024;

function needsCompactCopy(sizeBytes, piece, retryFailed) {
  if (!retryFailed || Number(sizeBytes) <= COMPACT_FROM_BYTES || !piece) return false;
  return /Meta code 6000/.test(String(piece.facebookPublishError || '')) ||
    Number(piece.facebookUploadBytesTransferred || 0) >= COMPACT_FROM_BYTES;
}

function probe(file) {
  const result = JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height',
    '-of', 'json', file
  ], { timeout: 30000, maxBuffer: 100000 }).toString());
  const video = (result.streams || []).find(function (stream) { return stream.codec_type === 'video'; });
  const audio = (result.streams || []).find(function (stream) { return stream.codec_type === 'audio'; });
  const duration = Number(result.format && result.format.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0 || !video.width || !video.height) {
    throw new Error('Facebook compact copy needs a readable video and duration.');
  }
  return { duration: duration, width: Number(video.width), height: Number(video.height),
    codec: video.codec_name, audioCodec: audio && audio.codec_name || '' };
}

function assertFullHd(metadata) {
  if (Math.min(Number(metadata && metadata.width) || 0, Number(metadata && metadata.height) || 0) < 1080) {
    throw new Error('Facebook upload paused: source is below 1080p; use a full-resolution master.');
  }
}

function transcodeArgs(source, output, metadata) {
  const landscape = metadata.width >= metadata.height;
  const scale = Math.min(1, (landscape ? 1920 : 1080) / metadata.width,
    (landscape ? 1080 : 1920) / metadata.height);
  const width = Math.max(2, Math.floor(metadata.width * scale / 2) * 2);
  const height = Math.max(2, Math.floor(metadata.height * scale / 2) * 2);
  // Keep the entire rendition below 1.4 GiB, with headroom for AAC and MP4
  // overhead. A maxrate cap prevents a variable-complexity scene exceeding it.
  const bitrate = Math.min(6500, Math.floor((MAX_OUTPUT_BYTES * 8 / metadata.duration - 400000) / 1000));
  if (bitrate < 1200) throw new Error('Video is too long for a safe Facebook compact rendition.');
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', source,
    '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-vf', 'scale=' + width + ':' + height,
    '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', bitrate + 'k',
    '-maxrate', bitrate + 'k', '-bufsize', (bitrate * 2) + 'k', '-pix_fmt', 'yuv420p',
    '-threads', '2', '-c:a', metadata.audioCodec === 'aac' ? 'copy' : 'aac',
    '-movflags', '+faststart', output];
}

async function makeCompactCopy(source, output, options) {
  options = options || {};
  const sourceInfo = (options.probe || probe)(source);
  const args = transcodeArgs(source, output, sourceInfo);
  const run = options.run || function () {
    return new Promise(function (resolve, reject) {
      let message = '';
      const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      child.stderr.on('data', function (chunk) { message = (message + chunk.toString()).slice(-4000); });
      child.on('error', reject);
      child.on('close', function (code) {
        if (code === 0) resolve();
        else reject(new Error('Facebook compact transcode failed (' + code + '): ' + message.slice(-500)));
      });
    });
  };
  try {
    await run(args);
    const size = fs.statSync(output).size;
    const result = (options.probe || probe)(output);
    if (size <= 0 || size > MAX_OUTPUT_BYTES || Math.abs(result.duration - sourceInfo.duration) > 2 ||
        result.codec !== 'h264') throw new Error('Facebook compact copy failed size, duration or codec verification.');
    return { path: output, sizeBytes: size, durationSeconds: result.duration };
  } catch (error) {
    fs.rmSync(output, { force: true });
    throw error;
  }
}

module.exports = { needsCompactCopy, probe, assertFullHd, transcodeArgs, makeCompactCopy, MAX_OUTPUT_BYTES };
