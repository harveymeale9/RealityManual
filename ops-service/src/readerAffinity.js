'use strict';

const SCHEMA = { type: 'object', additionalProperties: false, required: ['opinion'], properties: {
  opinion: { type: 'string', enum: ['unclear', 'critical', 'mixed', 'positive', 'very_positive', 'exceptional'] }
} };
const OPINIONS = new Set(SCHEMA.properties.opinion.enum);

function opinionFor(message, classify) {
  const text = String(message || '').trim();
  if (text.length < 40 || text.split(/\s+/).length < 7) return Promise.resolve('unclear');
  return classify(text).then(result => {
    if (!OPINIONS.has(result && result.opinion)) throw new Error('invalid_reader_opinion');
    return result.opinion;
  });
}

function setup(db, options = {}) {
  const rows = db.prepare("SELECT id,data FROM customer_submissions WHERE status='complete' ORDER BY submitted_at ASC");
  const save = db.prepare('UPDATE customer_submissions SET data=? WHERE id=?');
  let running = false;
  async function processPending() {
    if (running) return;
    running = true;
    try {
      for (const row of rows.all()) {
        try {
          const data = JSON.parse(row.data);
          // Historical synthetic QA submissions are not reader opinions.
          if (/\bQA TEST ONLY\b/i.test(data.name || '') || /\bQA TEST ONLY\b/i.test(data.message || '')) continue;
          const previous = data.readerTags || {};
          if (previous.status === 'tagged' ||
              (previous.checkedAt && Date.now() - Date.parse(previous.checkedAt) <
                (previous.status === 'unmatched' ? 24 * 3600000 : 5 * 60000))) continue;
          const opinion = previous.opinion || await opinionFor(data.message, options.classify);
          if (!previous.opinion) {
            data.readerTags = { status: 'pending', opinion };
            save.run(JSON.stringify(data), data.id);
          }
          const result = await options.tag({ submission_id: data.id, email: data.email,
            kind: data.kind, has_video: (data.files || []).some(file => file.kind === 'video'),
            submitted_at: data.submittedAt, opinion });
          data.readerTags = { status: result.tagged ? 'tagged' : result.matched ? 'pending_contact' : 'unmatched',
            opinion, checkedAt: new Date().toISOString() };
          save.run(JSON.stringify(data), data.id);
        } catch (error) { console.error('Reader affinity tagging failed for ' + row.id + ':', error.message); }
      }
    } finally { running = false; }
  }
  const timer = options.start === false ? null : setInterval(() => { processPending(); }, 60000);
  if (timer) timer.unref();
  if (timer) setTimeout(() => { processPending(); }, 12000).unref();
  return { processPending, close: () => { if (timer) clearInterval(timer); } };
}

module.exports = { setup, SCHEMA, opinionFor };
