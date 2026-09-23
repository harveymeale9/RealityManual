'use strict';

const { ImapFlow } = require('imapflow');
const nodemailer = require('nodemailer');
const { simpleParser } = require('mailparser');

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function addressList(value) {
  const source = value && Array.isArray(value.value) ? value.value : [];
  return source.map(function (entry) {
    return { name: String(entry.name || ''), email: String(entry.address || '') };
  }).filter(function (entry) { return entry.email; });
}

function envConfig(env) {
  env = env || process.env;
  const address = env.MAILBOX_ADDRESS || 'info@realitymanual.com';
  return {
    address: address,
    displayName: env.MAILBOX_DISPLAY_NAME || 'Reality Manual Support',
    password: env.MAILBOX_APP_PASSWORD || '',
    imapHost: env.MAILBOX_IMAP_HOST || 'mail.privateemail.com',
    imapPort: number(env.MAILBOX_IMAP_PORT, 993),
    imapSecure: env.MAILBOX_IMAP_SECURE !== 'false',
    smtpHost: env.MAILBOX_SMTP_HOST || 'mail.privateemail.com',
    smtpPort: number(env.MAILBOX_SMTP_PORT, 465),
    smtpSecure: env.MAILBOX_SMTP_SECURE !== 'false',
    initialMessageLimit: number(env.MAILBOX_INITIAL_SYNC_LIMIT, 250)
  };
}

function create(config, dependencies) {
  config = Object.assign(envConfig({}), config || {});
  dependencies = dependencies || {};
  const ImapClient = dependencies.ImapFlow || ImapFlow;
  const parse = dependencies.simpleParser || simpleParser;
  const mailer = dependencies.nodemailer || nodemailer;
  if (!config.password) return null;

  const smtp = mailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: { user: config.address, pass: config.password }
  });

  function imapClient() {
    return new ImapClient({
      host: config.imapHost,
      port: config.imapPort,
      secure: config.imapSecure,
      auth: { user: config.address, pass: config.password },
      logger: false,
      connectionTimeout: 20000,
      greetingTimeout: 12000,
      socketTimeout: 45000
    });
  }

  async function sync(syncState) {
    const client = imapClient();
    await client.connect();
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const uidValidity = String(client.mailbox.uidValidity || '');
        const previousValidity = String(syncState && syncState.uidValidity || '');
        let lastUid = previousValidity === uidValidity ? Number(syncState && syncState.lastUid || 0) : 0;
        const uidNext = Number(client.mailbox.uidNext || 1);
        const highestUid = Math.max(0, uidNext - 1);
        if (!highestUid || lastUid >= highestUid) return { uidValidity: uidValidity, lastUid: highestUid, messages: [] };
        const startUid = lastUid > 0 ? lastUid + 1 : Math.max(1, uidNext - config.initialMessageLimit);
        const fetched = await client.fetchAll(startUid + ':*', { uid: true, flags: true, internalDate: true, source: true }, { uid: true });
        const messages = [];
        for (const item of fetched) {
          if (!item || !item.source) continue;
          const parsed = await parse(item.source);
          const from = addressList(parsed.from)[0] || { name: '', email: '' };
          const internetMessageId = String(parsed.messageId || '').trim();
          messages.push({
            providerId: 'namecheap:' + uidValidity + ':' + item.uid,
            internetMessageId: internetMessageId,
            inReplyTo: String(parsed.inReplyTo || '').trim(),
            references: Array.isArray(parsed.references) ? parsed.references : (parsed.references ? [parsed.references] : []),
            fromName: from.name,
            fromEmail: from.email,
            to: addressList(parsed.to),
            cc: addressList(parsed.cc),
            subject: parsed.subject || '(no subject)',
            textBody: parsed.text || '',
            htmlBody: typeof parsed.html === 'string' ? parsed.html : '',
            read: !!(item.flags && item.flags.has('\\Seen')),
            receivedAt: (parsed.date || item.internalDate || new Date()).toISOString(),
            attachments: (parsed.attachments || []).map(function (attachment) {
              return {
                fileName: attachment.filename || 'attachment',
                mimeType: attachment.contentType || 'application/octet-stream',
                content: attachment.content,
                contentId: String(attachment.cid || '').replace(/^<|>$/g, ''),
                inline: attachment.contentDisposition === 'inline' || !!attachment.cid
              };
            })
          });
        }
        return { uidValidity: uidValidity, lastUid: highestUid, messages: messages };
      } finally {
        lock.release();
      }
    } finally {
      if (client.usable) await client.logout().catch(function () {});
    }
  }

  async function send(payload) {
    const message = payload.message;
    const result = await smtp.sendMail({
      from: { name: config.displayName, address: config.address },
      to: message.to,
      cc: message.cc,
      subject: message.subject,
      text: message.textBody || undefined,
      html: message.htmlBody || undefined,
      inReplyTo: payload.inReplyTo || undefined,
      references: payload.references && payload.references.length ? payload.references : undefined,
      attachments: payload.attachments || []
    });
    return { id: result.messageId || null };
  }

  async function verify() {
    const client = imapClient();
    await client.connect();
    if (client.usable) await client.logout();
    await smtp.verify();
    return true;
  }

  return { name: 'Namecheap Private Email', address: config.address, displayName: config.displayName, sync: sync, send: send, verify: verify };
}

function fromEnv(env, dependencies) {
  const config = envConfig(env);
  return create(config, dependencies);
}

module.exports = { create: create, fromEnv: fromEnv, envConfig: envConfig, addressList: addressList };
