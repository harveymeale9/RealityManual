'use strict';

const crypto = require('crypto');
const express = require('express');
const defaultProviders = require('./ideationProviders');

const TRACKED_STAGES = ['big_ideas', 'outline_started', 'outline_completed'];
const DEFAULT_PROFILE = {
  summary: 'No completed Big Idea-to-outline trajectories have been learned yet.',
  principles: [],
  structurePatterns: [],
  stylePatterns: [],
  avoids: [],
  exampleCount: 0,
  updatedAt: null
};

function uuid() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }
function json(value, fallback) { try { return JSON.parse(value); } catch (error) { return fallback; } }
function stringify(value) { return JSON.stringify(value == null ? null : value); }
function clean(value, max) { return String(value || '').trim().slice(0, max || 100000); }
function hash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function isTracked(piece) { return !!(piece && TRACKED_STAGES.indexOf(piece.stage) !== -1 && piece.createdBy !== 'youtube-reviewer'); }
function decodeEntities(text) {
  return String(text || '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); });
}
function stripHtml(value) {
  return decodeEntities(String(value || '')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function wordCount(text) { return (String(text || '').match(/\b[\p{L}\p{N}'’-]+\b/gu) || []).length; }
function headings(html) {
  const out = [];
  String(html || '').replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, function (_, inner) {
    const text = stripHtml(inner);
    if (text) out.push(text.slice(0, 200));
    return _;
  });
  return out.slice(0, 40);
}
function extractJson(text) {
  let raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Outline learner returned no JSON object');
  return JSON.parse(raw.slice(start, end + 1));
}
function relevantPiece(piece) {
  piece = piece || {};
  return {
    id: clean(piece.id, 160),
    seq: Number(piece.seq) || null,
    title: clean(piece.title, 3000),
    stage: clean(piece.stage, 80),
    contentType: clean(piece.contentType, 80),
    platforms: Array.isArray(piece.platforms) ? piece.platforms.slice(0, 20) : [],
    notesHtml: clean(piece.notesHtml, 80000),
    notesText: stripHtml(piece.notesHtml),
    ideationMetadata: piece.ideationMetadata && typeof piece.ideationMetadata === 'object' ? piece.ideationMetadata : null,
    createdAt: piece.createdAt || null,
    updatedAt: piece.updatedAt || null
  };
}
function contentHash(piece) {
  const value = relevantPiece(piece);
  return hash(stringify({
    title: value.title, contentType: value.contentType, platforms: value.platforms,
    notesHtml: value.notesHtml, ideationMetadata: value.ideationMetadata
  }));
}
function changeSummary(before, after) {
  const a = relevantPiece(before), b = relevantPiece(after);
  const changed = [];
  ['title', 'contentType', 'notesHtml'].forEach(function (field) { if (a[field] !== b[field]) changed.push(field); });
  if (stringify(a.platforms) !== stringify(b.platforms)) changed.push('platforms');
  return {
    changedFields: changed,
    title: a.title === b.title ? null : { before: a.title, after: b.title },
    words: { before: wordCount(a.notesText), after: wordCount(b.notesText), delta: wordCount(b.notesText) - wordCount(a.notesText) },
    characters: { before: a.notesText.length, after: b.notesText.length, delta: b.notesText.length - a.notesText.length },
    headings: { before: headings(a.notesHtml), after: headings(b.notesHtml) }
  };
}

function setup(db, options) {
  options = options || {};
  const providerEngine = options.providers || defaultProviders;
  const autoStart = options.autoStart !== false;
  const editCoalesceMs = Number(options.editCoalesceMs == null ? 10 * 60 * 1000 : options.editCoalesceMs);
  const analysisDelayMs = Number(options.analysisDelayMs == null ? 10 * 60 * 1000 : options.analysisDelayMs);

  db.exec(`
    CREATE TABLE IF NOT EXISTS outline_learning_snapshots (
      id TEXT PRIMARY KEY, piece_id TEXT NOT NULL, sequence INTEGER NOT NULL,
      stage TEXT NOT NULL, event_type TEXT NOT NULL, source TEXT NOT NULL,
      content_hash TEXT NOT NULL, snapshot TEXT NOT NULL, change_summary TEXT NOT NULL,
      captured_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(piece_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_outline_snapshots_piece ON outline_learning_snapshots(piece_id, sequence);
    CREATE TABLE IF NOT EXISTS outline_learning_trajectories (
      piece_id TEXT PRIMARY KEY, status TEXT NOT NULL,
      initial_snapshot_id TEXT, outline_started_snapshot_id TEXT,
      completed_snapshot_id TEXT, latest_snapshot_id TEXT NOT NULL,
      analysis_status TEXT NOT NULL DEFAULT 'not_ready', analysis_revision INTEGER NOT NULL DEFAULT 0,
      analysis TEXT NOT NULL DEFAULT '{}', analysis_error TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS outline_learning_profile (
      id INTEGER PRIMARY KEY CHECK (id=1), profile TEXT NOT NULL,
      example_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS outline_learning_jobs (
      piece_id TEXT PRIMARY KEY, status TEXT NOT NULL, provider TEXT NOT NULL,
      not_before TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      rerun_requested INTEGER NOT NULL DEFAULT 0, activity TEXT NOT NULL DEFAULT '[]',
      error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  db.prepare('INSERT OR IGNORE INTO outline_learning_profile (id,profile,example_count,updated_at) VALUES (1,?,?,?)')
    .run(stringify(DEFAULT_PROFILE), 0, now());
  db.prepare("UPDATE outline_learning_jobs SET status='pending',updated_at=? WHERE status='running'").run(now());

  const q = {
    latest: db.prepare('SELECT * FROM outline_learning_snapshots WHERE piece_id=? ORDER BY sequence DESC LIMIT 1'),
    previous: db.prepare('SELECT * FROM outline_learning_snapshots WHERE piece_id=? AND sequence<? ORDER BY sequence DESC LIMIT 1'),
    snapshots: db.prepare('SELECT * FROM outline_learning_snapshots WHERE piece_id=? ORDER BY sequence ASC'),
    trajectory: db.prepare('SELECT * FROM outline_learning_trajectories WHERE piece_id=?'),
    trajectories: db.prepare('SELECT * FROM outline_learning_trajectories ORDER BY updated_at DESC'),
    profile: db.prepare('SELECT * FROM outline_learning_profile WHERE id=1'),
    nextJob: db.prepare("SELECT * FROM outline_learning_jobs WHERE status='pending' AND not_before<=? ORDER BY not_before ASC LIMIT 1"),
    earliestJob: db.prepare("SELECT not_before FROM outline_learning_jobs WHERE status='pending' ORDER BY not_before ASC LIMIT 1")
  };

  function selectedProvider() {
    try {
      const row = db.prepare('SELECT selected_provider FROM ideation_settings WHERE id=1').get();
      if (row && (row.selected_provider === 'claude' || row.selected_provider === 'codex')) return row.selected_provider;
    } catch (error) { /* Ideation is optional in isolated tests. */ }
    return 'codex';
  }

  function decodedSnapshot(row) {
    if (!row) return null;
    return Object.assign({}, row, { snapshot: json(row.snapshot, {}), change_summary: json(row.change_summary, {}) });
  }

  function updateTrajectory(snapshotRow) {
    const stamp = snapshotRow.updated_at;
    let trajectory = q.trajectory.get(snapshotRow.piece_id);
    if (!trajectory) {
      db.prepare(`INSERT INTO outline_learning_trajectories
        (piece_id,status,initial_snapshot_id,outline_started_snapshot_id,completed_snapshot_id,latest_snapshot_id,created_at,updated_at,completed_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
          snapshotRow.piece_id, snapshotRow.stage,
          snapshotRow.stage === 'big_ideas' ? snapshotRow.id : null,
          snapshotRow.stage === 'outline_started' ? snapshotRow.id : null,
          snapshotRow.stage === 'outline_completed' ? snapshotRow.id : null,
          snapshotRow.id, stamp, stamp, snapshotRow.stage === 'outline_completed' ? stamp : null
        );
      return;
    }
    const initial = trajectory.initial_snapshot_id || (snapshotRow.stage === 'big_ideas' ? snapshotRow.id : null);
    const started = snapshotRow.stage === 'outline_started' ? snapshotRow.id : trajectory.outline_started_snapshot_id;
    const completed = snapshotRow.stage === 'outline_completed' ? snapshotRow.id : trajectory.completed_snapshot_id;
    db.prepare(`UPDATE outline_learning_trajectories SET status=?,initial_snapshot_id=?,outline_started_snapshot_id=?,
      completed_snapshot_id=?,latest_snapshot_id=?,updated_at=?,completed_at=COALESCE(completed_at,?) WHERE piece_id=?`)
      .run(snapshotRow.stage, initial, started, completed, snapshotRow.id, stamp,
        snapshotRow.stage === 'outline_completed' ? stamp : null, snapshotRow.piece_id);
  }

  function insertSnapshot(piece, eventType, source, before, stamp) {
    const value = relevantPiece(piece);
    const latest = q.latest.get(value.id);
    const sequence = latest ? Number(latest.sequence) + 1 : 1;
    const row = {
      id: uuid(), piece_id: value.id, sequence: sequence, stage: value.stage,
      event_type: eventType, source: source || 'kanban', content_hash: contentHash(piece),
      snapshot: stringify(value), change_summary: stringify(changeSummary(before || {}, piece)),
      captured_at: stamp, updated_at: stamp
    };
    db.prepare(`INSERT INTO outline_learning_snapshots
      (id,piece_id,sequence,stage,event_type,source,content_hash,snapshot,change_summary,captured_at,updated_at)
      VALUES (@id,@piece_id,@sequence,@stage,@event_type,@source,@content_hash,@snapshot,@change_summary,@captured_at,@updated_at)`).run(row);
    updateTrajectory(row);
    return row;
  }

  function captureEdit(piece, source, before, stamp) {
    const latest = q.latest.get(piece.id);
    const nextHash = contentHash(piece);
    if (latest && latest.content_hash === nextHash) return latest;
    const recentEdit = latest && latest.event_type === 'edit_checkpoint' && latest.stage === piece.stage &&
      (new Date(stamp).getTime() - new Date(latest.updated_at).getTime()) <= editCoalesceMs;
    if (!recentEdit) return insertSnapshot(piece, 'edit_checkpoint', source, before, stamp);

    const previous = q.previous.get(piece.id, latest.sequence);
    const baseline = previous ? json(previous.snapshot, {}) : (before || {});
    const value = relevantPiece(piece);
    db.prepare(`UPDATE outline_learning_snapshots SET source=?,content_hash=?,snapshot=?,change_summary=?,updated_at=? WHERE id=?`)
      .run(source || 'kanban', nextHash, stringify(value), stringify(changeSummary(baseline, piece)), stamp, latest.id);
    const updated = Object.assign({}, latest, { source: source || 'kanban', content_hash: nextHash, snapshot: stringify(value), updated_at: stamp });
    updateTrajectory(updated);
    return updated;
  }

  let workerBusy = false;
  let workerTimer = null;

  function scheduleWorker() {
    if (!autoStart) return;
    const row = q.earliestJob.get();
    if (!row) return;
    if (workerTimer) clearTimeout(workerTimer);
    const wait = Math.max(25, Math.min(60 * 1000, new Date(row.not_before).getTime() - Date.now()));
    workerTimer = setTimeout(function () { workerTimer = null; runDueJobs(); }, wait);
    if (workerTimer.unref) workerTimer.unref();
  }

  function queueAnalysis(pieceId, stamp) {
    const trajectory = q.trajectory.get(pieceId);
    if (!trajectory || !trajectory.initial_snapshot_id || !trajectory.completed_snapshot_id) return false;
    const notBefore = new Date(new Date(stamp).getTime() + analysisDelayMs).toISOString();
    const provider = selectedProvider();
    const existing = db.prepare('SELECT * FROM outline_learning_jobs WHERE piece_id=?').get(pieceId);
    if (!existing) {
      db.prepare(`INSERT INTO outline_learning_jobs
        (piece_id,status,provider,not_before,created_at,updated_at) VALUES (?,'pending',?,?,?,?)`)
        .run(pieceId, provider, notBefore, stamp, stamp);
    } else if (existing.status === 'running') {
      db.prepare("UPDATE outline_learning_jobs SET provider=?,not_before=?,rerun_requested=1,updated_at=? WHERE piece_id=?")
        .run(provider, notBefore, stamp, pieceId);
    } else {
      db.prepare("UPDATE outline_learning_jobs SET status='pending',provider=?,not_before=?,rerun_requested=0,error=NULL,updated_at=? WHERE piece_id=?")
        .run(provider, notBefore, stamp, pieceId);
    }
    db.prepare("UPDATE outline_learning_trajectories SET analysis_status='pending',analysis_error=NULL,updated_at=? WHERE piece_id=?")
      .run(stamp, pieceId);
    scheduleWorker();
    return true;
  }

  function recordPieceWrite(before, after, source, suppliedStamp) {
    const stamp = suppliedStamp || now();
    const beforeTracked = isTracked(before);
    const afterTracked = isTracked(after);
    const completedContentChanged = afterTracked && after.stage === 'outline_completed' &&
      (!beforeTracked || before.stage !== after.stage || contentHash(before) !== contentHash(after));
    if (!beforeTracked && !afterTracked) return false;

    db.transaction(function () {
      if (beforeTracked && (!afterTracked || before.stage !== after.stage)) {
        insertSnapshot(before, 'stage_exit', source, before, stamp);
      }
      if (afterTracked) {
        if (!beforeTracked || before.stage !== after.stage) insertSnapshot(after, 'stage_entry', source, before, stamp);
        else captureEdit(after, source, before, stamp);
      }
    })();
    if (completedContentChanged) queueAnalysis(after.id, stamp);
    return true;
  }

  function trajectoryPayload(pieceId) {
    const trajectory = q.trajectory.get(pieceId);
    if (!trajectory) return null;
    const rows = q.snapshots.all(pieceId).map(decodedSnapshot);
    function stageRows(stage) { return rows.filter(function (row) { return row.stage === stage; }); }
    const big = stageRows('big_ideas'), started = stageRows('outline_started'), completed = stageRows('outline_completed');
    const meaningfulBig = big.filter(function (row) { return row.snapshot.title || row.snapshot.notesText; });
    return {
      trajectory: Object.assign({}, trajectory, { analysis: json(trajectory.analysis, {}) }),
      snapshots: rows,
      learningSet: {
        // A brand-new modal can technically autosave an empty shell before
        // Harvey enters the premise. Keep that audit row, but train from the
        // first snapshot containing actual authored material.
        originalBigIdea: meaningfulBig.length ? meaningfulBig[0].snapshot : (big.length ? big[0].snapshot : null),
        developedBigIdea: big.length ? big[big.length - 1].snapshot : null,
        outlineStarted: started.length ? started[0].snapshot : null,
        developedOutline: started.length ? started[started.length - 1].snapshot : null,
        completedOutline: completed.length ? completed[completed.length - 1].snapshot : null
      }
    };
  }

  function normalizeProfile(raw, previous, count) {
    const profile = raw && typeof raw === 'object' ? raw : {};
    return {
      summary: clean(profile.summary || previous.summary, 3000),
      principles: Array.isArray(profile.principles) ? profile.principles.slice(0, 30) : previous.principles || [],
      structurePatterns: Array.isArray(profile.structurePatterns) ? profile.structurePatterns.slice(0, 30) : previous.structurePatterns || [],
      stylePatterns: Array.isArray(profile.stylePatterns) ? profile.stylePatterns.slice(0, 30) : previous.stylePatterns || [],
      avoids: Array.isArray(profile.avoids) ? profile.avoids.slice(0, 30) : previous.avoids || [],
      exampleCount: count,
      updatedAt: now()
    };
  }

  async function analyze(job) {
    const payload = trajectoryPayload(job.piece_id);
    if (!payload || !payload.learningSet.originalBigIdea || !payload.learningSet.completedOutline) {
      throw new Error('A Big Ideas baseline and completed outline are required');
    }
    const profileRow = q.profile.get();
    const currentProfile = json(profileRow.profile, DEFAULT_PROFILE);
    const prompt = `You are maintaining Harvey's private outline-development learning system for The Reality Manual. Compare one real content piece as Harvey transformed it from a Big Idea into a completed outline. Learn transferable editorial decisions, reasoning structure, sequencing, level of detail, tone, and corrections. Do not judge the topic itself, copy topic-specific wording into a general rule, or promote a single choice into a universal preference. Preserve uncertainty and use the existing profile's evidence counts/confidence where present. The snapshots are authoritative examples of Harvey's work.

Return strict JSON only with this schema:
{"analysis":{"summary":"...","preservedFromIdea":["..."],"transformations":["..."],"reasoningMoves":["..."],"structureChoices":["..."],"styleChoices":["..."],"futureDraftInstructions":["..."],"uncertainties":["..."]},"profile":{"summary":"...","principles":[{"instruction":"...","evidenceCount":1,"confidence":"low|medium|high"}],"structurePatterns":[{"instruction":"...","evidenceCount":1,"confidence":"low|medium|high"}],"stylePatterns":[{"instruction":"...","evidenceCount":1,"confidence":"low|medium|high"}],"avoids":[{"instruction":"...","evidenceCount":1,"confidence":"low|medium|high"}]}}

CURRENT_PROFILE=${JSON.stringify(currentProfile)}
TRAJECTORY=${JSON.stringify(payload.learningSet)}`;
    const activity = [];
    const result = await providerEngine.generate(job.provider, prompt, function (line) {
      activity.push(clean(line, 300));
      db.prepare('UPDATE outline_learning_jobs SET activity=?,updated_at=? WHERE piece_id=?')
        .run(stringify(activity.slice(-100)), now(), job.piece_id);
    });
    const parsed = extractJson(result.text);
    if (!parsed.analysis || !parsed.profile) throw new Error('Outline learner response was missing analysis or profile');
    const freshJob = db.prepare('SELECT * FROM outline_learning_jobs WHERE piece_id=?').get(job.piece_id);
    // Re-analysis after Harvey makes a later edit to the same completed
    // outline refines one example; it must not pretend the system has seen a
    // second independent trajectory or inflate evidence counts.
    const nextCount = Number(profileRow.example_count || 0) +
      (Number(payload.trajectory.analysis_revision || 0) > 0 ? 0 : 1);
    const profile = normalizeProfile(parsed.profile, currentProfile, nextCount);
    const stamp = now();
    db.transaction(function () {
      db.prepare(`UPDATE outline_learning_trajectories SET analysis_status='done',analysis_revision=analysis_revision+1,
        analysis=?,analysis_error=NULL,updated_at=? WHERE piece_id=?`).run(stringify(parsed.analysis), stamp, job.piece_id);
      db.prepare('UPDATE outline_learning_profile SET profile=?,example_count=?,updated_at=? WHERE id=1')
        .run(stringify(profile), nextCount, stamp);
      if (freshJob && freshJob.rerun_requested) {
        db.prepare("UPDATE outline_learning_jobs SET status='pending',rerun_requested=0,error=NULL,updated_at=? WHERE piece_id=?")
          .run(stamp, job.piece_id);
      } else {
        db.prepare("UPDATE outline_learning_jobs SET status='done',rerun_requested=0,error=NULL,updated_at=? WHERE piece_id=?")
          .run(stamp, job.piece_id);
      }
    })();
  }

  async function runDueJobs() {
    if (workerBusy) return false;
    workerBusy = true;
    let ran = false;
    try {
      for (;;) {
        const job = q.nextJob.get(now());
        if (!job) break;
        ran = true;
        db.prepare("UPDATE outline_learning_jobs SET status='running',attempts=attempts+1,error=NULL,updated_at=? WHERE piece_id=?")
          .run(now(), job.piece_id);
        db.prepare("UPDATE outline_learning_trajectories SET analysis_status='running',updated_at=? WHERE piece_id=?")
          .run(now(), job.piece_id);
        try {
          await analyze(job);
          console.log('[outline-learning] analyzed', job.piece_id, 'with', job.provider);
        } catch (error) {
          const message = clean(error && error.message || error, 2000);
          db.prepare("UPDATE outline_learning_jobs SET status='error',error=?,updated_at=? WHERE piece_id=?")
            .run(message, now(), job.piece_id);
          db.prepare("UPDATE outline_learning_trajectories SET analysis_status='error',analysis_error=?,updated_at=? WHERE piece_id=?")
            .run(message, now(), job.piece_id);
          console.error('[outline-learning] analysis failed for', job.piece_id, message);
        }
      }
    } finally {
      workerBusy = false;
      scheduleWorker();
    }
    return ran;
  }

  function backfillCurrentBigIdeas() {
    const rows = db.prepare("SELECT data,updated_at FROM records WHERE store_name='pieces'").all();
    rows.forEach(function (row) {
      const piece = json(row.data, {});
      if (!isTracked(piece) || piece.stage !== 'big_ideas' || q.trajectory.get(piece.id)) return;
      insertSnapshot(piece, 'tracking_baseline', 'bootstrap', {}, row.updated_at || now());
    });
  }

  function publicState() {
    const profileRow = q.profile.get();
    const trajectories = q.trajectories.all();
    const counts = { tracked: trajectories.length, bigIdeas: 0, outlineStarted: 0, completed: 0, analyzed: 0, pending: 0, errors: 0 };
    trajectories.forEach(function (row) {
      if (row.status === 'big_ideas') counts.bigIdeas++;
      if (row.status === 'outline_started') counts.outlineStarted++;
      if (row.status === 'outline_completed') counts.completed++;
      if (row.analysis_status === 'done') counts.analyzed++;
      if (row.analysis_status === 'pending' || row.analysis_status === 'running') counts.pending++;
      if (row.analysis_status === 'error') counts.errors++;
    });
    return {
      profile: json(profileRow.profile, DEFAULT_PROFILE), counts: counts,
      trajectories: trajectories.map(function (row) {
        const latest = decodedSnapshot(q.latest.get(row.piece_id));
        return {
          pieceId: row.piece_id, title: latest && latest.snapshot.title || '', stage: row.status, analysisStatus: row.analysis_status,
          analysisRevision: row.analysis_revision, updatedAt: row.updated_at, completedAt: row.completed_at
        };
      })
    };
  }

  function agentContext() {
    const row = q.profile.get();
    const profile = json(row.profile, DEFAULT_PROFILE);
    if (!row.example_count) return '';
    return '[Outline-development learning profile, inferred from ' + row.example_count + ' Harvey-completed trajectory/trajectories. Treat low-confidence one-example patterns as provisional.]\n' +
      JSON.stringify(profile) + '\n[End outline-development learning profile]\n\n';
  }

  const router = express.Router();
  router.get('/state', function (req, res) { res.json(publicState()); });
  router.get('/pieces/:id', function (req, res) {
    const payload = trajectoryPayload(req.params.id);
    if (!payload) return res.status(404).json({ error: 'not_found' });
    res.json(payload);
  });
  router.post('/jobs/:id/retry', function (req, res) {
    const trajectory = q.trajectory.get(req.params.id);
    if (!trajectory || !trajectory.initial_snapshot_id || !trajectory.completed_snapshot_id) {
      return res.status(400).json({ error: 'trajectory_not_ready' });
    }
    queueAnalysis(req.params.id, now());
    res.json({ ok: true });
  });

  backfillCurrentBigIdeas();
  if (autoStart) scheduleWorker();
  return {
    router: router,
    recordPieceWrite: recordPieceWrite,
    runDueJobs: runDueJobs,
    state: publicState,
    piece: trajectoryPayload,
    agentContext: agentContext
  };
}

module.exports = { setup: setup, stripHtml: stripHtml, relevantPiece: relevantPiece, TRACKED_STAGES: TRACKED_STAGES };
