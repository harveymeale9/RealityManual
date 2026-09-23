'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Database = require('better-sqlite3');
const fs = require('fs');
const os = require('os');
const path = require('path');
const manuscriptService = require('../src/manuscriptService');
const corpus = require('../src/ideationCorpus');
const manuscriptSearchIndex = require('../src/manuscriptSearchIndex');

test('manuscript reader serves illustrated selectable spreads and instant persistent semantic search', async function (t) {
  let calls = 0;
  const fakeProviders = {
    generate: async function () {
      calls++;
      throw new Error('Search must not launch an AI provider');
    }
  };
  const db = new Database(':memory:');
  const artworkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-manuscript-test-'));
  fs.mkdirSync(path.join(artworkRoot, 'pages'));
  fs.mkdirSync(path.join(artworkRoot, 'text'));
  fs.writeFileSync(path.join(artworkRoot, 'manifest.json'), JSON.stringify({ pageCount: 180, sourceSha256: 'abc123', imageBytes: 8 }));
  for (const page of [4, 5]) {
    fs.writeFileSync(path.join(artworkRoot, 'pages', String(page).padStart(3, '0') + '.webp'), Buffer.from('RIFFtest'));
    fs.writeFileSync(path.join(artworkRoot, 'text', String(page).padStart(3, '0') + '.json'), JSON.stringify({ width: 1606, height: 2386, words: [['Belief', 200, 300, 80, 32, 95]] }));
  }
  db.exec("CREATE TABLE ideation_settings(id INTEGER PRIMARY KEY,selected_provider TEXT); INSERT INTO ideation_settings VALUES(1,'codex')");
  const service = manuscriptService.setup(db, { providers: fakeProviders, autoStart: false, artworkRoot: artworkRoot });
  const app = express();
  app.use(express.json());
  app.use('/api/manuscript', service.router);
  const server = app.listen(0);
  t.after(function () { server.close(); db.close(); fs.rmSync(artworkRoot, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port + '/api/manuscript';

  async function request(path, options) {
    const response = await fetch(base + path, options);
    const data = await response.json();
    assert.equal(response.ok, true, JSON.stringify(data));
    return data;
  }

  const meta = await request('/meta');
  assert.equal(meta.pageCount, 180);
  assert.equal(meta.illustrated, true);
  const download = await fetch(base + '/download');
  assert.equal(download.ok, true);
  assert.match(download.headers.get('content-disposition') || '', /attachment;.*The Reality Manual - Complete Manuscript\.txt/i);
  assert.match(await download.text(), /==PAGE 1==[\s\S]*The Absurdity of Life/i);
  const spread = await request('/pages/4');
  assert.equal(spread.left.page, 4);
  assert.equal(spread.right.page, 5);
  assert.match(spread.left.artwork.imageUrl, /^\/api\/manuscript\/artwork\/4/);
  assert.deepEqual(spread.left.artwork.words[0].slice(0, 2), ['Belief', 200]);
  assert.doesNotMatch(spread.left.text, /\*IMAGE:/);
  assert.doesNotMatch(spread.left.text, /==END PAGE/);
  const artwork = await fetch('http://127.0.0.1:' + server.address().port + spread.left.artwork.imageUrl);
  assert.equal(artwork.ok, true);
  assert.equal(artwork.headers.get('content-type'), 'image/webp');
  assert.match(artwork.headers.get('cache-control') || '', /immutable/);

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

  const exactPhrase = await request('/search', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '“The more of one\'s life that can be directed toward what one wants, the greater one\'s freedom.”' })
  });
  assert.equal(exactPhrase.results[0].page, 91);
  assert.match(exactPhrase.results[0].relevance, /exact phrase/i);
  assert.match(manuscriptSearchIndex.normalized(exactPhrase.results[0].excerpt), /the more of ones life that can be directed toward what one wants/);
  assert.doesNotMatch(exactPhrase.results[0].excerpt, /\n\s*\n/, 'click-highlight excerpt must stay within one rendered paragraph');

  // Exact matching must work even when every word is normally discarded as
  // an FTS stop word; literal lookup is its own path, not a ranking bonus that
  // only runs after lexical search happens to find a candidate.
  const stopWordPhrase = await request('/search', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'what is to be' })
  });
  assert.equal(stopWordPhrase.results[0].page, 16);
  assert.match(stopWordPhrase.results[0].relevance, /exact phrase/i);

  const describedFreedom = await request('/search', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'You see, we all get 24 hours in a day, regardless of how much money we have. And we all have to fill that 24 hours doing actions in the world. Now the extent of your happiness will be the extent to which you can orient those actions toward the things you find desirable.' })
  });
  assert.equal(describedFreedom.results[0].page, 91);
  assert.match(describedFreedom.results[0].relevance, /freedom/i);

  const rowsBeforeRestart = db.prepare('SELECT count(*) AS n FROM manuscript_search_chunks').get().n;
  manuscriptService.setup(db, { providers: fakeProviders, autoStart: false });
  assert.equal(db.prepare('SELECT count(*) AS n FROM manuscript_search_chunks').get().n, rowsBeforeRestart);
});
