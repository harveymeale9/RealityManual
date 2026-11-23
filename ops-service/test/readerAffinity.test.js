'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { setup } = require('../src/readerAffinity');

test('reader tagging classifies substantive text, skips QA, and retries pending contact without reclassifying', async () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE customer_submissions(id TEXT PRIMARY KEY,data TEXT,status TEXT,submitted_at TEXT)');
  const insert = db.prepare('INSERT INTO customer_submissions VALUES(?,?,?,?)');
  const records = [
    { id: '11111111-1111-4111-8111-111111111111', kind: 'feedback', name: 'Reader', email: 'reader@example.test',
      message: 'I loved the chapter on perspective; its example helped me finally understand the main idea.',
      files: [], submittedAt: '2026-11-23T00:00:00.000Z' },
    { id: '22222222-2222-4222-8222-222222222222', kind: 'review', name: 'QA TEST ONLY', email: 'owner@example.test',
      message: 'A generated test clip, not a real reader opinion.', files: [{ kind: 'video' }], submittedAt: '2026-11-23T01:00:00.000Z' },
    { id: '33333333-3333-4333-8333-333333333333', kind: 'review', name: 'Short', email: 'short@example.test',
      message: 'Good book.', files: [], submittedAt: '2026-11-23T02:00:00.000Z' }
  ];
  records.forEach(data => insert.run(data.id, JSON.stringify(data), 'complete', data.submittedAt));
  let classified = 0, tagged = 0;
  const processor = setup(db, { start: false,
    classify: async () => { classified++; return { opinion: 'positive' }; },
    tag: async input => { tagged++; return input.email === 'reader@example.test'
      ? { matched: true, tagged: true } : { matched: false, tagged: false }; } });
  await processor.processPending(); await processor.processPending();
  assert.equal(classified, 1); assert.equal(tagged, 2);
  const get = id => JSON.parse(db.prepare('SELECT data FROM customer_submissions WHERE id=?').get(id).data).readerTags;
  assert.deepEqual({ status: get(records[0].id).status, opinion: get(records[0].id).opinion }, { status: 'tagged', opinion: 'positive' });
  assert.equal(get(records[1].id), undefined);
  assert.equal(get(records[2].id).opinion, 'unclear');
  processor.close(); db.close();
});
