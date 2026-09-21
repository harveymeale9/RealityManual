'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Database = require('better-sqlite3');
const ideationService = require('../src/ideationService');

function proposal(seed, revised) {
  const token = 'concept' + seed.toString(36);
  return {
    contentType: seed % 7 === 0 ? 'longform' : 'short',
    title: (revised ? 'Revised ' : '') + token,
    bigIdea: token + ' angle' + seed.toString(36) + ' application' + seed.toString(36) + ' consequence' + seed.toString(36),
    hook: 'Opening-' + seed,
    manuscriptSources: ['Source-' + seed], relevantSections: ['Section I'], relevantPages: [1], directQuotes: [],
    paraphrases: ['Clearly marked paraphrase ' + seed],
    script: (revised ? 'REVISED OPENING\n' : '') + 'Usable script ' + seed + ' with a practical emotional well-being conclusion.'
  };
}

test('persistent queue, revisions, learning signals, and Kanban transfer work together', async function (t) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE records(store_name TEXT,id TEXT,data TEXT,updated_at TEXT,PRIMARY KEY(store_name,id))');
  let generation = 0;
  const fakeProviders = {
    generate: async function (provider, prompt) {
      if (prompt.startsWith('Maintain a compact')) return { provider: provider, model: 'test', text: JSON.stringify({ summary: 'Prefers precision.', likes: ['precision'], avoids: ['generic'], hookPreferences: [], formatPreferences: [] }) };
      if (prompt.indexOf('Revise this proposal') !== -1) return { provider: provider, model: 'test', text: JSON.stringify({ proposal: proposal(9000, true), changeSummary: ['Changed only the opening.'] }) };
      const count = Number((prompt.match(/Generate (\d+)/) || [0, 1])[1]);
      generation++;
      return { provider: provider, model: 'test', sessionId: 'test-session', text: JSON.stringify({ proposals: Array.from({ length: count }, function (_, i) { return proposal(generation * 100 + i, false); }) }) };
    }
  };
  const service = ideationService.setup(db, { providers: fakeProviders, autoStart: false });
  const app = express(); app.use(express.json()); app.use('/api/ideation', service.router);
  const server = app.listen(0); t.after(function () { server.close(); db.close(); });
  const base = 'http://127.0.0.1:' + server.address().port + '/api/ideation';
  async function request(path, method, body) {
    const response = await fetch(base + path, { method: method || 'GET', headers: { 'content-type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) });
    const data = await response.json();
    assert.equal(response.ok, true, JSON.stringify(data)); return data;
  }
  async function waitFor(predicate) {
    for (let i = 0; i < 80; i++) { const value = await request('/state'); if (predicate(value)) return value; await new Promise(function (r) { setTimeout(r, 20); }); }
    throw new Error('Timed out waiting for Ideation worker');
  }

  let state = await request('/state');
  state = await waitFor(function (s) { return s.ideas.length === 10; });
  assert.equal(state.selectedProvider, 'codex');
  const edited = state.ideas[0];
  await request('/ideas/' + edited.id, 'PATCH', { title: edited.title, bigIdea: edited.big_idea, hook: edited.hook, script: edited.script + '\nManual sentence.' });
  await request('/ideas/' + edited.id + '/feedback', 'POST', { text: 'Use a sharper opening.', source: 'voice' });
  await request('/ideas/' + edited.id + '/revise', 'POST', {});
  state = await waitFor(function (s) { const idea = s.ideas.find(function (x) { return x.id === edited.id; }); return idea && idea.revisions.some(function (r) { return r.kind === 'ai_revision'; }); });
  const revised = state.ideas.find(function (x) { return x.id === edited.id; });
  assert.equal(revised.edited, true); assert.equal(revised.feedback[0].source, 'voice');
  assert.ok(revised.revisions[0].diff.some(function (line) { return line.type === 'add'; }));

  const transferred = state.ideas[1];
  const transfer = await request('/ideas/' + transferred.id + '/transfer', 'POST', { title: transferred.title, bigIdea: transferred.big_idea, hook: transferred.hook, script: transferred.script, destination: 'outline_completed' });
  assert.equal(transfer.piece.stage, 'outline_completed');
  assert.equal(JSON.parse(db.prepare("SELECT data FROM records WHERE store_name='pieces' AND id=?").get(transfer.piece.id).data).ideationMetadata.ideaId, transferred.id);
  state = await waitFor(function (s) { return s.ideas.length === 10; });

  const rejected = state.ideas.find(function (x) { return x.id !== edited.id; });
  await request('/ideas/' + rejected.id + '/reject', 'POST', { title: rejected.title, bigIdea: rejected.big_idea, hook: rejected.hook, script: rejected.script, feedback: 'Too generic.' });
  state = await waitFor(function (s) { return s.ideas.length === 10; });
  assert.equal(db.prepare("SELECT count(*) n FROM ideation_signals WHERE signal_type='not_interested'").get().n, 1);

  await request('/provider', 'PUT', { provider: 'claude' });
  assert.equal((await request('/state')).selectedProvider, 'claude');
  const restarted = ideationService.setup(db, { providers: fakeProviders, autoStart: false });
  assert.equal(restarted.state().ideas.length, 10); assert.equal(restarted.state().selectedProvider, 'claude');
});
