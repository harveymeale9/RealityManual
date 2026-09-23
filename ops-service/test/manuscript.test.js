'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Database = require('better-sqlite3');
const manuscriptService = require('../src/manuscriptService');
const corpus = require('../src/ideationCorpus');
const manuscriptSearchIndex = require('../src/manuscriptSearchIndex');

test('manuscript reader serves diagram-free spreads and instant persistent semantic search', async function (t) {
  let calls = 0;
  const fakeProviders = {
    generate: async function () {
      calls++;
      throw new Error('Search must not launch an AI provider');
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

  const started = performance.now();
  const created = await request('/search', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'What belief stops me doing what I know I should do?' })
  });
  const elapsed = performance.now() - started;
  assert.equal(created.status, 'done');
  assert.equal(created.provider, 'instant semantic index');
  assert.ok(created.results.length >= 3);
  assert.equal(created.results.slice(0, 3).some(function (result) { return result.page === 109 || result.page === 110; }), true);
  assert.ok(elapsed < 250, 'indexed search took ' + elapsed + 'ms');
  assert.equal(calls, 0);

  const cached = await request('/search', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'What belief stops me doing what I know I should do?' })
  });
  assert.equal(cached.id, created.id);
  assert.equal(calls, 0);
  db.prepare("UPDATE manuscript_search_jobs SET index_fingerprint='older-index' WHERE id=?").run(created.id);
  const refreshedForNewIndex = await request('/search', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'What belief stops me doing what I know I should do?' })
  });
  assert.notEqual(refreshedForNewIndex.id, created.id);
  assert.equal(refreshedForNewIndex.status, 'done');

  const conceptual = await request('/search', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'Should humanity fear advanced aliens or UFOs?' })
  });
  assert.equal(conceptual.status, 'done');
  assert.equal(conceptual.results.slice(0, 2).some(function (result) { return result.page === 57; }), true);
  assert.match(conceptual.results[0].relevance, /oneness/i);

  for (const rule of manuscriptSearchIndex.RULE_REFERENCES) {
    for (const reference of ['rule' + rule.number, 'Rule ' + rule.number, 'Rule ' + rule.roman]) {
      const lookup = await request('/search', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: reference })
      });
      assert.equal(lookup.results[0].page, rule.page, reference + ' should open ' + rule.title);
      assert.equal(lookup.results[0].title, rule.title, reference + ' should name the exact Rule');
      assert.match(lookup.results[0].relevance, /exact Rule requested/i);
    }
  }
  const namedRule = await request('/search', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'Rule of Internal Value' })
  });
  assert.equal(namedRule.results[0].page, 9);
  assert.equal(namedRule.results[0].title, 'Rule I: The Rule of Internal Value');

  const rowsBeforeRestart = db.prepare('SELECT count(*) AS n FROM manuscript_search_chunks').get().n;
  manuscriptService.setup(db, { providers: fakeProviders, autoStart: false });
  assert.equal(db.prepare('SELECT count(*) AS n FROM manuscript_search_chunks').get().n, rowsBeforeRestart);
});
