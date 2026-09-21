'use strict';

const express = require('express');
const crypto = require('crypto');
const corpus = require('./ideationCorpus');
const doctrine = require('./ideationDoctrine');
const bigIdeaMethod = require('./ideationBigIdeaMethod');
const providers = require('./ideationProviders');

const TARGET_ACTIVE = 10;
const BIG_IDEA_MIGRATION = 'big_idea_cards_v1';
const RULE_NAME_MIGRATION = 'rule_names_not_numbers_v1';
const DEFAULT_PROFILE = {
  summary: 'No Big Idea preferences have been learned yet. Prioritize specific, useful applications of the manuscript.',
  likes: [], avoids: [], framingPatterns: [], structurePatterns: [], selectionRationale: [],
  updatedAt: null, signalCount: 0
};

function now() { return new Date().toISOString(); }
function uuid() { return crypto.randomUUID(); }
function json(value, fallback) { try { return JSON.parse(value); } catch (e) { return fallback; } }
function stringify(value) { return JSON.stringify(value == null ? null : value); }
function clean(value, max) { return String(value || '').trim().slice(0, max || 100000); }
function htmlEscape(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

function extractJson(text) {
  let raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const starts = [raw.indexOf('{'), raw.indexOf('[')].filter(function (n) { return n >= 0; });
  if (!starts.length) throw new Error('Provider returned no JSON');
  raw = raw.slice(Math.min.apply(Math, starts));
  const objectEnd = raw.lastIndexOf('}'), arrayEnd = raw.lastIndexOf(']');
  return JSON.parse(raw.slice(0, Math.max(objectEnd, arrayEnd) + 1));
}

function internalLabel(bigIdea) {
  const first = clean(bigIdea, 5000).split(/(?<=[.!?])\s+/)[0] || 'Big Idea';
  return first.length <= 140 ? first : first.slice(0, 137).trimEnd() + '…';
}

function replaceRuleNumberReferences(value) {
  let result = String(value || '');
  doctrine.RULES.forEach(function (rule) {
    const name = rule[0] === 'X' ? 'Tripartite Rule' : 'Rule of ' + rule[1];
    result = result.replace(new RegExp('\\bRule ' + rule[0] + '\\b', 'gi'), name);
  });
  return result;
}

function notesHtml(idea) {
  const angles = json(idea.discussion_angles, []);
  const quotes = json(idea.verified_quotes, []);
  return '<h3>Big Idea</h3><p>' + htmlEscape(idea.big_idea) + '</p>' +
    '<h3>Concepts / angles to mention</h3><ul>' + angles.map(function (angle) { return '<li>' + htmlEscape(angle) + '</li>'; }).join('') + '</ul>' +
    '<h3>Direct quotes</h3>' + quotes.map(function (quote) {
      return '<blockquote>&ldquo;' + htmlEscape(quote.text) + '&rdquo;<br><small>Page ' + Number(quote.page) + '</small></blockquote>';
    }).join('');
}

function setup(db, options) {
  options = options || {};
  const providerEngine = options.providers || providers;
  const autoStart = options.autoStart !== false;

  db.exec(`
    CREATE TABLE IF NOT EXISTS ideation_settings (
      id INTEGER PRIMARY KEY CHECK (id=1), selected_provider TEXT NOT NULL DEFAULT 'codex',
      preference_profile TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ideation_ideas (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, sort_order REAL NOT NULL,
      content_type TEXT NOT NULL, estimated_runtime TEXT NOT NULL, runtime_seconds INTEGER NOT NULL,
      title TEXT NOT NULL, alternative_titles TEXT NOT NULL DEFAULT '[]', big_idea TEXT NOT NULL, hook TEXT NOT NULL,
      manuscript_sources TEXT NOT NULL, relevant_sections TEXT NOT NULL, relevant_pages TEXT NOT NULL,
      verified_quotes TEXT NOT NULL, paraphrases TEXT NOT NULL, script TEXT NOT NULL,
      discussion_angles TEXT NOT NULL DEFAULT '[]',
      provider TEXT NOT NULL, model TEXT NOT NULL, generation_meta TEXT NOT NULL,
      revision_number INTEGER NOT NULL DEFAULT 0, edited INTEGER NOT NULL DEFAULT 0,
      destination_piece_id TEXT, exit_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ideation_active ON ideation_ideas(status, sort_order);
    CREATE TABLE IF NOT EXISTS ideation_feedback (
      id TEXT PRIMARY KEY, idea_id TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL,
      strength REAL NOT NULL, revision_number INTEGER, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ideation_revisions (
      id TEXT PRIMARY KEY, idea_id TEXT NOT NULL, revision_number INTEGER NOT NULL,
      kind TEXT NOT NULL, snapshot TEXT NOT NULL, diff TEXT NOT NULL,
      provider TEXT, model TEXT, feedback_id TEXT, created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ideation_revision ON ideation_revisions(idea_id, revision_number);
    CREATE TABLE IF NOT EXISTS ideation_signals (
      id TEXT PRIMARY KEY, idea_id TEXT, signal_type TEXT NOT NULL, strength REAL NOT NULL,
      detail TEXT NOT NULL, processed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ideation_big_idea_examples (
      piece_id TEXT PRIMARY KEY, snapshot TEXT NOT NULL,
      first_selected_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ideation_jobs (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, provider TEXT NOT NULL,
      idea_id TEXT, requested_count INTEGER NOT NULL DEFAULT 1, activity TEXT NOT NULL,
      error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ideation_migrations (
      id TEXT PRIMARY KEY, applied_at TEXT NOT NULL
    );
  `);
  try { db.exec("ALTER TABLE ideation_ideas ADD COLUMN alternative_titles TEXT NOT NULL DEFAULT '[]'"); } catch (e) { /* already exists */ }
  try { db.exec("ALTER TABLE ideation_ideas ADD COLUMN discussion_angles TEXT NOT NULL DEFAULT '[]'"); } catch (e) { /* already exists */ }
  db.prepare('INSERT OR IGNORE INTO ideation_settings (id, selected_provider, preference_profile, updated_at) VALUES (1, ?, ?, ?)')
    .run('codex', stringify(DEFAULT_PROFILE), now());

  // Preserve old full-script proposals and their feedback as history, but
  // replace the active queue exactly once with the new Big-Idea-only shape.
  if (!db.prepare('SELECT 1 FROM ideation_migrations WHERE id=?').get(BIG_IDEA_MIGRATION)) {
    db.transaction(function () {
      db.prepare("UPDATE ideation_ideas SET status='superseded',exit_reason='big_idea_only_overhaul',updated_at=? WHERE status='active'").run(now());
      db.prepare("UPDATE ideation_jobs SET status='cancelled',updated_at=? WHERE status IN ('pending','running','error')").run(now());
      db.prepare('INSERT INTO ideation_migrations (id,applied_at) VALUES (?,?)').run(BIG_IDEA_MIGRATION, now());
    })();
  }

  const q = {
    settings: db.prepare('SELECT * FROM ideation_settings WHERE id=1'),
    active: db.prepare("SELECT * FROM ideation_ideas WHERE status='active' ORDER BY sort_order ASC, created_at ASC"),
    allIdeas: db.prepare('SELECT * FROM ideation_ideas ORDER BY created_at DESC'),
    idea: db.prepare('SELECT * FROM ideation_ideas WHERE id=?'),
    jobs: db.prepare("SELECT * FROM ideation_jobs WHERE status IN ('pending','running','error') ORDER BY created_at ASC"),
    pieces: db.prepare("SELECT data FROM records WHERE store_name='pieces' ORDER BY updated_at DESC"),
    feedback: db.prepare('SELECT * FROM ideation_feedback WHERE idea_id=? ORDER BY created_at ASC'),
    bigIdeaExamples: db.prepare('SELECT snapshot FROM ideation_big_idea_examples ORDER BY updated_at DESC LIMIT 60'),
    unprocessedSignals: db.prepare('SELECT * FROM ideation_signals WHERE processed=0 ORDER BY created_at ASC LIMIT 40')
  };
  db.prepare("UPDATE ideation_jobs SET status='pending',updated_at=? WHERE status='running'").run(now());
  let workerBusy = false;
  let profileRerunNeeded = false;

  // One-time correction for already-visible cards created before Harvey's
  // naming rule: replace opaque Roman numerals with the actual Rule names,
  // keep an auditable revision, and retain his instruction as a global
  // learning signal for the preference profile.
  if (!db.prepare('SELECT 1 FROM ideation_migrations WHERE id=?').get(RULE_NAME_MIGRATION)) {
    db.transaction(function () {
      const rows = db.prepare("SELECT * FROM ideation_ideas WHERE status='active'").all();
      const update = db.prepare('UPDATE ideation_ideas SET title=?,big_idea=?,revision_number=?,updated_at=? WHERE id=?');
      const revisionInsert = db.prepare('INSERT INTO ideation_revisions (id,idea_id,revision_number,kind,snapshot,diff,provider,model,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
      rows.forEach(function (idea) {
        const revised = replaceRuleNumberReferences(idea.big_idea);
        if (revised === idea.big_idea) return;
        const revision = Number(idea.revision_number || 0) + 1;
        const stamp = now();
        update.run(internalLabel(revised), revised, revision, stamp, idea.id);
        revisionInsert.run(uuid(), idea.id, revision, 'rule_name_normalization', stringify({ bigIdea: revised }), stringify({ bigIdea: { before: idea.big_idea, after: revised } }), idea.provider, idea.model, stamp);
      });
      addSignal(null, 'explicit_feedback', 1, {
        feedback: 'Always identify a Rule by its actual name, such as Rule of Freedom or Rule of Crystallized Emotion. Never call it Rule VIII, Rule XIV, or use any other Roman-numeral label in a Big Idea.',
        scope: 'global_rule_naming'
      });
      db.prepare('INSERT INTO ideation_migrations (id,applied_at) VALUES (?,?)').run(RULE_NAME_MIGRATION, now());
    })();
  }

  function decodeIdea(row) {
    if (!row) return null;
    const out = Object.assign({}, row);
    out.discussion_angles = json(row.discussion_angles, []);
    out.verified_quotes = json(row.verified_quotes, []);
    out.generation_meta = json(row.generation_meta, {});
    out.feedback = q.feedback.all(row.id);
    return out;
  }

  function addSignal(ideaId, type, strength, detail) {
    db.prepare('INSERT INTO ideation_signals (id,idea_id,signal_type,strength,detail,created_at) VALUES (?,?,?,?,?,?)')
      .run(uuid(), ideaId || null, type, strength, stringify(detail || {}), now());
  }

  function addFeedback(idea, value, source) {
    const text = clean(value, 6000);
    if (!text) throw new Error('Feedback is required.');
    const feedbackSource = source === 'voice' ? 'voice' : 'typed';
    const id = uuid(), stamp = now();
    db.transaction(function () {
      db.prepare('INSERT INTO ideation_feedback (id,idea_id,text,source,strength,created_at) VALUES (?,?,?,?,?,?)')
        .run(id, idea.id, text, feedbackSource, 1, stamp);
      addSignal(idea.id, 'explicit_feedback', 1, {
        feedback: text,
        source: feedbackSource,
        bigIdea: idea.big_idea,
        conceptsToDiscuss: json(idea.discussion_angles, [])
      });
    })();
    enqueue('profile', q.settings.get().selected_provider, 1);
    return db.prepare('SELECT * FROM ideation_feedback WHERE id=?').get(id);
  }

  function capturePipelineSignals() {
    const ranks = ['archived','ideation','big_ideas','outline_started','outline_completed','filmed','edited','uploaded','processed','final_check','scheduled','live'];
    const pieces = new Map(q.pieces.all().map(function (row) { const piece = json(row.data, {}); return [piece.id, piece]; }));
    db.prepare("SELECT id,destination_piece_id,exit_reason FROM ideation_ideas WHERE status='transferred' AND destination_piece_id IS NOT NULL").all().forEach(function (idea) {
      const piece = pieces.get(idea.destination_piece_id);
      if (!piece || ranks.indexOf(piece.stage) <= ranks.indexOf(idea.exit_reason)) return;
      const type = 'pipeline_progress_' + piece.stage;
      if (!db.prepare('SELECT 1 FROM ideation_signals WHERE idea_id=? AND signal_type=?').get(idea.id, type)) {
        addSignal(idea.id, type, piece.stage === 'live' ? 1 : 0.65, { stage: piece.stage, pieceId: piece.id });
      }
    });
  }

  function state() {
    capturePipelineSignals();
    const settings = q.settings.get();
    return {
      target: TARGET_ACTIVE,
      selectedProvider: settings.selected_provider,
      preferenceProfile: json(settings.preference_profile, DEFAULT_PROFILE),
      ideas: q.active.all().map(decodeIdea),
      jobs: q.jobs.all().map(function (job) { return Object.assign({}, job, { activity: json(job.activity, []) }); })
    };
  }

  function existingContext() {
    const pieces = q.pieces.all().map(function (row) { return json(row.data, {}); });
    return pieces.map(function (piece) {
      return { angle: clean(piece.ideationMetadata && piece.ideationMetadata.bigIdea || corpus.stripHtml(piece.notesHtml), 700), stage: piece.stage };
    }).concat(q.allIdeas.all().map(function (idea) { return { angle: idea.big_idea, status: idea.status }; }));
  }

  function basePrompt(provider) {
    const settings = q.settings.get();
    return `You are the Big Idea engine for The Reality Manual. Generate only strong editorial premises that Harvey can turn into content himself. Do not write titles, hooks, scripts, outlines, timestamps, runtimes, formats, camera directions, or production instructions.

Read the canonical completed manuscript at THE_REALITY_MANUAL_COMPLETE_MANUSCRIPT.txt. Ground every idea in its real arguments, rules, examples, terminology, and reasoning. Direct quotes must be copied exactly from the manuscript; never invent or lightly rewrite a quote.

Always identify every Rule by its actual name, such as "Rule of Freedom," "Rule of Subconscious Action," or "Rule of Crystallized Emotion." Never use Roman-numeral references such as "Rule VIII," "Rule XIV," or "Under Rule XIV" in a Big Idea or its concepts. The numeral is not meaningful to the reader. This naming requirement does not authorize changing a verbatim manuscript quotation.

The following permanent doctrine map identifies reusable intellectual anchors:
${doctrine.promptText()}

A Big Idea is one simple, powerful manuscript-derived reframe of a familiar subject, question, assumption, or public conversation. It changes the definition, replaces the conventional question, or reveals what is actually happening beneath the usual description. It is not a detailed application, niche scenario, miniature outline, or piece of generic advice.

${bigIdeaMethod.promptText()}

Each Big Idea must stand alone, normally in one to three concise sentences. A broader premise that genuinely requires long-form development may use up to six, but do not pre-write its outline. Root the reframe in at least one named Rule, core definition, or recurring pillar, and include only the minimum reasoning needed to make it click.

For each idea, provide three to six concise concepts or angles Harvey could mention later while developing it, plus one to four exact manuscript quotations that directly support it. Keep these separate from the Big Idea itself; the Big Idea must remain the clean reframe, not absorb its future outline.

Learned preference profile:
${settings.preference_profile}

Harvey-curated Big Ideas, kept current as he edits their cards. Study how these examples are framed and structured, the tensions and practical stakes they foreground, and the kinds of logical turns Harvey promotes. Generalize the editorial pattern; do not copy their wording or merely generate adjacent topics:
${JSON.stringify(q.bigIdeaExamples.all().map(function (row) { return json(row.snapshot, {}); }))}

Existing, transferred, rejected, and superseded idea catalog. Avoid semantic duplicates; revisit a doctrine only through a materially different real-world application or conclusion:
${JSON.stringify(existingContext().slice(0, 300))}

Return strict JSON only, with no markdown fences or commentary. Provider requested: ${provider}.`;
  }

  function generationPrompt(count, provider) {
    return basePrompt(provider) + `\nGenerate ${count} new Big Ideas. Schema: {"ideas":[{"bigIdea":"two to five self-contained sentences","conceptsToDiscuss":["concept or angle","concept or angle"],"directQuotes":["exact manuscript quotation"]}]}. Do not add keys for title, hook, script, outline, content type, runtime, or format.`;
  }

  function normalizeIdea(raw, providerResult) {
    const bigIdea = clean(replaceRuleNumberReferences(raw.bigIdea), 6000);
    const angles = (Array.isArray(raw.conceptsToDiscuss) ? raw.conceptsToDiscuss : []).map(function (value) { return clean(replaceRuleNumberReferences(value), 1200); }).filter(Boolean).slice(0, 8);
    const suppliedQuotes = Array.isArray(raw.directQuotes) ? raw.directQuotes : [];
    const verifiedQuotes = corpus.verifyQuotes(suppliedQuotes).slice(0, 4);
    if (bigIdea.length < 40) throw new Error('Big Idea is missing or too vague');
    if (angles.length < 2) throw new Error('Big Idea needs at least two concepts or angles');
    if (!verifiedQuotes.length) throw new Error('Big Idea needs at least one verified direct quote');
    if (suppliedQuotes.length > verifiedQuotes.length) console.warn('[ideation] discarded', suppliedQuotes.length - verifiedQuotes.length, 'unverified direct quote(s) from', providerResult.provider);
    return {
      title: internalLabel(bigIdea), bigIdea: bigIdea, angles: angles, quotes: verifiedQuotes,
      provider: providerResult.provider, model: providerResult.model,
      meta: { sessionId: providerResult.sessionId, generatedAt: now(), discardedQuoteCount: suppliedQuotes.length - verifiedQuotes.length }
    };
  }

  function isDuplicate(idea) {
    return existingContext().some(function (item) { return corpus.similarity(idea.bigIdea, item.angle || '') >= 0.72; });
  }

  function insertIdea(idea) {
    const min = db.prepare("SELECT MIN(sort_order) AS n FROM ideation_ideas WHERE status='active'").get().n;
    const order = min == null ? 0 : min - 10;
    const id = uuid(), stamp = now();
    db.prepare(`INSERT INTO ideation_ideas
      (id,status,sort_order,content_type,estimated_runtime,runtime_seconds,title,alternative_titles,big_idea,hook,manuscript_sources,relevant_sections,relevant_pages,verified_quotes,paraphrases,script,discussion_angles,provider,model,generation_meta,created_at,updated_at)
      VALUES (?,'active',?,'idea','',0,?,'[]',?,'','[]','[]','[]',?,'[]','',?,?,?,?,?,?)`)
      .run(id, order, idea.title, idea.bigIdea, stringify(idea.quotes), stringify(idea.angles), idea.provider, idea.model, stringify(idea.meta), stamp, stamp);
    db.prepare('INSERT INTO ideation_revisions (id,idea_id,revision_number,kind,snapshot,diff,provider,model,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(uuid(), id, 0, 'generated', stringify({ bigIdea: idea.bigIdea, conceptsToDiscuss: idea.angles, directQuotes: idea.quotes }), '[]', idea.provider, idea.model, stamp);
    return id;
  }

  function enqueue(kind, provider, count) {
    if (kind === 'generate') {
      const existing = db.prepare("SELECT id,status FROM ideation_jobs WHERE kind='generate' AND status IN ('pending','running','error')").get();
      if (existing) {
        if (existing.status === 'pending') db.prepare('UPDATE ideation_jobs SET requested_count=MAX(requested_count,?),updated_at=? WHERE id=?').run(count || 1, now(), existing.id);
        return existing.id;
      }
    }
    if (kind === 'profile') {
      const existing = db.prepare("SELECT id,status FROM ideation_jobs WHERE kind='profile' AND status IN ('pending','running') LIMIT 1").get();
      if (existing) {
        if (existing.status === 'running') profileRerunNeeded = true;
        return existing.id;
      }
    }
    const id = uuid(), stamp = now();
    db.prepare('INSERT INTO ideation_jobs (id,kind,status,provider,requested_count,activity,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, kind, 'pending', provider, count || 1, '[]', stamp, stamp);
    setImmediate(runWorker);
    return id;
  }

  function ensureQueue() {
    const missing = TARGET_ACTIVE - q.active.all().length;
    if (missing > 0) enqueue('generate', q.settings.get().selected_provider, missing);
  }

  async function processGenerate(job) {
    const count = Math.max(1, Math.min(10, job.requested_count));
    const activity = [];
    const result = await providerEngine.generate(job.provider, generationPrompt(count, job.provider), function (line) {
      if (String(line).indexOf('💭') === 0) return;
      activity.push(clean(line, 500));
      db.prepare('UPDATE ideation_jobs SET activity=?,updated_at=? WHERE id=?').run(stringify(activity.slice(-30)), now(), job.id);
    });
    const parsed = extractJson(result.text);
    const ideas = Array.isArray(parsed) ? parsed : parsed.ideas;
    if (!Array.isArray(ideas)) throw new Error('Provider JSON did not contain ideas');
    let inserted = 0;
    for (const raw of ideas) {
      if (q.active.all().length >= TARGET_ACTIVE) break;
      try {
        const idea = normalizeIdea(raw, result);
        if (isDuplicate(idea)) { activity.push('Rejected a near-duplicate Big Idea'); continue; }
        insertIdea(idea); inserted++;
      } catch (error) {
        activity.push('Rejected an invalid Big Idea: ' + clean(error.message, 180));
      }
    }
    if (!inserted) throw new Error('All generated Big Ideas were invalid or near-duplicates');
  }

  async function rebuildProfile() {
    const rows = q.unprocessedSignals.all();
    if (!rows.length) return;
    const current = json(q.settings.get().preference_profile, DEFAULT_PROFILE);
    const prompt = `Maintain a compact Big Idea preference profile for Harvey. Treat explicit_feedback as a direct, strong instruction: study both Harvey's words and the idea they refer to, and preserve specific likes, dislikes, corrections, and editorial principles for future generations. Treat manual_rewrite as an equally strong before/after demonstration: infer what changed in framing, simplicity, emphasis, structure, or reasoning rather than merely memorizing the rewritten topic. A curated_big_idea signal means Harvey deliberately created a piece in or moved it into his Big Ideas column, so study the actual example closely: how he framed the premise, how he structured the reasoning, what tension or practical stake he emphasized, and what likely made it worth developing. Learn transferable editorial patterns, not merely topics or phrases. Infer cautiously, but do not dilute an explicit instruction; require repetition only before promoting an inferred one-off choice into a universal preference. Progressing an idea through later pipeline stages is also positive, especially reaching live. Return JSON only with keys summary, likes, avoids, framingPatterns, structurePatterns, selectionRationale; every value except summary must be an array of concise strings. CURRENT=${JSON.stringify(current)} NEW_SIGNALS=${JSON.stringify(rows.map(function (row) { return { type: row.signal_type, strength: row.strength, detail: json(row.detail, {}) }; }))}`;
    const result = await providerEngine.generate(q.settings.get().selected_provider, prompt);
    const profile = extractJson(result.text);
    profile.updatedAt = now();
    profile.signalCount = (current.signalCount || 0) + rows.length;
    db.transaction(function () {
      db.prepare('UPDATE ideation_settings SET preference_profile=?,updated_at=? WHERE id=1').run(stringify(profile), now());
      const mark = db.prepare('UPDATE ideation_signals SET processed=1 WHERE id=?');
      rows.forEach(function (row) { mark.run(row.id); });
    })();
  }

  async function runWorker() {
    if (workerBusy) return;
    workerBusy = true;
    try {
      for (;;) {
        const job = db.prepare("SELECT * FROM ideation_jobs WHERE status='pending' ORDER BY created_at ASC LIMIT 1").get();
        if (!job) break;
        db.prepare("UPDATE ideation_jobs SET status='running',error=NULL,updated_at=? WHERE id=?").run(now(), job.id);
        try {
          if (job.kind === 'generate') await processGenerate(job);
          else if (job.kind === 'profile') await rebuildProfile();
          else throw new Error('Unsupported Ideation job: ' + job.kind);
          db.prepare("UPDATE ideation_jobs SET status='done',updated_at=? WHERE id=?").run(now(), job.id);
          console.log('[ideation] job complete', job.kind, job.provider, job.id);
        } catch (error) {
          console.error('[ideation] job failed', job.kind, job.provider, job.id, error.message);
          db.prepare("UPDATE ideation_jobs SET status='error',error=?,updated_at=? WHERE id=?").run(clean(error.message, 2000), now(), job.id);
        }
      }
    } finally {
      workerBusy = false;
      ensureQueue();
      // A feedback/edit signal can arrive while a profile job is already
      // running. enqueue() intentionally coalesces that request into the
      // active job, but the active job may already have snapshotted its
      // input rows. Schedule one follow-up pass when successful work left
      // fresh signals behind; do not spin if a profile job is in error.
      if (profileRerunNeeded && q.unprocessedSignals.get() && !db.prepare("SELECT 1 FROM ideation_jobs WHERE kind='profile' AND status IN ('pending','running') LIMIT 1").get()) {
        profileRerunNeeded = false;
        enqueue('profile', q.settings.get().selected_provider, 1);
      }
    }
  }

  function transferToIdeation(idea) {
    if (idea.status !== 'active') throw new Error('Idea already left the active queue');
    const pieces = q.pieces.all().map(function (row) { return json(row.data, {}); });
    const seq = pieces.reduce(function (max, piece) { return Math.max(max, Number(piece.seq) || 0); }, 0) + 1;
    const stageOrders = pieces.filter(function (piece) { return piece.stage === 'ideation'; }).map(function (piece) { return Number(piece.order); }).filter(Number.isFinite);
    const order = stageOrders.length ? Math.min.apply(Math, stageOrders) - 10 : 0;
    const id = uuid(), stamp = now();
    const piece = {
      id: id, seq: seq, title: internalLabel(idea.big_idea), stage: 'ideation', platforms: [], contentType: 'short',
      notesHtml: notesHtml(idea), order: order, createdAt: stamp, updatedAt: stamp,
      ideationMetadata: {
        ideaId: idea.id, bigIdea: idea.big_idea, conceptsToDiscuss: json(idea.discussion_angles, []),
        verifiedQuotes: json(idea.verified_quotes, []), provider: idea.provider, model: idea.model
      }
    };
    db.transaction(function () {
      db.prepare('INSERT INTO records (store_name,id,data,updated_at) VALUES (?,?,?,?)').run('pieces', id, stringify(piece), stamp);
      db.prepare("UPDATE ideation_ideas SET status='transferred',destination_piece_id=?,exit_reason='ideation',updated_at=? WHERE id=? AND status='active'")
        .run(id, stamp, idea.id);
      addSignal(idea.id, 'sent_to_ideation', 0.6, { bigIdea: idea.big_idea });
    })();
    ensureQueue();
    enqueue('profile', q.settings.get().selected_provider, 1);
    return piece;
  }

  // The Big Ideas Kanban column is Harvey's strongest lightweight curation
  // signal. Keep one live exemplar snapshot per piece so later autosaves in
  // Big Ideas improve the generator's source material without multiplying
  // signals or jobs for every keystroke.
  function recordBigIdeaPiece(piece, fromStage) {
    if (!piece || piece.stage !== 'big_ideas') return false;
    const metadata = piece.ideationMetadata && typeof piece.ideationMetadata === 'object' ? piece.ideationMetadata : {};
    const detail = {
      pieceId: clean(piece.id, 200),
      title: clean(piece.title, 1000),
      notes: clean(corpus.stripHtml(piece.notesHtml || ''), 12000),
      contentType: clean(piece.contentType, 80),
      fromStage: fromStage || null,
      origin: metadata.ideaId ? 'generator' : 'harvey',
      originalGeneratedBigIdea: clean(metadata.bigIdea, 6000),
      conceptsToDiscuss: Array.isArray(metadata.conceptsToDiscuss) ? metadata.conceptsToDiscuss.slice(0, 12) : []
    };
    const stamp = now();
    db.prepare(`INSERT INTO ideation_big_idea_examples (piece_id,snapshot,first_selected_at,updated_at)
      VALUES (?,?,?,?) ON CONFLICT(piece_id) DO UPDATE SET snapshot=excluded.snapshot,updated_at=excluded.updated_at`)
      .run(detail.pieceId, stringify(detail), stamp, stamp);
    if (fromStage !== 'big_ideas') {
      addSignal(metadata.ideaId || null, 'curated_big_idea', 1, detail);
      enqueue('profile', q.settings.get().selected_provider, 1);
    }
    return true;
  }

  const router = express.Router();
  router.get('/state', function (req, res) { ensureQueue(); res.json(state()); });
  router.put('/provider', function (req, res) {
    const provider = req.body && req.body.provider;
    if (provider !== 'claude' && provider !== 'codex') return res.status(400).json({ error: 'invalid_provider' });
    db.prepare('UPDATE ideation_settings SET selected_provider=?,updated_at=? WHERE id=1').run(provider, now());
    res.json({ ok: true, selectedProvider: provider });
  });
  router.put('/ideas/:id', function (req, res) {
    try {
      const idea = q.idea.get(req.params.id);
      if (!idea || idea.status !== 'active') return res.status(404).json({ error: 'not_found' });
      const bigIdea = clean(req.body && req.body.bigIdea, 6000);
      if (bigIdea.length < 20) return res.status(400).json({ error: 'A Big Idea needs at least 20 characters.' });
      const revision = Number(idea.revision_number || 0) + 1;
      const stamp = now();
      const before = idea.big_idea;
      db.transaction(function () {
        db.prepare('UPDATE ideation_ideas SET title=?,big_idea=?,revision_number=?,edited=1,updated_at=? WHERE id=?')
          .run(internalLabel(bigIdea), bigIdea, revision, stamp, idea.id);
        db.prepare('INSERT INTO ideation_revisions (id,idea_id,revision_number,kind,snapshot,diff,provider,model,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(uuid(), idea.id, revision, 'manual_edit', stringify({ bigIdea: bigIdea }), stringify({ bigIdea: { before: before, after: bigIdea } }), idea.provider, idea.model, stamp);
        addSignal(idea.id, 'manual_rewrite', 1, {
          before: before,
          after: bigIdea,
          conceptsToDiscuss: json(idea.discussion_angles, [])
        });
      })();
      enqueue('profile', q.settings.get().selected_provider, 1);
      res.json({ ok: true, idea: decodeIdea(q.idea.get(idea.id)) });
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.post('/ideas/:id/feedback', function (req, res) {
    try {
      const idea = q.idea.get(req.params.id);
      if (!idea || idea.status !== 'active') return res.status(404).json({ error: 'not_found' });
      const entry = addFeedback(idea, req.body && req.body.text, req.body && req.body.source);
      res.json({ ok: true, feedback: entry });
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.post('/ideas/:id/transfer', function (req, res) {
    try {
      const idea = q.idea.get(req.params.id);
      if (!idea || idea.status !== 'active') return res.status(404).json({ error: 'not_found' });
      res.json({ ok: true, piece: transferToIdeation(idea) });
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.post('/jobs/:id/retry', function (req, res) {
    const job = db.prepare("SELECT * FROM ideation_jobs WHERE id=? AND status='error'").get(req.params.id);
    if (!job) return res.status(404).json({ error: 'not_found' });
    db.prepare("UPDATE ideation_jobs SET status='pending',error=NULL,activity='[]',updated_at=? WHERE id=?").run(now(), job.id);
    setImmediate(runWorker);
    res.json({ ok: true });
  });

  if (autoStart) {
    ensureQueue();
    if (q.unprocessedSignals.get()) enqueue('profile', q.settings.get().selected_provider, 1);
    setImmediate(runWorker);
  }
  return { router: router, state: state, ensureQueue: ensureQueue, recordBigIdeaPiece: recordBigIdeaPiece };
}

module.exports = { setup: setup, replaceRuleNumberReferences: replaceRuleNumberReferences };
