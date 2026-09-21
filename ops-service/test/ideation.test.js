'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Database = require('better-sqlite3');
const ideationService = require('../src/ideationService');
const corpus = require('../src/ideationCorpus');

const TEST_QUOTE = corpus.loadManuscript().pages[0].text.split('\n').map(function (line) { return line.trim(); }).find(function (line) { return line.length > 30; }).slice(0, 90);

function idea(seed) {
  const token = 'concept' + seed.toString(36);
  const distinct = Array.from({ length: 12 }, function (_, index) { return token + 'angle' + index; }).join(' ');
  return {
    bigIdea: distinct + '. This is a sufficiently detailed and practical Big Idea grounded in a real manuscript principle.',
    conceptsToDiscuss: ['Apply the relevant Rule to ' + token, 'Explain the practical emotional cost of ' + token, 'Show the better strategic response'],
    directQuotes: [TEST_QUOTE]
  };
}

test('Big Idea queue, verified support, and Ideation-stage transfer work together', async function (t) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE records(store_name TEXT,id TEXT,data TEXT,updated_at TEXT,PRIMARY KEY(store_name,id))');
  let generation = 0;
  let generationPrompt = '';
  const fakeProviders = {
    generate: async function (provider, prompt) {
      if (prompt.startsWith('Maintain a compact')) {
        return { provider: provider, model: 'test', text: JSON.stringify({ summary: 'Prefers useful premises.', likes: ['specificity'], avoids: ['generic summaries'], framingPatterns: ['familiar tension first'], structurePatterns: ['problem then reframe then stake'], selectionRationale: ['practical emotional consequence'] }) };
      }
      const count = Number((prompt.match(/Generate (\d+)/) || [0, 1])[1]);
      generationPrompt = prompt;
      generation++;
      return {
        provider: provider,
        model: 'test',
        sessionId: 'test-session',
        text: JSON.stringify({ ideas: Array.from({ length: count }, function (_, index) { return idea(generation * 100 + index); }) })
      };
    }
  };

  const service = ideationService.setup(db, { providers: fakeProviders, autoStart: false });
  const app = express();
  app.use(express.json());
  app.use('/api/ideation', service.router);
  const server = app.listen(0);
  t.after(function () { server.close(); db.close(); });
  const base = 'http://127.0.0.1:' + server.address().port + '/api/ideation';

  async function request(path, method, body) {
    const response = await fetch(base + path, {
      method: method || 'GET',
      headers: { 'content-type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body)
    });
    const data = await response.json();
    assert.equal(response.ok, true, JSON.stringify(data));
    return data;
  }

  async function waitFor(predicate) {
    for (let i = 0; i < 100; i++) {
      const value = await request('/state');
      if (predicate(value)) return value;
      await new Promise(function (resolve) { setTimeout(resolve, 20); });
    }
    throw new Error('Timed out waiting for Ideation worker');
  }

  let state = await waitFor(function (value) { return value.ideas.length === 10; });
  assert.equal(state.selectedProvider, 'codex');
  assert.equal(state.ideas[0].content_type, 'idea');
  assert.equal(state.ideas[0].script, '');
  assert.equal(state.ideas[0].hook, '');
  assert.equal(state.ideas[0].discussion_angles.length, 3);
  assert.equal(state.ideas[0].verified_quotes.length, 1);
  assert.equal(state.ideas[0].verified_quotes[0].verified, true);
  assert.match(generationPrompt, /Do not write titles, hooks, scripts, outlines/);
  assert.match(generationPrompt, /Rule XIV, The Rule of Crystallized Emotion/);
  assert.match(generationPrompt, /conceptsToDiscuss/);
  assert.match(generationPrompt, /anxiety that someone is losing interest/);
  assert.match(generationPrompt, /DERIVE, DO NOT SUMMARIZE/);
  assert.match(generationPrompt, /RECOGNIZABLE SITUATION \+ HIDDEN\/DEFAULT ASSUMPTION/);
  assert.match(generationPrompt, /REDEFINE:/);
  assert.match(generationPrompt, /Reject any candidate below 4 on non-obviousness/);

  const accepted = state.ideas[0];
  const transfer = await request('/ideas/' + accepted.id + '/transfer', 'POST', {});
  assert.equal(transfer.piece.stage, 'ideation');
  assert.equal(transfer.piece.contentType, 'short');
  assert.deepEqual(transfer.piece.platforms, []);
  assert.match(transfer.piece.notesHtml, /<h3>Big Idea<\/h3>/);
  assert.match(transfer.piece.notesHtml, /Concepts \/ angles to mention/);
  assert.match(transfer.piece.notesHtml, /Direct quotes/);
  const stored = JSON.parse(db.prepare("SELECT data FROM records WHERE store_name='pieces' AND id=?").get(transfer.piece.id).data);
  assert.equal(stored.ideationMetadata.ideaId, accepted.id);
  assert.equal(stored.ideationMetadata.conceptsToDiscuss.length, 3);
  assert.equal(db.prepare("SELECT count(*) AS n FROM ideation_signals WHERE signal_type='sent_to_ideation'").get().n, 1);

  const curatedPiece = Object.assign({}, stored, {
    stage: 'big_ideas',
    title: 'Harvey reframed this around the cost of needless worry',
    notesHtml: '<p>The premise starts with a familiar fear, challenges its evidence, then measures the emotional cost.</p>'
  });
  assert.equal(service.recordBigIdeaPiece(curatedPiece, 'ideation'), true);
  assert.equal(db.prepare("SELECT count(*) AS n FROM ideation_signals WHERE signal_type='curated_big_idea'").get().n, 1);
  const curatedSignal = JSON.parse(db.prepare("SELECT detail FROM ideation_signals WHERE signal_type='curated_big_idea'").get().detail);
  assert.equal(curatedSignal.fromStage, 'ideation');
  assert.equal(curatedSignal.origin, 'generator');
  assert.match(curatedSignal.notes, /familiar fear/);
  service.recordBigIdeaPiece(Object.assign({}, curatedPiece, { notesHtml: '<p>A later, more complete framing with a sharper practical stake.</p>' }), 'big_ideas');
  assert.equal(db.prepare("SELECT count(*) AS n FROM ideation_signals WHERE signal_type='curated_big_idea'").get().n, 1);
  const latestExample = JSON.parse(db.prepare('SELECT snapshot FROM ideation_big_idea_examples WHERE piece_id=?').get(curatedPiece.id).snapshot);
  assert.match(latestExample.notes, /later, more complete framing/);
  assert.equal(service.recordBigIdeaPiece(Object.assign({}, curatedPiece, { stage: 'outline_started' }), 'big_ideas'), false);

  state = await waitFor(function (value) { return value.preferenceProfile.signalCount >= 2; });
  assert.deepEqual(state.preferenceProfile.structurePatterns, ['problem then reframe then stake']);

  state = await waitFor(function (value) { return value.ideas.length === 10; });
  assert.equal(state.ideas.some(function (entry) { return entry.id === accepted.id; }), false);

  await request('/provider', 'PUT', { provider: 'claude' });
  assert.equal((await request('/state')).selectedProvider, 'claude');
  const restarted = ideationService.setup(db, { providers: fakeProviders, autoStart: false });
  assert.equal(restarted.state().ideas.length, 10);
  assert.equal(restarted.state().selectedProvider, 'claude');
  assert.equal(db.prepare("SELECT count(*) AS n FROM ideation_migrations WHERE id='big_idea_cards_v1'").get().n, 1);
});
