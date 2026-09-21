'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Database = require('better-sqlite3');
const manuscriptService = require('../src/manuscriptService');
const corpus = require('../src/ideationCorpus');

test('manuscript reader serves diagram-free spreads and restart-safe AI search', async function (t) {
  const firstLine = manuscriptService.readerText(corpus.loadManuscript().pages[0].text)
    .split('\n').map(function (line) { return line.trim(); }).find(function (line) { return line.length > 80; });
  let calls = 0;
  let receivedPrompt = '';
  const fakeProviders = {
    generate: async function (provider, prompt, onActivity) {
      calls++;
      receivedPrompt = prompt;
      onActivity('Reading manuscript concepts');
      return {
        provider: provider,
        model: 'test',
        text: JSON.stringify({ results: [
          { page: 1, title: 'The game of life', relevance: 'It establishes the governing metaphor.', excerpt: firstLine },
          { page: 999, title: 'Invalid', relevance: 'Must be rejected.', excerpt: 'Invented' }
        ] })
      };
    }
  };
  const db = new Database(':memory:');
  db.exec("CREATE TABLE ideation_settings(id INTEGER PRIMARY KEY,selected_provider TEXT); INSERT INTO ideation_settings VALUES(1,'codex')");
  const service = manuscriptService.setup(db, { providers: fakeProviders, autoStart: false });
  const app = express();
  app.use(express.json());
  app.use('/api/manuscript', service.router);
  const server = app.listen(0);
  t.after(function () { server.close(); db.close(); });
  const base = 'http://127.0.0.1:' + server.address().port + '/api/manuscript';

  async function request(path, options) {
    const response = await fetch(base + path, options);
    const data = await response.json();
    assert.equal(response.ok, true, JSON.stringify(data));
    return data;
  }

  const meta = await request('/meta');
  assert.equal(meta.pageCount, 180);
  const spread = await request('/pages/4');
  assert.equal(spread.left.page, 4);
  assert.equal(spread.right.page, 5);
  assert.doesNotMatch(spread.left.text, /\*IMAGE:/);
  assert.doesNotMatch(spread.left.text, /==END PAGE/);

  const created = await request('/search', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'What is the real objective beneath ordinary goals?' })
  });
  assert.equal(created.status, 'pending');
  await service.runWorker();
  const finished = await request('/search/' + created.id);
  assert.equal(finished.status, 'done');
  assert.equal(finished.results.length, 1);
  assert.equal(finished.results[0].page, 1);
  assert.equal(finished.results[0].excerpt, firstLine);
  assert.match(receivedPrompt, /meaning-based research, not keyword matching/);
  assert.match(receivedPrompt, /What is the real objective/);

  const cached = await request('/search', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'What is the real objective beneath ordinary goals?' })
  });
  assert.equal(cached.id, created.id);
  assert.equal(calls, 1);
});
