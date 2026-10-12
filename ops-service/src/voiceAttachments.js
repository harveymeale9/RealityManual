'use strict';

const path = require('path');

const MIME_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'application/mp4': '.mp4'
};

function extensionForUpload(file) {
  const mime = String(file && file.mimetype || '').toLowerCase();
  if (MIME_EXTENSIONS[mime]) return MIME_EXTENSIONS[mime];
  const originalExtension = path.extname(String(file && file.originalname || '')).toLowerCase();
  if ((!mime || mime === 'application/octet-stream') && originalExtension === '.mp4') return '.mp4';
  return '';
}

function parseRecords(row, maximum, fieldName) {
  try {
    fieldName = fieldName || 'attachments_json';
    const parsed = row && row[fieldName] ? JSON.parse(row[fieldName]) : [];
    return Array.isArray(parsed) ? parsed.filter(function (item) {
      return item && typeof item.file === 'string' && /^(?:[0-9]+|reply-[0-9]+)\.(?:jpg|png|gif|webp|mp4)$/.test(item.file);
    }).slice(0, maximum || 8) : [];
  } catch (error) {
    return [];
  }
}

function hostInputs(records, hostDataDir, messageId) {
  const result = { imagePaths: [], filePaths: [] };
  (records || []).forEach(function (item) {
    const filePath = path.join(hostDataDir, 'voice-attachments', messageId, item.file);
    if (String(item.mime || '').toLowerCase().startsWith('image/') || /\.(?:jpg|png|gif|webp)$/i.test(item.file)) result.imagePaths.push(filePath);
    else result.filePaths.push(filePath);
  });
  return result;
}

module.exports = { extensionForUpload, parseRecords, hostInputs };
