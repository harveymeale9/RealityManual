'use strict';

const fs = require('fs');
const path = require('path');

function manuscriptPath() {
  const repo = process.env.CLAUDE_REPO_DIR || path.resolve(__dirname, '..', '..');
  return path.join(repo, 'THE_REALITY_MANUAL_COMPLETE_MANUSCRIPT.txt');
}

let cached = null;
function loadManuscript() {
  const file = manuscriptPath();
  const stat = fs.statSync(file);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached;
  const text = fs.readFileSync(file, 'utf8');
  const pages = [];
  const re = /==PAGE\s+(\d+)==/g;
  let match;
  const markers = [];
  while ((match = re.exec(text))) markers.push({ page: Number(match[1]), start: re.lastIndex });
  markers.forEach(function (marker, i) {
    pages.push({ page: marker.page, text: text.slice(marker.start, markers[i + 1] ? markers[i + 1].start - String('==PAGE ' + markers[i + 1].page + '==').length : text.length).trim() });
  });
  cached = { file: file, text: text, pages: pages, mtimeMs: stat.mtimeMs };
  return cached;
}

function normalize(value) {
  return String(value || '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
}

function verifyQuote(value) {
  const quote = String(value || '').trim();
  if (!quote) return null;
  const needle = normalize(quote);
  if (needle.length < 8) return null;
  const manuscript = loadManuscript();
  for (let i = 0; i < manuscript.pages.length; i++) {
    if (normalize(manuscript.pages[i].text).indexOf(needle) !== -1) {
      return { text: quote, page: manuscript.pages[i].page, verified: true };
    }
  }
  return null;
}

function verifyQuotes(values) {
  return (Array.isArray(values) ? values : []).map(function (q) {
    return verifyQuote(typeof q === 'string' ? q : q && q.text);
  }).filter(Boolean);
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/li>|<\/h\d>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim();
}

function wordCount(value) {
  const words = String(value || '').trim().match(/\b[\w’'-]+\b/g);
  return words ? words.length : 0;
}

function estimateRuntime(script, contentType) {
  const words = wordCount(script);
  const stageDirections = (String(script || '').match(/(^|\n)\s*(\[[^\]]+\]|(?:OPEN|SHOW|READ|POINT|TRACE|PAUSE|TURN)\b)/gim) || []).length;
  const seconds = Math.max(8, Math.round(words / 145 * 60 + stageDirections * 2.5));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return {
    words: words,
    seconds: seconds,
    label: mins ? mins + ':' + String(secs).padStart(2, '0') : secs + ' sec',
    contentType: contentType
  };
}

function tokens(value) {
  const stop = new Set(['the','a','an','and','or','to','of','in','on','for','is','it','that','this','with','your','you','why','how','what']);
  return new Set(normalize(value).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function (x) { return x.length > 2 && !stop.has(x); }));
}

function similarity(a, b) {
  const aa = tokens(a), bb = tokens(b);
  if (!aa.size || !bb.size) return 0;
  let shared = 0;
  aa.forEach(function (x) { if (bb.has(x)) shared++; });
  return shared / Math.max(aa.size, bb.size);
}

module.exports = { loadManuscript, verifyQuotes, stripHtml, estimateRuntime, similarity, normalize, wordCount };
