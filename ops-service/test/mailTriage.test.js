'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mailboxService = require('../src/mailboxService');
const mailTriageService = require('../src/mailTriageService');

test('mail triage archives every digested email and creates one durable alert only for important mail', async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-mail-triage-'));
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE voice_messages (
    id TEXT PRIMARY KEY,mode TEXT NOT NULL,transcript TEXT NOT NULL,status TEXT NOT NULL,
    reply_text TEXT,error_message TEXT,created_at TEXT NOT NULL,completed_at TEXT,
    activity_log TEXT,early_ack TEXT,reply_to_id TEXT,agent TEXT NOT NULL DEFAULT 'claude',
    notification_kind TEXT NOT NULL DEFAULT 'conversation',notification_unread INTEGER NOT NULL DEFAULT 0,source_ref TEXT
  ); CREATE UNIQUE INDEX idx_voice_mail_alert_source ON voice_messages(source_ref)
    WHERE notification_kind='mail_alert' AND source_ref IS NOT NULL;`);
  const mailbox = mailboxService.setup(db, { dataDir: dir, autoSync: false });
  t.after(function () { mailbox.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  const youtube = mailbox.ingest({
    providerId: 'yt-review-1', fromName: 'YouTube API Services', fromEmail: 'api-review@youtube.com',
    to: ['info@realitymanual.com'], subject: 'YouTube API review approved',
    textBody: 'Your API compliance review has been approved. No further action is required.',
    receivedAt: '2026-09-23T10:00:00Z'
  });
  const promo = mailbox.ingest({
    providerId: 'promo-1', fromName: 'Software Newsletter', fromEmail: 'news@example.com',
    to: ['info@realitymanual.com'], subject: 'September product newsletter',
    textBody: 'Here are this month’s product updates and offers.', receivedAt: '2026-09-23T10:05:00Z'
  });
  let classifyCalls = 0;
  const triage = mailTriageService.setup(db, {
    autoStart: false,
    classify: async function (input) {
      classifyCalls++;
      assert.match(input.prompt, /UNTRUSTED_EMAIL_JSON/);
      if (input.message.from_email === 'api-review@youtube.com') return {
        important: false, category: 'Platform approval',
        summary: input.message.subject.startsWith('Re:')
          ? 'YouTube clarified that the approved integration can publish publicly.'
          : 'YouTube approved the API compliance review and the integration can proceed.',
        actionRequired: false, suggestedNextStep: 'No action needed right now.', reason: 'Approval decision'
      };
      return {
        important: false, category: 'Newsletter', summary: 'Routine newsletter.',
        actionRequired: false, suggestedNextStep: 'No action needed right now.', reason: 'Promotional update'
      };
    }
  });

  const result = await triage.processPending(10);
  assert.deepEqual({ processed: result.processed, alerted: result.alerted }, { processed: 2, alerted: 1 });
  assert.equal(classifyCalls, 2);
  assert.equal(db.prepare('SELECT folder FROM mailbox_threads WHERE id=?').get(youtube.threadId).folder, 'archive');
  assert.equal(db.prepare('SELECT folder FROM mailbox_threads WHERE id=?').get(promo.threadId).folder, 'archive');
  assert.equal(db.prepare('SELECT is_read FROM mailbox_messages WHERE id=?').get(youtube.id).is_read, 1);
  assert.equal(db.prepare('SELECT is_read FROM mailbox_messages WHERE id=?').get(promo.id).is_read, 1);

  const alerts = db.prepare("SELECT * FROM voice_messages WHERE notification_kind='mail_alert'").all();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].notification_unread, 1);
  assert.equal(alerts[0].source_ref, youtube.id);
  assert.match(alerts[0].reply_text, /YouTube approved/);
  assert.match(alerts[0].reply_text, /No action needed right now/);

  const youtubeFollowup = mailbox.ingest({
    providerId: 'yt-review-2', fromName: 'YouTube API Services', fromEmail: 'api-review@youtube.com',
    to: ['info@realitymanual.com'], subject: 'Re: YouTube API review approved',
    textBody: 'Yes, the approved integration may publish public videos.',
    receivedAt: '2026-09-23T10:10:00Z'
  });
  const followupResult = await triage.processPending(10);
  assert.deepEqual({ processed: followupResult.processed, alerted: followupResult.alerted }, { processed: 1, alerted: 1 });
  const updatedAlerts = db.prepare("SELECT * FROM voice_messages WHERE notification_kind='mail_alert'").all();
  assert.equal(updatedAlerts.length, 1);
  assert.equal(updatedAlerts[0].id, alerts[0].id);
  assert.equal(updatedAlerts[0].source_ref, youtubeFollowup.id);
  assert.equal(updatedAlerts[0].notification_unread, 1);
  assert.match(updatedAlerts[0].reply_text, /publish publicly/);
  const triageRows = db.prepare('SELECT alert_message_id,topic_key FROM mail_triage WHERE message_id IN (?,?) ORDER BY message_id').all(youtube.id, youtubeFollowup.id);
  assert.equal(triageRows[0].alert_message_id, triageRows[1].alert_message_id);
  assert.equal(triageRows[0].topic_key, triageRows[1].topic_key);
  assert.equal(db.prepare('SELECT count(*) AS n FROM mail_alert_topics').get().n, 1);

  const again = await triage.processPending(10);
  assert.equal(again.processed, 0);
  assert.equal(classifyCalls, 3);
  assert.equal(db.prepare("SELECT count(*) AS n FROM voice_messages WHERE notification_kind='mail_alert'").get().n, 1);
  triage.close();
});

test('a classification failure leaves mail visible and retryable instead of silently archiving it', async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-mail-triage-error-'));
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE voice_messages (
    id TEXT PRIMARY KEY,mode TEXT NOT NULL,transcript TEXT NOT NULL,status TEXT NOT NULL,
    reply_text TEXT,error_message TEXT,created_at TEXT NOT NULL,completed_at TEXT,
    agent TEXT NOT NULL DEFAULT 'claude',notification_kind TEXT NOT NULL DEFAULT 'conversation',
    notification_unread INTEGER NOT NULL DEFAULT 0,source_ref TEXT
  ); CREATE UNIQUE INDEX idx_voice_mail_alert_source ON voice_messages(source_ref)
    WHERE notification_kind='mail_alert' AND source_ref IS NOT NULL;`);
  const mailbox = mailboxService.setup(db, { dataDir: dir, autoSync: false });
  t.after(function () { mailbox.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const message = mailbox.ingest({
    providerId: 'customer-1', fromName: 'Reader', fromEmail: 'reader@example.com',
    subject: 'Where is my order?', textBody: 'Please help.', receivedAt: '2026-09-23T11:00:00Z'
  });
  const triage = mailTriageService.setup(db, {
    autoStart: false, retryMs: 1,
    classify: async function () { throw new Error('synthetic classifier outage'); }
  });
  const result = await triage.processPending(10);
  assert.equal(result.processed, 0);
  assert.equal(db.prepare('SELECT folder FROM mailbox_threads WHERE id=?').get(message.threadId).folder, 'inbox');
  assert.equal(db.prepare('SELECT is_read FROM mailbox_messages WHERE id=?').get(message.id).is_read, 0);
  assert.equal(db.prepare('SELECT status FROM mail_triage WHERE message_id=?').get(message.id).status, 'error');
  triage.close();
});
