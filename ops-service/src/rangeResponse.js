'use strict';

const fs = require('fs');

function parseByteRange(header, size) {
  const total = Math.max(0, Number(size) || 0);
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match || (!match[1] && !match[2]) || !total) return { invalid: true };
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return { invalid: true };
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : total - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return { invalid: true };
    end = Math.min(end, total - 1);
  }
  if (start < 0 || start >= total || end < start) return { invalid: true };
  return { start: start, end: end };
}

function sendFile(req, res, filePath, contentType) {
  const stat = fs.statSync(filePath);
  const size = stat.size;
  const range = parseByteRange(req.headers.range, size);
  res.setHeader('Content-Type', contentType || 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  if (range && range.invalid) {
    res.status(416).setHeader('Content-Range', 'bytes */' + size);
    return res.end();
  }
  if (range) {
    res.status(206);
    res.setHeader('Content-Range', 'bytes ' + range.start + '-' + range.end + '/' + size);
    res.setHeader('Content-Length', range.end - range.start + 1);
    return fs.createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
  }
  res.setHeader('Content-Length', size);
  return fs.createReadStream(filePath).pipe(res);
}

module.exports = { parseByteRange, sendFile };
