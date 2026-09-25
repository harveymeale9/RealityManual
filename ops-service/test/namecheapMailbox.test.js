'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const namecheapMailbox = require('../src/namecheapMailbox');

test('Namecheap provider maps encrypted IMAP mail and sends with the support identity', async function () {
  const sent = [];
  class FakeImapFlow {
    constructor(options) { this.options = options; this.usable = false; this.mailbox = null; }
    async connect() { this.usable = true; }
    async getMailboxLock(path) {
      assert.equal(path, 'INBOX');
      this.mailbox = { uidValidity: 77n, uidNext: 13n };
      return { release: function () {} };
    }
    async fetchAll(range, query, options) {
      assert.equal(range, '12:*');
      assert.equal(query.source, true);
      assert.equal(options.uid, true);
      return [{ uid: 12, flags: new Set(), internalDate: new Date('2026-09-23T09:00:00Z'), source: Buffer.from('raw') }];
    }
    async logout() { this.usable = false; }
  }
  const fakeParser = async function () {
    return {
      messageId: '<incoming@example.com>',
      inReplyTo: '<older@example.com>',
      references: ['<first@example.com>', '<older@example.com>'],
      from: { value: [{ name: 'A Customer', address: 'customer@example.com' }] },
      to: { value: [{ name: 'Support', address: 'info@realitymanual.com' }] },
      subject: 'Order question', text: 'Where is my book?', html: '<p>Where is my book?</p>',
      date: new Date('2026-09-23T09:00:00Z'),
      attachments: [{ filename: 'photo.png', contentType: 'image/png', content: Buffer.from('image'), cid: '<photo-1>', contentDisposition: 'inline' }]
    };
  };
  const fakeNodemailer = {
    createTransport: function (options) {
      assert.deepEqual(options.auth, { user: 'info@realitymanual.com', pass: 'synthetic-test-password' });
      return {
        sendMail: async function (message) { sent.push(message); return { messageId: '<outgoing@example.com>' }; },
        verify: async function () { return true; }
      };
    }
  };
  const provider = namecheapMailbox.create({
    address: 'info@realitymanual.com', displayName: 'Reality Manual Support', password: 'synthetic-test-password',
    imapHost: 'mail.privateemail.com', imapPort: 993, imapSecure: true,
    smtpHost: 'mail.privateemail.com', smtpPort: 465, smtpSecure: true, initialMessageLimit: 1
  }, { ImapFlow: FakeImapFlow, simpleParser: fakeParser, nodemailer: fakeNodemailer });

  const synced = await provider.sync({ uidValidity: '', lastUid: 0 });
  assert.equal(synced.uidValidity, '77');
  assert.equal(synced.lastUid, 12);
  assert.equal(synced.messages[0].providerId, 'namecheap:77:12');
  assert.equal(synced.messages[0].internetMessageId, '<incoming@example.com>');
  assert.equal(synced.messages[0].attachments[0].inline, true);
  assert.equal(synced.messages[0].attachments[0].contentId, 'photo-1');

  const result = await provider.send({
    message: { to: ['customer@example.com'], cc: [], subject: 'Re: Order question', textBody: 'On its way.', htmlBody: '<p>On its way.</p>' },
    inReplyTo: '<incoming@example.com>', references: ['<incoming@example.com>'],
    attachments: [{ filename: 'tracking.png', path: '/tmp/synthetic-tracking.png', cid: 'tracking-1' }]
  });
  assert.equal(result.id, '<outgoing@example.com>');
  assert.deepEqual(sent[0].from, { name: 'Reality Manual Support', address: 'info@realitymanual.com' });
  assert.equal(sent[0].inReplyTo, '<incoming@example.com>');
  assert.equal(sent[0].attachments[0].cid, 'tracking-1');
});

test('provider stays disabled until an app password exists', function () {
  assert.equal(namecheapMailbox.fromEnv({ MAILBOX_ADDRESS: 'info@realitymanual.com' }), null);
  // envConfig exposes non-secret provider defaults independently of whether a
  // password has been supplied. Keeping a password-shaped test literal here
  // also causes public-repository secret scanners to report a false positive.
  const defaults = namecheapMailbox.envConfig({ MAILBOX_ADDRESS: 'info@realitymanual.com' });
  assert.equal(defaults.imapHost, 'mail.privateemail.com');
  assert.equal(defaults.imapPort, 993);
  assert.equal(defaults.smtpHost, 'mail.privateemail.com');
  assert.equal(defaults.smtpPort, 465);
  assert.equal(defaults.displayName, 'Reality Manual Support');
});
