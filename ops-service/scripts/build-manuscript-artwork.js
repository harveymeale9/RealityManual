#!/usr/bin/env node
'use strict';

// Converts the flattened print-ready interior into small WebP pages plus a
// positioned OCR layer. The generated assets deliberately live in /data and
// never in Git; the checked-in script is the reproducible source of truth.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const source = path.resolve(process.argv[2] || '/data/manuscript-source/interior_printready2.pdf');
const output = path.resolve(process.argv[3] || '/data/manuscript-pages');
const firstPdfPage = Number(process.env.MANUSCRIPT_FIRST_PDF_PAGE || 4);
const pageCount = Number(process.env.MANUSCRIPT_PAGE_COUNT || 180);
const dpi = Number(process.env.MANUSCRIPT_RENDER_DPI || 200);
const quality = Number(process.env.MANUSCRIPT_WEBP_QUALITY || 72);
const workers = Math.max(1, Math.min(Number(process.env.MANUSCRIPT_WORKERS || 3), 8));
const resumeOcrDir = process.env.MANUSCRIPT_RESUME_OCR_DIR ? path.resolve(process.env.MANUSCRIPT_RESUME_OCR_DIR) : null;

function fail(message) { console.error(message); process.exit(1); }
function command(name, args, options) {
  const result = spawnSync(name, args, Object.assign({ stdio: 'inherit' }, options || {}));
  if (result.status !== 0) fail(name + ' failed with exit code ' + result.status);
  return result;
}
function decode(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(parseInt(number, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function parseHocr(file, page) {
  const sourceText = fs.readFileSync(file, 'utf8');
  const pageMatch = sourceText.match(/class=['"]ocr_page['"][^>]*bbox\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/i);
  if (!pageMatch) throw new Error('OCR page geometry missing for page ' + page);
  const width = Number(pageMatch[3]);
  const height = Number(pageMatch[4]);
  const words = [];
  const pattern = /<span class=['"]ocrx_word['"]([^>]*)>([\s\S]*?)<\/span>/gi;
  let match;
  while ((match = pattern.exec(sourceText))) {
    const box = match[1].match(/bbox\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+);\s*x_wconf\s+(\d+)/i);
    if (!box) continue;
    const text = decode(match[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const confidence = Number(box[5]);
    // The parchment frame can look like stray glyphs. Low-confidence words
    // outside the page's real content region are noise, not selectable text.
    const x = Number(box[1]), y = Number(box[2]), right = Number(box[3]), bottom = Number(box[4]);
    if (confidence < 35 && (x < width * 0.09 || right > width * 0.91)) continue;
    words.push([text, x, y, right - x, bottom - y, confidence]);
  }
  return { page, width, height, words };
}
function pageName(page, extension) { return String(page).padStart(3, '0') + '.' + extension; }
function sourceDigest() {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(source, 'r');
  const buffer = Buffer.allocUnsafe(4 * 1024 * 1024);
  let read;
  while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
  fs.closeSync(fd);
  return hash.digest('hex');
}

if (!fs.existsSync(source)) fail('Source PDF does not exist: ' + source);
for (const dependency of ['pdftoppm', 'cwebp', 'tesseract']) {
  const found = spawnSync('sh', ['-c', 'command -v ' + dependency], { stdio: 'ignore' });
  if (found.status !== 0) fail('Required command is missing: ' + dependency);
}
fs.mkdirSync(path.join(output, 'pages'), { recursive: true });
fs.mkdirSync(path.join(output, 'text'), { recursive: true });
const temporary = resumeOcrDir || fs.mkdtempSync(path.join(os.tmpdir(), 'rm-manuscript-'));
const queue = Array.from({ length: pageCount }, (_, index) => index + 1);

if (!resumeOcrDir) {
  console.log('Rendering ' + pageCount + ' manuscript pages at ' + dpi + ' DPI in one PDF pass...');
  command('pdftoppm', [
    '-f', String(firstPdfPage), '-l', String(firstPdfPage + pageCount - 1),
    '-jpeg', '-r', String(dpi), '-jpegopt', 'quality=95,progressive=n,optimize=y',
    source, path.join(temporary, 'source')
  ]);
  console.log('Compressing and OCRing with ' + workers + ' workers...');
} else {
  console.log('Resuming coordinate compaction from ' + temporary);
}
const workerScript = `
  const { spawnSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  const cfg = JSON.parse(process.argv[1]);
  const pages = JSON.parse(process.argv[2]);
  for (const page of pages) {
    const pdfPage = cfg.firstPdfPage + page - 1;
    const stem = path.join(cfg.temporary, String(page).padStart(3, '0'));
    const jpeg = path.join(cfg.temporary, 'source-' + String(pdfPage).padStart(3, '0') + '.jpg');
    const webp = path.join(cfg.output, 'pages', String(page).padStart(3, '0') + '.webp');
    let run = spawnSync('cwebp', ['-quiet', '-q', String(cfg.quality), '-m', '6', '-sharp_yuv', '-metadata', 'none', jpeg, '-o', webp], { stdio: 'ignore' });
    if (run.status !== 0) process.exit(run.status || 1);
    run = spawnSync('tesseract', [jpeg, stem, '-l', 'eng', 'hocr'], { stdio: 'ignore' });
    if (run.status !== 0) process.exit(run.status || 1);
    fs.unlinkSync(jpeg);
    process.stdout.write(String(page) + '\\n');
  }
`;
const groups = Array.from({ length: workers }, () => []);
queue.forEach((page, index) => groups[index % workers].push(page));
const config = JSON.stringify({ source, output, temporary, firstPdfPage, dpi, quality });
const children = resumeOcrDir ? [] : groups.filter(group => group.length).map(group => require('child_process').spawn(process.execPath, ['-e', workerScript, config, JSON.stringify(group)], { stdio: ['ignore', 'pipe', 'inherit'] }));
let completed = 0;
Promise.all(children.map(child => new Promise((resolve, reject) => {
  child.stdout.on('data', chunk => {
    completed += String(chunk).trim().split(/\s+/).filter(Boolean).length;
    process.stdout.write('\rRendered and OCRed ' + Math.min(completed, pageCount) + '/' + pageCount);
  });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error('render worker exited ' + code)));
}))).then(() => {
  process.stdout.write('\nCompacting OCR coordinates...\n');
  let wordCount = 0;
  for (let page = 1; page <= pageCount; page++) {
    const hocr = path.join(temporary, pageName(page, 'hocr'));
    const parsed = parseHocr(hocr, page);
    wordCount += parsed.words.length;
    fs.writeFileSync(path.join(output, 'text', pageName(page, 'json')), JSON.stringify(parsed));
    fs.unlinkSync(hocr);
  }
  fs.rmdirSync(temporary);
  const images = fs.readdirSync(path.join(output, 'pages')).filter(file => file.endsWith('.webp'));
  const imageBytes = images.reduce((sum, file) => sum + fs.statSync(path.join(output, 'pages', file)).size, 0);
  const textFiles = fs.readdirSync(path.join(output, 'text')).filter(file => file.endsWith('.json'));
  const textBytes = textFiles.reduce((sum, file) => sum + fs.statSync(path.join(output, 'text', file)).size, 0);
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: path.basename(source),
    sourceSha256: sourceDigest(),
    pdfPageCount: 187,
    firstPdfPage,
    pageCount,
    dpi,
    quality,
    format: 'webp',
    imageBytes,
    textBytes,
    wordCount
  };
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(manifest, null, 2));
}).catch(error => {
  console.error('\n' + error.stack);
  process.exitCode = 1;
});
