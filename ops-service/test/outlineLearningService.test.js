'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const serviceModule = require('../src/outlineLearningService');

function piece(stage, notes, extra) {
  return Object.assign({
    id: 'piece-1', seq: 101, title: 'Why wisdom begins with doubt', stage: stage,
    contentType: 'longform', platforms: ['ytlong'], notesHtml: notes,
    createdAt: '2026-09-28T10:00:00.000Z', updatedAt: '2026-09-28T10:00:00.000Z'
  }, extra || {});
}

test('tracks a coalesced Big Idea-to-completed-outline trajectory and learns from the real before/after', async () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE records(store_name TEXT,id TEXT,data TEXT,updated_at TEXT,PRIMARY KEY(store_name,id));
    CREATE TABLE ideation_settings(id INTEGER PRIMARY KEY,selected_provider TEXT);`);
  db.prepare('INSERT INTO ideation_settings VALUES (1,?)').run('codex');
  let prompt = '';
  const providers = {
    generate: async function (provider, value, onActivity) {
      assert.equal(provider, 'codex');
      prompt = value;
      if (onActivity) onActivity('Compared the trajectory');
      return {
        text: JSON.stringify({
          analysis: {
            summary: 'Harvey preserved the reframe and built a causal argument around it.',
            preservedFromIdea: ['The central doubt reframe'], transformations: ['Added a concrete opening'],
            reasoningMoves: ['Moved from example to mechanism'], structureChoices: ['Objection before resolution'],
            styleChoices: ['Short declarative beats'], futureDraftInstructions: ['Open with a recognizable tension'],
            uncertainties: ['One example is not a universal rule']
          },
          profile: {
            summary: 'Preserve the reframe, then build the causal bridge.',
            principles: [{ instruction: 'Preserve the core reframe', evidenceCount: 1, confidence: 'low' }],
            structurePatterns: [{ instruction: 'Move from concrete tension to mechanism', evidenceCount: 1, confidence: 'low' }],
            stylePatterns: [], avoids: []
          }
        }),
        provider: provider, model: 'test'
      };
    }
  };
  const service = serviceModule.setup(db, { providers: providers, autoStart: false, editCoalesceMs: 600000, analysisDelayMs: 0 });

  const big = piece('big_ideas', '<h3>Big Idea</h3><p>Wisdom begins when certainty becomes questionable.</p>');
  service.recordPieceWrite(null, big, 'kanban', '2026-09-28T10:00:00.000Z');
  const edit1 = piece('big_ideas', '<h3>Big Idea</h3><p>Wisdom begins by doubting the assumptions that feel most obvious.</p>');
  service.recordPieceWrite(big, edit1, 'kanban', '2026-09-28T10:01:00.000Z');
  const edit2 = piece('big_ideas', '<h3>Big Idea</h3><p>Wisdom begins by doubting the assumptions that feel most obvious, not by collecting more answers.</p>');
  service.recordPieceWrite(edit1, edit2, 'kanban', '2026-09-28T10:02:00.000Z');

  const started = piece('outline_started', '<h3>Opening</h3><p>Everyone wants certainty.</p><h3>Mechanism</h3><p>Certainty hides assumptions.</p>');
  service.recordPieceWrite(edit2, started, 'kanban', '2026-09-28T11:00:00.000Z');
  const developed = piece('outline_started', '<h3>Opening</h3><p>Everyone wants certainty.</p><h3>Mechanism</h3><p>Certainty hides assumptions.</p><h3>Objection</h3><p>Doubt is not paralysis.</p>');
  service.recordPieceWrite(started, developed, 'kanban', '2026-09-28T11:20:00.000Z');
  const completed = piece('outline_completed', '<h3>Hook</h3><p>The beliefs you never question control you.</p><h3>Mechanism</h3><p>Certainty hides assumptions.</p><h3>Resolution</h3><p>Strategic doubt reveals better moves.</p>');
  service.recordPieceWrite(developed, completed, 'kanban', '2026-09-28T12:00:00.000Z');

  const beforeRun = service.piece('piece-1');
  assert.equal(beforeRun.snapshots.filter(function (row) { return row.stage === 'big_ideas' && row.event_type === 'edit_checkpoint'; }).length, 1);
  assert.match(beforeRun.learningSet.originalBigIdea.notesText, /Wisdom begins when certainty/);
  assert.match(beforeRun.learningSet.developedBigIdea.notesText, /not by collecting more answers/);
  assert.match(beforeRun.learningSet.completedOutline.notesText, /Strategic doubt/);
  assert.equal(beforeRun.trajectory.analysis_status, 'pending');

  assert.equal(await service.runDueJobs(), true);
  const learned = service.piece('piece-1');
  assert.equal(learned.trajectory.analysis_status, 'done');
  assert.equal(learned.trajectory.analysis_revision, 1);
  assert.match(learned.trajectory.analysis.summary, /causal argument/);
  assert.match(prompt, /Wisdom begins when certainty becomes questionable/);
  assert.match(prompt, /Strategic doubt reveals better moves/);
  assert.equal(service.state().profile.exampleCount, 1);
  assert.equal(service.state().counts.analyzed, 1);

  // An autosave containing no editorial change does not spend another model
  // turn, while a genuine later completed-outline edit does. Re-analysis
  // refines this same example rather than inflating the learned sample count.
  service.recordPieceWrite(completed, Object.assign({}, completed, { updatedAt: '2026-09-28T12:05:00.000Z' }), 'kanban', '2026-09-28T12:05:00.000Z');
  assert.equal(await service.runDueJobs(), false);
  const revisedCompleted = piece('outline_completed', completed.notesHtml + '<p>End with the practical decision.</p>');
  service.recordPieceWrite(completed, revisedCompleted, 'kanban', '2026-09-28T12:10:00.000Z');
  assert.equal(await service.runDueJobs(), true);
  assert.equal(service.piece('piece-1').trajectory.analysis_revision, 2);
  assert.equal(service.state().profile.exampleCount, 1);
  db.close();
});

test('backfills current Big Ideas as a baseline without inventing historical stages', function () {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE records(store_name TEXT,id TEXT,data TEXT,updated_at TEXT,PRIMARY KEY(store_name,id));');
  const current = piece('big_ideas', '<p>A real current Big Idea.</p>');
  db.prepare('INSERT INTO records VALUES (?,?,?,?)').run('pieces', current.id, JSON.stringify(current), '2026-09-28T10:00:00.000Z');
  const service = serviceModule.setup(db, { autoStart: false });
  const tracked = service.piece(current.id);
  assert.equal(tracked.snapshots.length, 1);
  assert.equal(tracked.snapshots[0].event_type, 'tracking_baseline');
  assert.equal(tracked.snapshots[0].stage, 'big_ideas');
  assert.equal(service.state().counts.bigIdeas, 1);
  db.close();
});
