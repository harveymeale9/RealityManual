'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { DUE_AT, TOPICS, hasTopicReply, runFollowups } = require('../src/bookvaultFollowup');

function fixtures() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE mailbox_messages (
    id TEXT, thread_id TEXT, direction TEXT, status TEXT, from_email TEXT,
    subject TEXT, text_body TEXT, created_at TEXT, received_at TEXT, sent_at TEXT
  )`);
  const sends = [];
  const mailbox = {
    syncNow: async () => ({ synced: true }),
    sendAutomated: async (message) => { sends.push(message); return { id: `sent-${sends.length}` }; },
  };
  const add = (row) => db.prepare(`INSERT INTO mailbox_messages
    (id,thread_id,direction,status,from_email,subject,text_body,created_at,received_at,sent_at)
    VALUES (@id,@thread_id,@direction,@status,@from_email,@subject,@text_body,@created_at,@received_at,@sent_at)`)
    .run({ id: row.id || 'reply', thread_id: row.thread_id || null,
      direction: row.direction || 'inbound', status: row.status || 'received',
      from_email: row.from_email || 'bookvault@bookvault.app', subject: row.subject || '',
      text_body: row.text_body || '', created_at: row.created_at || '2026-11-05T12:00:00.000Z',
      received_at: row.received_at || '2026-11-05T12:00:00.000Z', sent_at: row.sent_at || null });
  return { db, mailbox, sends, add };
}

test('the 70-hour deadline is fixed and does not send early', async () => {
  assert.equal(DUE_AT, '2026-11-11T08:46:29.000Z');
  const { db, mailbox, sends } = fixtures();
  const result = await runFollowups({ db, mailbox, now: new Date('2026-11-11T08:46:28.000Z') });
  assert.equal(result.due, false);
  assert.equal(sends.length, 0);
  db.close();
});

test('a substantive topic reply prevents only that topic follow-up', async () => {
  const { db, mailbox, sends, add } = fixtures();
  add({ subject: 'Re: Urgent: USPS Consolidator quote discrepancy for UK-printed US orders', text_body: 'We are investigating the tariff.' });
  const result = await runFollowups({ db, mailbox, now: new Date(DUE_AT) });
  assert.deepEqual(result.results.map((item) => item.decision), ['replied', 'sent']);
  assert.equal(sends.length, 1);
  assert.match(sends[0].subject, /USD-funded bank transfer/);
  assert.equal(sends[0].threadId, TOPICS[1].threadId);
  const again = await runFollowups({ db, mailbox, now: new Date(DUE_AT) });
  assert.equal(again.results[1].decision, 'sent');
  assert.equal(sends.length, 1);
  db.close();
});

test('automatic acknowledgements are not human replies and stale sync blocks sending', async () => {
  assert.equal(hasTopicReply([{ direction: 'inbound', from_email: 'customers@bookvault.app', subject: 'Automatic reply: USPS Consolidator quote discrepancy', received_at: '2026-11-05T12:00:00Z' }], TOPICS[0]), false);
  const { db, mailbox, sends } = fixtures();
  mailbox.syncNow = async () => ({ synced: false });
  await assert.rejects(runFollowups({ db, mailbox, now: new Date(DUE_AT) }), /Mailbox sync failed/);
  assert.equal(sends.length, 0);
  db.close();
});
