'use strict';

const crypto = require('crypto');
const express = require('express');
const {
  S3Client, CreateMultipartUploadCommand, UploadPartCommand,
  CompleteMultipartUploadCommand, AbortMultipartUploadCommand,
  HeadObjectCommand, GetObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const MAX_VIDEO_BYTES = 3 * 1024 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const PART_BYTES = 16 * 1024 * 1024;
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v']);
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);
const ID_PATTERN = /^[0-9a-f-]{36}$/i;

function clean(value, max) { return String(value == null ? '' : value).trim().slice(0, max); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function parse(row) { return row ? JSON.parse(row.data) : null; }
function publicFile(file) { return { id: file.id, name: file.name, type: file.type, size: file.size, kind: file.kind }; }

function validateSubmission(body) {
  const kind = body && body.kind;
  const name = clean(body && body.name, 120);
  const email = clean(body && body.email, 254).toLowerCase();
  const message = clean(body && body.message, 5000);
  const paidVideo = body && body.paidVideo === true;
  const files = body && body.files;
  if (!['feedback', 'review'].includes(kind) || name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || message.length < 5)
    return { error: 'Please add your name, a valid email and a message of at least five characters.' };
  if (!Array.isArray(files) || files.length > 3) return { error: 'Choose at most three images/videos.' };
  const checked = [];
  let videoCount = 0;
  for (const file of files) {
    const type = clean(file && file.type, 100).toLowerCase();
    const size = Number(file && file.size);
    const fileKind = VIDEO_TYPES.has(type) ? 'video' : IMAGE_TYPES.has(type) ? 'image' : '';
    if (!fileKind || !Number.isSafeInteger(size) || size <= 0 || size > (fileKind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES))
      return { error: 'Use MP4, MOV, WebM, JPG, PNG, WebP or HEIC; videos must be 3 GB or less and images 20 MB or less.' };
    if (fileKind === 'video' && ++videoCount > 1) return { error: 'Please choose at most one video.' };
    checked.push({ id: crypto.randomUUID(), name: clean(file.name, 180) || 'upload', type, size, kind: fileKind,
      key: '', uploadId: '', parts: Math.ceil(size / PART_BYTES), status: 'pending' });
  }
  if (paidVideo && (kind !== 'review' || videoCount !== 1)) return { error: 'A paid video review needs one video attachment.' };
  if (kind === 'review' && body.consent !== true) return { error: 'Please accept the review-use terms before submitting.' };
  if (body && clean(body.website, 200)) return { error: 'Submission not accepted.' }; // honeypot
  return { kind, name, email, message, paidVideo, files: checked, consent: kind === 'review' };
}

function setup(db, options) {
  options = options || {};
  const bucket = options.bucket || '';
  const client = options.client || (options.endpoint && bucket && options.accessKeyId && options.secretAccessKey
    ? new S3Client({ region: 'auto', endpoint: options.endpoint, credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey } }) : null);
  const sign = options.sign || getSignedUrl;
  const sendNotice = options.sendNotice || (async function () {});
  const allowedOrigins = options.allowedOrigins || ['https://realitymanual.com', 'https://www.realitymanual.com'];
  db.exec(`CREATE TABLE IF NOT EXISTS customer_submissions (
    id TEXT PRIMARY KEY, data TEXT NOT NULL, token_hash TEXT NOT NULL,
    ip_hash TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, submitted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_customer_submissions_date ON customer_submissions(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_customer_submissions_ip ON customer_submissions(ip_hash,created_at);`);
  const get = db.prepare('SELECT * FROM customer_submissions WHERE id=?');
  const save = db.prepare('UPDATE customer_submissions SET data=?,status=?,submitted_at=? WHERE id=?');
  const insert = db.prepare('INSERT INTO customer_submissions(id,data,token_hash,ip_hash,status,created_at) VALUES(?,?,?,?,?,?)');
  const countRecent = db.prepare('SELECT count(*) AS n FROM customer_submissions WHERE ip_hash=? AND created_at>?');
  const list = db.prepare("SELECT data FROM customer_submissions WHERE status='complete' ORDER BY submitted_at DESC LIMIT 100");
  const abandoned = db.prepare("SELECT data FROM customer_submissions WHERE status='draft' AND created_at<? LIMIT 20");
  const publicRouter = express.Router();
  const adminRouter = express.Router();

  function originAllowed(req, res, next) {
    if (!allowedOrigins.includes(req.get('origin'))) return res.status(403).json({ error: 'origin_not_allowed' });
    if (!client) return res.status(503).json({ error: 'upload_unavailable' });
    next();
  }
  function owned(req, res) {
    if (!ID_PATTERN.test(req.params.id || '')) { res.status(404).json({ error: 'not_found' }); return null; }
    const row = get.get(req.params.id);
    const token = clean(req.body && req.body.token, 100);
    if (!row || !token || hash(token) !== row.token_hash) { res.status(404).json({ error: 'not_found' }); return null; }
    const data = parse(row);
    if (Date.now() - Date.parse(data.createdAt) > 24 * 60 * 60 * 1000 && data.status !== 'complete') {
      res.status(410).json({ error: 'upload_expired' }); return null;
    }
    return data;
  }
  function persist(data) { save.run(JSON.stringify(data), data.status, data.submittedAt || null, data.id); }
  async function expireAbandoned() {
    if (!client) return;
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    for (const row of abandoned.all(cutoff)) {
      const data = parse(row);
      let allAborted = true;
      for (const file of data.files.filter(item => item.status === 'pending' && item.uploadId)) {
        try {
          await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: file.key, UploadId: file.uploadId }));
          file.status = 'aborted'; delete file.uploadId; persist(data);
        }
        catch (error) { allAborted = false; console.error('Abandoned reader upload cleanup failed:', data.id, error.message); }
      }
      if (allAborted) { data.status = 'expired'; persist(data); }
    }
  }
  if (options.cleanup !== false) {
    setTimeout(() => expireAbandoned().catch(() => {}), 5000).unref();
    setInterval(() => expireAbandoned().catch(() => {}), 60 * 60 * 1000).unref();
  }
  publicRouter.post('/start', originAllowed, async function (req, res) {
    const input = validateSubmission(req.body);
    if (input.error) return res.status(400).json({ error: 'invalid_submission', message: input.error });
    const ipHash = hash(req.ip || 'unknown');
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    if (countRecent.get(ipHash, since).n >= 4) return res.status(429).json({ error: 'rate_limited', message: 'Too many recent submissions. Please try again tomorrow.' });
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('hex');
    const data = { id, kind: input.kind, name: input.name, email: input.email, message: input.message,
      paidVideo: input.paidVideo, consent: input.consent, consentVersion: '2026-11-21',
      createdAt: new Date().toISOString(), status: 'draft', files: input.files };
    try {
      for (const file of data.files) {
        file.key = `customer-submissions/${id}/${file.id}`;
        const result = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: file.key,
          ContentType: file.type, Metadata: { submissionid: id } }));
        if (!result.UploadId) throw new Error('R2 did not start the upload.');
        file.uploadId = result.UploadId;
      }
      insert.run(id, JSON.stringify(data), hash(token), ipHash, 'draft', data.createdAt);
      res.status(201).json({ id, token, partBytes: PART_BYTES, files: data.files.map(publicFile) });
    } catch (error) {
      await Promise.all(data.files.filter(file => file.uploadId).map(file => client.send(new AbortMultipartUploadCommand({
        Bucket: bucket, Key: file.key, UploadId: file.uploadId
      })).catch(() => {})));
      res.status(503).json({ error: 'upload_unavailable', message: 'We could not prepare your upload. Please try again.' });
    }
  });
  publicRouter.post('/:id/part', originAllowed, async function (req, res) {
    const data = owned(req, res); if (!data) return;
    if (data.status !== 'draft') return res.status(409).json({ error: 'already_submitted' });
    const file = data.files.find(item => item.id === (req.body && req.body.fileId));
    const number = Number(req.body && req.body.partNumber);
    if (!file || file.status !== 'pending' || !Number.isInteger(number) || number < 1 || number > file.parts)
      return res.status(400).json({ error: 'invalid_part' });
    try {
      const url = await sign(client, new UploadPartCommand({ Bucket: bucket, Key: file.key,
        UploadId: file.uploadId, PartNumber: number }), { expiresIn: 900 });
      res.json({ url, partNumber: number });
    } catch (error) { res.status(503).json({ error: 'upload_unavailable' }); }
  });
  publicRouter.post('/:id/complete', originAllowed, async function (req, res) {
    const data = owned(req, res); if (!data) return;
    if (data.status === 'complete') return res.json({ ok: true, id: data.id });
    const uploaded = req.body && req.body.files;
    if (!Array.isArray(uploaded) || uploaded.length !== data.files.length) return res.status(400).json({ error: 'incomplete_upload' });
    for (const file of data.files) {
      if (file.status === 'complete') continue;
      const entry = uploaded.find(item => item.id === file.id);
      const parts = entry && entry.parts;
      if (!Array.isArray(parts) || parts.length !== file.parts || parts.some((part, index) =>
        part.partNumber !== index + 1 || !/^"?[A-Za-z0-9_-]{1,128}"?$/.test(String(part.etag || ''))))
        return res.status(400).json({ error: 'incomplete_upload' });
      try {
        await client.send(new CompleteMultipartUploadCommand({ Bucket: bucket, Key: file.key, UploadId: file.uploadId,
          MultipartUpload: { Parts: parts.map(part => ({ PartNumber: part.partNumber, ETag: part.etag })) } }));
        const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: file.key }));
        if (Number(head.ContentLength) !== file.size) throw new Error('Uploaded size mismatch');
        file.status = 'complete';
        delete file.uploadId;
        persist(data);
      } catch (error) { return res.status(503).json({ error: 'upload_verification_failed', message: 'The upload could not be verified. Please retry.' }); }
    }
    data.status = 'complete'; data.submittedAt = new Date().toISOString(); persist(data);
    res.json({ ok: true, id: data.id });
    Promise.resolve(sendNotice(data)).catch(error => console.error('Customer submission notice failed:', error.message));
  });
  adminRouter.get('/', function (req, res) {
    res.json({ submissions: list.all().map(row => { const data = parse(row); return {
      id: data.id, kind: data.kind, name: data.name, email: data.email, message: data.message,
      paidVideo: data.paidVideo, consent: data.consent, consentVersion: data.consentVersion,
      submittedAt: data.submittedAt, files: data.files.map(publicFile)
    }; }) });
  });
  adminRouter.get('/:id/files/:fileId', async function (req, res) {
    const data = ID_PATTERN.test(req.params.id || '') ? parse(get.get(req.params.id)) : null;
    const file = data && data.status === 'complete' && data.files.find(item => item.id === req.params.fileId && item.status === 'complete');
    if (!file) return res.status(404).json({ error: 'not_found' });
    try {
      const url = await sign(client, new GetObjectCommand({ Bucket: bucket, Key: file.key }), { expiresIn: 600 });
      res.redirect(302, url);
    } catch (error) { res.status(503).json({ error: 'media_unavailable' }); }
  });
  return { publicRouter, adminRouter, validateSubmission };
}

module.exports = { setup, validateSubmission, MAX_VIDEO_BYTES, PART_BYTES };
