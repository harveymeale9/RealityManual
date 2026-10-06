'use strict';

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const {
  S3Client,
  HeadBucketCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

function clean(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max || 1000);
}

function setup(options) {
  options = options || {};
  const endpoint = clean(options.endpoint, 500).replace(/\/$/, '');
  const bucket = clean(options.bucket, 255);
  const accessKeyId = clean(options.accessKeyId, 500);
  const secretAccessKey = clean(options.secretAccessKey, 1000);
  const missing = [];
  if (!endpoint) missing.push('R2_ENDPOINT');
  if (!bucket) missing.push('R2_BUCKET_NAME');
  if (!accessKeyId) missing.push('R2_ACCESS_KEY_ID');
  if (!secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');
  const configured = missing.length === 0;
  const commandTypes = options.commandTypes || {
    HeadBucketCommand: HeadBucketCommand,
    HeadObjectCommand: HeadObjectCommand,
    GetObjectCommand: GetObjectCommand,
    DeleteObjectCommand: DeleteObjectCommand,
    ListObjectsV2Command: ListObjectsV2Command
  };
  const client = options.client || (configured ? new S3Client({
    region: 'auto',
    endpoint: endpoint,
    credentials: { accessKeyId: accessKeyId, secretAccessKey: secretAccessKey }
  }) : null);
  const uploadFactory = options.uploadFactory || function (input) { return new Upload(input); };
  const signUrl = options.getSignedUrl || getSignedUrl;

  function requireConfigured() {
    if (!configured) throw new Error('R2 storage is not configured: missing ' + missing.join(', '));
  }

  function objectKey(pieceId) {
    const id = clean(pieceId, 128);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid media object id.');
    return 'publish-ready/' + id + '/final.mp4';
  }

  async function headKey(key) {
    requireConfigured();
    const result = await client.send(new commandTypes.HeadObjectCommand({ Bucket: bucket, Key: key }));
    return {
      key: key,
      sizeBytes: Number(result.ContentLength) || 0,
      etag: clean(result.ETag, 300).replace(/^"|"$/g, ''),
      contentType: clean(result.ContentType, 100) || 'video/mp4'
    };
  }

  async function uploadFile(pieceId, filePath, contentType) {
    requireConfigured();
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile() || stat.size <= 0) throw new Error('The final video is missing or empty.');
    const key = objectKey(pieceId);
    const upload = uploadFactory({
      client: client,
      params: {
        Bucket: bucket,
        Key: key,
        Body: fs.createReadStream(filePath),
        ContentType: clean(contentType, 100) || 'video/mp4',
        Metadata: { pieceid: clean(pieceId, 128) }
      },
      queueSize: 3,
      partSize: 16 * 1024 * 1024,
      leavePartsOnError: false
    });
    await upload.done();
    const remote = await headKey(key);
    if (remote.sizeBytes !== stat.size) {
      throw new Error('R2 upload verification failed: remote size did not match the final video.');
    }
    return remote;
  }

  function safeDataKey(value) {
    const key = clean(value, 1000);
    if (!/^backups\/[A-Za-z0-9_./-]+\.json$/.test(key) || key.includes('..')) {
      throw new Error('Invalid R2 JSON object key.');
    }
    return key;
  }

  async function uploadJson(key, value) {
    requireConfigured();
    key = safeDataKey(key);
    const body = Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
    const upload = uploadFactory({
      client: client,
      params: { Bucket: bucket, Key: key, Body: body, ContentType: 'application/json' },
      queueSize: 1,
      partSize: 5 * 1024 * 1024,
      leavePartsOnError: false
    });
    await upload.done();
    const remote = await headKey(key);
    if (remote.sizeBytes !== body.length) throw new Error('R2 JSON upload verification failed: remote size did not match.');
    return remote;
  }

  async function readJson(key) {
    requireConfigured();
    key = safeDataKey(key);
    const response = await client.send(new commandTypes.GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!response.Body) throw new Error('R2 returned an empty JSON object body.');
    let body;
    if (typeof response.Body.transformToString === 'function') body = await response.Body.transformToString('utf8');
    else {
      const chunks = [];
      for await (const chunk of response.Body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      body = Buffer.concat(chunks).toString('utf8');
    }
    return JSON.parse(body);
  }

  async function listKeys(prefix) {
    requireConfigured();
    prefix = clean(prefix, 900);
    if (!/^backups\/[A-Za-z0-9_./-]*$/.test(prefix) || prefix.includes('..')) throw new Error('Invalid R2 list prefix.');
    const objects = [];
    let continuationToken;
    do {
      const response = await client.send(new commandTypes.ListObjectsV2Command({
        Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken
      }));
      (response.Contents || []).forEach(function (item) {
        if (item.Key) objects.push({
          key: item.Key,
          sizeBytes: Number(item.Size) || 0,
          lastModified: item.LastModified ? new Date(item.LastModified).toISOString() : ''
        });
      });
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    return objects;
  }

  async function downloadKey(key, destination) {
    requireConfigured();
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    const response = await client.send(new commandTypes.GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!response.Body) throw new Error('R2 returned an empty object body.');
    try {
      await pipeline(response.Body, fs.createWriteStream(destination, { flags: 'wx' }));
      const stat = await fs.promises.stat(destination);
      if (!stat.isFile() || stat.size <= 0) throw new Error('R2 download was empty.');
      return { path: destination, sizeBytes: stat.size, contentType: clean(response.ContentType, 100) || 'video/mp4' };
    } catch (error) {
      await fs.promises.rm(destination, { force: true });
      throw error;
    }
  }

  async function signedGetUrl(key, expiresInSeconds) {
    requireConfigured();
    const expiresIn = Math.max(60, Math.min(7 * 24 * 60 * 60, Math.round(Number(expiresInSeconds) || 3600)));
    return signUrl(client, new commandTypes.GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: expiresIn });
  }

  async function deleteKey(key) {
    requireConfigured();
    await client.send(new commandTypes.DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async function health() {
    if (!configured) return { configured: false, connected: false, missing: missing.slice() };
    try {
      await client.send(new commandTypes.HeadBucketCommand({ Bucket: bucket }));
      return { configured: true, connected: true, bucket: bucket };
    } catch (error) {
      return { configured: true, connected: false, bucket: bucket, error: clean(error && error.message, 300) || 'R2 connection failed.' };
    }
  }

  return {
    configured: configured,
    bucket: bucket,
    missing: missing.slice(),
    objectKey: objectKey,
    headKey: headKey,
    uploadFile: uploadFile,
    uploadJson: uploadJson,
    readJson: readJson,
    listKeys: listKeys,
    downloadKey: downloadKey,
    signedGetUrl: signedGetUrl,
    deleteKey: deleteKey,
    health: health
  };
}

module.exports = { setup: setup };
