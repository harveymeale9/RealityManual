'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const researchIdeaService = require('../src/researchIdeaService');

function database() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE records (
    store_name TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,updated_at TEXT NOT NULL,
    PRIMARY KEY(store_name,id)
  ); CREATE TABLE youtube_competitor_channels (
    channel_id TEXT PRIMARY KEY,input TEXT NOT NULL,title TEXT NOT NULL,snapshot_json TEXT,
    refreshed_at TEXT,created_at TEXT NOT NULL,last_error TEXT
  )`);
  return db;
}

test('research queue uses the complete source pool and only accepts verified Manual/outlier references', async function () {
  const db = database();
  db.prepare('INSERT INTO youtube_competitor_channels VALUES(?,?,?,?,?,?,?)').run(
    'UC1', '@one', 'Caption Channel', JSON.stringify({ title: 'Caption Channel', medianViews: 100,
      videos: [{ id: 'real-video', title: 'Real outlier', views: 900, isOneInTenOutlier: true,
        captionAnalysisAvailable: true, creativeAnalysis: { topic: 'Meaning', bigIdea: 'Belief changes experience.', angle: 'The hidden cause.' } },
      { id: 'no-captions', title: 'Unavailable', views: 1000, isOneInTenOutlier: true, captionAnalysisAvailable: false }]
    }), new Date().toISOString(), new Date().toISOString(), null
  );
  let generation = 0;
  const service = researchIdeaService.setup(db, { autoStart: false, generateIdeas: async function (input) {
    generation++;
    assert.equal(input.schema, researchIdeaService.RESULT_SCHEMA);
    assert.match(input.prompt, /Teal Swan/);
    assert.match(input.prompt, /Mark Manson/);
    assert.match(input.prompt, /Alex O'Connor/);
    assert.match(input.prompt, /The Mindset Mentor Podcast/);
    assert.match(input.prompt, /Chase Hughes/);
    assert.match(input.prompt, /real-video/);
    const count = Number(input.prompt.match(/Generate exactly (\d+)/)[1]);
    return { ideas: Array.from({ length: count }, function (_, index) { return {
      bigIdea: 'Belief does not merely describe experience; it helps construct the meaning that experience can have. Batch ' + generation + ', idea ' + index + '.',
      thinkerNames: index ? ['Teal Swan'] : ['Mark Manson', 'Invented Person'],
      manualConceptIds: ['belief-generates-meaning', 'invented-concept'],
      outlierMatches: [{ videoId: 'real-video', why: 'Both expose belief as the hidden causal layer.' }, { videoId: 'fake-video', why: 'Invented.' }]
    }; }) };
  } });

  service.ensureQueue();
  await service.runWorker();
  const state = service.state();
  assert.equal(state.ideas.length, 10);
  assert.equal(state.sourceCount, 41);
  assert.equal(state.outlierCount, 1);
  assert.deepEqual(state.ideas[0].thinkerNames, ['Mark Manson']);
  assert.equal(state.ideas[0].manualConcepts[0].id, 'belief-generates-meaning');
  assert.deepEqual(state.ideas[0].outlierMatches.map(function (item) { return item.videoId; }), ['real-video']);

  const first = state.ideas[0];
  service.update(first.id, { notes: 'Use the responsibility angle.', approved: true });
  assert.equal(service.state().ideas[0].approved, true);
  assert.equal(service.state().ideas[0].notes, 'Use the responsibility angle.');

  service.reject(first.id);
  await service.runWorker();
  assert.equal(service.state().ideas.length, 10, 'rejection should be replaced back to ten');

  const transferred = service.state().ideas[0];
  service.update(transferred.id, { notes: 'Keep this note.' });
  const piece = service.transfer(transferred.id);
  assert.equal(piece.stage, 'ideation');
  assert.equal(piece.contentType, '');
  assert.match(piece.notesHtml, /1\/10 synthesis/);
  assert.match(piece.notesHtml, /Keep this note/);
  assert.equal(JSON.parse(db.prepare("SELECT data FROM records WHERE store_name='pieces' AND id=?").get(piece.id).data).researchMetadata.ideaId, transferred.id);
  await service.runWorker();
  assert.equal(service.state().ideas.length, 10, 'transfer should be replaced back to ten');
  db.close();
});

test('research generation errors stop and remain retryable instead of spawning job loops', async function () {
  const db = database();
  let fail = true;
  const service = researchIdeaService.setup(db, { autoStart: false, generateIdeas: async function () {
    if (fail) throw new Error('temporary model outage');
    return { ideas: [] };
  } });
  service.ensureQueue();
  await service.runWorker();
  const failed = service.state();
  assert.equal(failed.jobs.length, 1);
  assert.equal(failed.jobs[0].status, 'error');
  assert.match(failed.jobs[0].error, /temporary model outage/);
  assert.equal(db.prepare('SELECT count(*) n FROM research_idea_jobs').get().n, 1);
  db.close();
});

