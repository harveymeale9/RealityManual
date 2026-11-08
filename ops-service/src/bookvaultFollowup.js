'use strict';

const DUE_AT = '2026-11-11T08:46:29.000Z'; // 70 hours after Harvey's 2026-11-08 request.
const RECIPIENT = 'customers@bookvault.app';

const TOPICS = Object.freeze([
  {
    id: 'consolidator-quote-20261103',
    originalSentAt: '2026-11-03T00:00:00.000Z',
    originalSubject: 'Urgent: USPS Consolidator quote discrepancy for UK-printed US orders',
    threadId: null, // This message was sent directly by SMTP, outside the mailbox UI.
    originalMessageId: null,
    match: /consolidator|dispatch quote|shipping quote|shipping tariff|delest|pickpackfee|13\.64|10\.16/i,
    body: 'Hi BookVault team,\n\nI am following up on my 3 November email about the USPS Consolidator quote discrepancy for UK-printed US orders of The Reality Manual (ISBN 9658364000016). Could you please let me know what you have found about the difference between the website quote, GBP and USD API quotes, and the amount charged to our account? I would especially appreciate confirmation of the correct tariff and checkout quote to use.\n\nThanks,\nHarvey',
  },
  {
    id: 'usd-funding-20261103',
    originalSentAt: '2026-11-03T02:13:45.390Z',
    originalSubject: 'USD-funded bank transfer or USD billing for UK BookVault orders',
    threadId: '10956842-0a3c-4ad6-b1b5-9d2aa97f7838',
    originalMessageId: 'fbcb4c1b-515b-4041-88a2-0befff7a2cc0',
    match: /bank transfer|wire transfer|ach payment|pre.?paid balance|usd billing|funding our account/i,
    body: 'Hi BookVault team,\n\nI am following up on my 3 November question about funding our UK-production account from USD. Could you please advise whether a USD bank transfer, wire or ACH top-up can be converted into our GBP prepaid balance, or whether our UK-produced orders can be billed in USD? Details of any exchange rate, fees and minimums would help me choose the right option. I am asking for information only; please do not make account or payment changes yet.\n\nThanks,\nHarvey',
  },
]);

function isHumanBookvaultReply(row) {
  const sender = String(row.from_email || '').toLowerCase();
  const subject = String(row.subject || '');
  if (!/@(?:bookvault\.app|bookvault\.com)$/.test(sender)) return false;
  if (/^(automatic reply|auto.?reply|out of office|your bookvault support ticket)/i.test(subject)) return false;
  if (/^(noreply|no-reply|do-not-reply)@/.test(sender)) return false;
  return true;
}

function hasTopicReply(messages, topic) {
  return messages.some((row) => {
    if (row.direction !== 'inbound' || !isHumanBookvaultReply(row)) return false;
    if (new Date(row.received_at || row.created_at) <= new Date(topic.originalSentAt)) return false;
    if (topic.threadId && row.thread_id === topic.threadId) return true;
    return topic.match.test(`${row.subject || ''}\n${row.text_body || ''}`);
  });
}

async function runFollowups({ db, mailbox, now = new Date() }) {
  if (now < new Date(DUE_AT)) return { due: false, dueAt: DUE_AT };

  const sync = await mailbox.syncNow();
  if (!sync.synced) throw new Error('Mailbox sync failed; refusing to send BookVault follow-ups without a fresh inbox check.');

  db.exec(`CREATE TABLE IF NOT EXISTS bookvault_followup_decisions (
    id TEXT PRIMARY KEY, decision TEXT NOT NULL, decided_at TEXT NOT NULL, sent_message_id TEXT
  )`);
  const getDecision = db.prepare('SELECT decision FROM bookvault_followup_decisions WHERE id=?');
  const saveDecision = db.prepare('INSERT OR IGNORE INTO bookvault_followup_decisions (id,decision,decided_at,sent_message_id) VALUES (?,?,?,?)');
  const messages = db.prepare("SELECT id,thread_id,direction,status,from_email,subject,text_body,created_at,received_at,sent_at FROM mailbox_messages WHERE created_at >= '2026-11-03' ORDER BY created_at").all();
  const results = [];

  for (const topic of TOPICS) {
    const prior = getDecision.get(topic.id);
    if (prior) { results.push({ id: topic.id, decision: prior.decision }); continue; }

    if (hasTopicReply(messages, topic)) {
      saveDecision.run(topic.id, 'replied', now.toISOString(), null);
      results.push({ id: topic.id, decision: 'replied' });
      continue;
    }

    const subject = `Re: ${topic.originalSubject}`;
    const alreadySent = messages.find((row) => row.direction === 'outbound' && row.status === 'sent' && row.subject === subject && new Date(row.sent_at) >= new Date(DUE_AT));
    if (alreadySent) {
      saveDecision.run(topic.id, 'sent', now.toISOString(), alreadySent.id);
      results.push({ id: topic.id, decision: 'sent' });
      continue;
    }

    const sent = await mailbox.sendAutomated({
      threadId: topic.threadId || undefined,
      inReplyTo: topic.originalMessageId || undefined,
      to: [RECIPIENT],
      subject,
      textBody: topic.body,
    });
    saveDecision.run(topic.id, 'sent', now.toISOString(), sent.id);
    results.push({ id: topic.id, decision: 'sent' });
  }
  return { due: true, results };
}

module.exports = { DUE_AT, TOPICS, hasTopicReply, runFollowups };
