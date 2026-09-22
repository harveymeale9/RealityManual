'use strict';

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function now() { return new Date().toISOString(); }
function clean(value, max) { return String(value == null ? '' : value).trim().slice(0, max || 100000); }
function json(value, fallback) { try { return JSON.parse(value); } catch (e) { return fallback; } }
function bool(value) { return value === true || value === 1 || value === '1' || value === 'true'; }

function setup(db, options) {
  options = options || {};
  const dataDir = options.dataDir || '/data';
  const transport = options.transport || null;
  const mailboxAddress = clean(options.address, 500) || 'info@realitymanual.com';
  const attachmentDir = path.join(dataDir, 'mailbox-attachments');
  const tempDir = path.join(dataDir, 'tmp');
  fs.mkdirSync(attachmentDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });

  db.exec(`
    CREATE TABLE IF NOT EXISTS mailbox_threads (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      participants_json TEXT NOT NULL DEFAULT '[]',
      folder TEXT NOT NULL DEFAULT 'inbox',
      starred INTEGER NOT NULL DEFAULT 0,
      unread_count INTEGER NOT NULL DEFAULT 0,
      preview TEXT NOT NULL DEFAULT '',
      last_message_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mailbox_threads_folder_date ON mailbox_threads(folder,last_message_at DESC);
    CREATE TABLE IF NOT EXISTS mailbox_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      provider_id TEXT,
      direction TEXT NOT NULL,
      status TEXT NOT NULL,
      from_name TEXT,
      from_email TEXT NOT NULL,
      to_json TEXT NOT NULL DEFAULT '[]',
      cc_json TEXT NOT NULL DEFAULT '[]',
      subject TEXT NOT NULL,
      text_body TEXT NOT NULL DEFAULT '',
      html_body TEXT NOT NULL DEFAULT '',
      is_read INTEGER NOT NULL DEFAULT 1,
      in_reply_to TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT,
      received_at TEXT,
      FOREIGN KEY(thread_id) REFERENCES mailbox_threads(id)
    );
    CREATE INDEX IF NOT EXISTS idx_mailbox_messages_thread_date ON mailbox_messages(thread_id,created_at ASC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mailbox_messages_provider ON mailbox_messages(provider_id) WHERE provider_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS mailbox_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_name TEXT NOT NULL,
      content_id TEXT,
      is_inline INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(message_id) REFERENCES mailbox_messages(id)
    );
    CREATE INDEX IF NOT EXISTS idx_mailbox_attachments_message ON mailbox_attachments(message_id);
  `);

  const upload = multer({ dest: tempDir, limits: { fileSize: 20 * 1024 * 1024, files: 12 } });

  function configured() {
    return !!(transport && typeof transport.send === 'function');
  }

  function threadRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      subject: row.subject,
      participants: json(row.participants_json, []),
      folder: row.folder,
      starred: !!row.starred,
      unreadCount: row.unread_count,
      preview: row.preview,
      lastMessageAt: row.last_message_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function attachmentRows(messageId) {
    return db.prepare('SELECT id,file_name,mime_type,size_bytes,content_id,is_inline FROM mailbox_attachments WHERE message_id=? ORDER BY created_at,id')
      .all(messageId).map(function (row) {
        return { id: row.id, fileName: row.file_name, mimeType: row.mime_type, size: row.size_bytes, contentId: row.content_id, inline: !!row.is_inline };
      });
  }

  function messageRow(row) {
    return {
      id: row.id,
      threadId: row.thread_id,
      direction: row.direction,
      status: row.status,
      from: { name: row.from_name || '', email: row.from_email },
      to: json(row.to_json, []),
      cc: json(row.cc_json, []),
      subject: row.subject,
      textBody: row.text_body,
      htmlBody: row.html_body,
      read: !!row.is_read,
      inReplyTo: row.in_reply_to,
      createdAt: row.created_at,
      sentAt: row.sent_at,
      receivedAt: row.received_at,
      attachments: attachmentRows(row.id)
    };
  }

  function refreshThread(threadId) {
    const latest = db.prepare('SELECT * FROM mailbox_messages WHERE thread_id=? ORDER BY created_at DESC LIMIT 1').get(threadId);
    if (!latest) return;
    const unread = db.prepare("SELECT count(*) AS n FROM mailbox_messages WHERE thread_id=? AND direction='inbound' AND is_read=0").get(threadId).n;
    const preview = clean(latest.text_body || latest.html_body.replace(/<[^>]+>/g, ' '), 180);
    db.prepare('UPDATE mailbox_threads SET subject=?,preview=?,unread_count=?,last_message_at=?,updated_at=? WHERE id=?')
      .run(latest.subject || '(no subject)', preview, unread, latest.created_at, now(), threadId);
  }

  function ensureThread(input) {
    const id = clean(input.threadId, 128) || crypto.randomUUID();
    const stamp = clean(input.createdAt, 64) || now();
    const participants = Array.isArray(input.participants) ? input.participants : [];
    db.prepare(`INSERT INTO mailbox_threads
      (id,subject,participants_json,folder,starred,unread_count,preview,last_message_at,created_at,updated_at)
      VALUES (?,?,?,?,0,0,'',?,?,?) ON CONFLICT(id) DO NOTHING`)
      .run(id, clean(input.subject, 500) || '(no subject)', JSON.stringify(participants), clean(input.folder, 30) || 'inbox', stamp, stamp, stamp);
    return id;
  }

  function storeAttachments(messageId, files, meta) {
    const metadata = Array.isArray(meta) ? meta : [];
    return (files || []).map(function (file, index) {
      const item = metadata[index] || {};
      const id = crypto.randomUUID();
      const storageName = id + path.extname(file.originalname || '').slice(0, 16);
      fs.renameSync(file.path, path.join(attachmentDir, storageName));
      db.prepare(`INSERT INTO mailbox_attachments
        (id,message_id,file_name,mime_type,size_bytes,storage_name,content_id,is_inline,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, messageId, clean(file.originalname, 240) || 'attachment', clean(file.mimetype, 120) || 'application/octet-stream', file.size || 0,
          storageName, clean(item.contentId, 180) || null, bool(item.inline) ? 1 : 0, now());
      return { id: id, fileName: file.originalname, path: path.join(attachmentDir, storageName), contentId: clean(item.contentId, 180) || null, inline: bool(item.inline), mimeType: file.mimetype };
    });
  }

  function ingest(input) {
    input = input || {};
    const providerId = clean(input.providerId, 500) || null;
    if (providerId) {
      const existing = db.prepare('SELECT id FROM mailbox_messages WHERE provider_id=?').get(providerId);
      if (existing) return messageRow(db.prepare('SELECT * FROM mailbox_messages WHERE id=?').get(existing.id));
    }
    const stamp = clean(input.receivedAt, 64) || now();
    const threadId = ensureThread({
      threadId: input.threadId,
      subject: input.subject,
      participants: input.participants || [{ name: input.fromName || '', email: input.fromEmail || '' }],
      folder: input.folder || 'inbox',
      createdAt: stamp
    });
    const id = clean(input.id, 128) || crypto.randomUUID();
    db.prepare(`INSERT INTO mailbox_messages
      (id,thread_id,provider_id,direction,status,from_name,from_email,to_json,cc_json,subject,text_body,html_body,is_read,in_reply_to,created_at,sent_at,received_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, threadId, providerId, 'inbound', 'received', clean(input.fromName, 300), clean(input.fromEmail, 500),
        JSON.stringify(input.to || [mailboxAddress]), JSON.stringify(input.cc || []), clean(input.subject, 500) || '(no subject)',
        clean(input.textBody), clean(input.htmlBody), bool(input.read) ? 1 : 0, clean(input.inReplyTo, 500) || null, stamp, null, stamp);
    (input.attachments || []).forEach(function (file) {
      if (!file || !Buffer.isBuffer(file.content)) return;
      const attachmentId = crypto.randomUUID();
      const fileName = clean(file.fileName, 240) || 'attachment';
      const storageName = attachmentId + path.extname(fileName).slice(0, 16);
      fs.writeFileSync(path.join(attachmentDir, storageName), file.content);
      db.prepare(`INSERT INTO mailbox_attachments
        (id,message_id,file_name,mime_type,size_bytes,storage_name,content_id,is_inline,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(attachmentId, id, fileName, clean(file.mimeType, 120) || 'application/octet-stream', file.content.length,
          storageName, clean(file.contentId, 180) || null, bool(file.inline) ? 1 : 0, stamp);
    });
    refreshThread(threadId);
    return messageRow(db.prepare('SELECT * FROM mailbox_messages WHERE id=?').get(id));
  }

  function saveDraft(body, files) {
    body = body || {};
    const stamp = now();
    let threadId = clean(body.threadId, 128);
    if (!threadId || !db.prepare('SELECT id FROM mailbox_threads WHERE id=?').get(threadId)) {
      threadId = ensureThread({ subject: body.subject, participants: json(body.to, []), folder: 'drafts', createdAt: stamp });
    }
    const id = clean(body.draftId, 128) || crypto.randomUUID();
    const existing = db.prepare("SELECT id FROM mailbox_messages WHERE id=? AND status='draft'").get(id);
    const to = json(body.to, []), cc = json(body.cc, []);
    if (existing) {
      db.prepare(`UPDATE mailbox_messages SET thread_id=?,to_json=?,cc_json=?,subject=?,text_body=?,html_body=?,in_reply_to=?,created_at=? WHERE id=?`)
        .run(threadId, JSON.stringify(to), JSON.stringify(cc), clean(body.subject, 500) || '(no subject)', clean(body.textBody), clean(body.htmlBody), clean(body.inReplyTo, 500) || null, stamp, id);
    } else {
      db.prepare(`INSERT INTO mailbox_messages
        (id,thread_id,direction,status,from_name,from_email,to_json,cc_json,subject,text_body,html_body,is_read,in_reply_to,created_at)
        VALUES (?,?, 'outbound','draft','Reality Manual',?,?,?,?,?,?,1,?,?)`)
        .run(id, threadId, mailboxAddress, JSON.stringify(to), JSON.stringify(cc), clean(body.subject, 500) || '(no subject)', clean(body.textBody), clean(body.htmlBody), clean(body.inReplyTo, 500) || null, stamp);
    }
    const meta = json(body.attachmentMeta, []);
    storeAttachments(id, files, meta);
    db.prepare("UPDATE mailbox_threads SET folder='drafts',participants_json=?,updated_at=? WHERE id=? AND NOT EXISTS (SELECT 1 FROM mailbox_messages WHERE thread_id=? AND direction='inbound')")
      .run(JSON.stringify(to), stamp, threadId, threadId);
    refreshThread(threadId);
    return messageRow(db.prepare('SELECT * FROM mailbox_messages WHERE id=?').get(id));
  }

  const router = express.Router();

  router.get('/status', function (req, res) {
    const unread = db.prepare("SELECT COALESCE(sum(unread_count),0) AS n FROM mailbox_threads WHERE folder='inbox'").get().n;
    const drafts = db.prepare("SELECT count(*) AS n FROM mailbox_messages WHERE status='draft'").get().n;
    res.json({ address: mailboxAddress, configured: configured(), provider: configured() ? clean(transport.name, 120) || 'connected mailbox' : null, unread: unread, drafts: drafts });
  });

  router.get('/threads', function (req, res) {
    const folder = clean(req.query.folder, 30) || 'inbox';
    const q = clean(req.query.q, 200).toLowerCase();
    let rows;
    if (folder === 'starred') rows = db.prepare('SELECT * FROM mailbox_threads WHERE starred=1 ORDER BY last_message_at DESC LIMIT 250').all();
    else if (folder === 'drafts') rows = db.prepare("SELECT DISTINCT t.* FROM mailbox_threads t JOIN mailbox_messages m ON m.thread_id=t.id WHERE m.status='draft' ORDER BY t.last_message_at DESC LIMIT 250").all();
    else if (folder === 'sent') rows = db.prepare("SELECT DISTINCT t.* FROM mailbox_threads t JOIN mailbox_messages m ON m.thread_id=t.id WHERE m.status='sent' ORDER BY t.last_message_at DESC LIMIT 250").all();
    else rows = db.prepare('SELECT * FROM mailbox_threads WHERE folder=? ORDER BY last_message_at DESC LIMIT 250').all(folder);
    if (q) rows = rows.filter(function (row) {
      return (row.subject + ' ' + row.preview + ' ' + row.participants_json).toLowerCase().indexOf(q) !== -1;
    });
    res.json({ threads: rows.map(threadRow) });
  });

  router.get('/threads/:id', function (req, res) {
    const row = db.prepare('SELECT * FROM mailbox_threads WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    db.prepare("UPDATE mailbox_messages SET is_read=1 WHERE thread_id=? AND direction='inbound'").run(req.params.id);
    refreshThread(req.params.id);
    const updated = db.prepare('SELECT * FROM mailbox_threads WHERE id=?').get(req.params.id);
    const messages = db.prepare('SELECT * FROM mailbox_messages WHERE thread_id=? ORDER BY created_at ASC').all(req.params.id).map(messageRow);
    res.json({ thread: threadRow(updated), messages: messages });
  });

  router.patch('/threads/:id', function (req, res) {
    const row = db.prepare('SELECT * FROM mailbox_threads WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'read')) {
      db.prepare("UPDATE mailbox_messages SET is_read=? WHERE thread_id=? AND direction='inbound'").run(bool(req.body.read) ? 1 : 0, req.params.id);
    }
    const folder = clean(req.body && req.body.folder, 30);
    if (folder && ['inbox', 'archive', 'trash'].indexOf(folder) !== -1) {
      db.prepare('UPDATE mailbox_threads SET folder=?,updated_at=? WHERE id=?').run(folder, now(), req.params.id);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'starred')) {
      db.prepare('UPDATE mailbox_threads SET starred=?,updated_at=? WHERE id=?').run(bool(req.body.starred) ? 1 : 0, now(), req.params.id);
    }
    refreshThread(req.params.id);
    res.json({ thread: threadRow(db.prepare('SELECT * FROM mailbox_threads WHERE id=?').get(req.params.id)) });
  });

  router.post('/drafts', upload.array('attachments', 12), function (req, res) {
    try { res.status(201).json({ draft: saveDraft(req.body, req.files) }); }
    catch (error) { (req.files || []).forEach(function (file) { try { fs.unlinkSync(file.path); } catch (e) {} }); throw error; }
  });

  router.post('/send', upload.array('attachments', 12), async function (req, res, next) {
    try {
      const draft = saveDraft(req.body, req.files);
      if (!configured()) return res.status(503).json({ error: 'mailbox_not_connected', draft: draft });
      const attachments = db.prepare('SELECT * FROM mailbox_attachments WHERE message_id=?').all(draft.id).map(function (row) {
        return { filename: row.file_name, contentType: row.mime_type, path: path.join(attachmentDir, row.storage_name), cid: row.content_id || undefined };
      });
      const result = await transport.send({ message: draft, attachments: attachments });
      const stamp = now();
      db.prepare("UPDATE mailbox_messages SET status='sent',sent_at=?,provider_id=? WHERE id=?")
        .run(stamp, clean(result && result.id, 500) || null, draft.id);
      db.prepare("UPDATE mailbox_threads SET folder='sent',updated_at=? WHERE id=? AND NOT EXISTS (SELECT 1 FROM mailbox_messages WHERE thread_id=? AND direction='inbound')")
        .run(stamp, draft.threadId, draft.threadId);
      refreshThread(draft.threadId);
      res.json({ message: messageRow(db.prepare('SELECT * FROM mailbox_messages WHERE id=?').get(draft.id)) });
    } catch (error) { next(error); }
  });

  router.get('/attachments/:id', function (req, res) {
    const row = db.prepare('SELECT * FROM mailbox_attachments WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const filePath = path.join(attachmentDir, row.storage_name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file_missing' });
    res.type(row.mime_type);
    res.set('Content-Disposition', 'inline; filename="' + row.file_name.replace(/["\r\n]/g, '_') + '"');
    res.sendFile(filePath);
  });

  return { router: router, ingest: ingest, configured: configured };
}

module.exports = { setup: setup };
