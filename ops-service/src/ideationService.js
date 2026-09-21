'use strict';

const express = require('express');
const crypto = require('crypto');
const corpus = require('./ideationCorpus');
const doctrine = require('./ideationDoctrine');
const providers = require('./ideationProviders');

const TARGET_ACTIVE = 10;
const TYPES = ['ultra_short', 'short', 'long_short', 'longform'];
const DEFAULT_PROFILE = {
  summary: 'No Ideation feedback has been learned yet. Use the established Reality Manual outline style as the baseline.',
  likes: [], avoids: [], hookPreferences: [], formatPreferences: [], updatedAt: null, signalCount: 0
};

function now() { return new Date().toISOString(); }
function uuid() { return crypto.randomUUID(); }
function json(value, fallback) { try { return JSON.parse(value); } catch (e) { return fallback; } }
function stringify(value) { return JSON.stringify(value == null ? null : value); }
function clean(value, max) { return String(value || '').trim().slice(0, max || 100000); }
function cleanGeneratedScript(value) {
  return clean(value, 100000).split('\n').map(function (line) {
    // Keep useful section headings, but remove production timecodes such as
    // "0:00 — HOOK" or "[02:10-03:00] Example" from generated scripts.
    return line.replace(/^\s*\[?\d{1,2}:\d{2}(?:\s*(?:-|–|—|to)\s*\d{1,2}:\d{2})?\]?\s*(?:(?:-|–|—|:)\s*)?/i, '');
  }).join('\n').replace(/^\s*\n+/, '').replace(/\n{3,}/g, '\n\n').trim();
}
function htmlEscape(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function scriptHtml(value) { return clean(value, 100000).split(/\n/).map(function (line) { return '<div>' + (htmlEscape(line) || '<br>') + '</div>'; }).join(''); }

function extractJson(text) {
  let raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const starts = [raw.indexOf('{'), raw.indexOf('[')].filter(function (n) { return n >= 0; });
  if (!starts.length) throw new Error('Provider returned no JSON');
  raw = raw.slice(Math.min.apply(Math, starts));
  const objectEnd = raw.lastIndexOf('}'), arrayEnd = raw.lastIndexOf(']');
  raw = raw.slice(0, Math.max(objectEnd, arrayEnd) + 1);
  return JSON.parse(raw);
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
      provider TEXT NOT NULL, model TEXT NOT NULL, generation_meta TEXT NOT NULL,
      revision_number INTEGER NOT NULL DEFAULT 0, edited INTEGER NOT NULL DEFAULT 0,
      destination_piece_id TEXT, exit_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ideation_active ON ideation_ideas(status, sort_order);
    CREATE TABLE IF NOT EXISTS ideation_feedback (
      id TEXT PRIMARY KEY, idea_id TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL,
      strength REAL NOT NULL, revision_number INTEGER, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ideation_feedback_idea ON ideation_feedback(idea_id, created_at);
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
    CREATE TABLE IF NOT EXISTS ideation_jobs (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, provider TEXT NOT NULL,
      idea_id TEXT, requested_count INTEGER NOT NULL DEFAULT 1, activity TEXT NOT NULL,
      error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  try { db.exec("ALTER TABLE ideation_ideas ADD COLUMN alternative_titles TEXT NOT NULL DEFAULT '[]'"); } catch (e) { /* already exists */ }
  db.prepare('INSERT OR IGNORE INTO ideation_settings (id, selected_provider, preference_profile, updated_at) VALUES (1, ?, ?, ?)')
    .run('codex', stringify(DEFAULT_PROFILE), now());

  const q = {
    settings: db.prepare('SELECT * FROM ideation_settings WHERE id=1'),
    active: db.prepare("SELECT * FROM ideation_ideas WHERE status='active' ORDER BY sort_order ASC, created_at ASC"),
    allIdeas: db.prepare('SELECT * FROM ideation_ideas ORDER BY created_at DESC'),
    idea: db.prepare('SELECT * FROM ideation_ideas WHERE id=?'),
    feedback: db.prepare('SELECT * FROM ideation_feedback WHERE idea_id=? ORDER BY created_at ASC'),
    revisions: db.prepare('SELECT * FROM ideation_revisions WHERE idea_id=? ORDER BY revision_number DESC'),
    jobs: db.prepare("SELECT * FROM ideation_jobs WHERE status IN ('pending','running','error') ORDER BY created_at ASC"),
    pieces: db.prepare("SELECT data FROM records WHERE store_name='pieces' ORDER BY updated_at DESC"),
    signals: db.prepare('SELECT * FROM ideation_signals ORDER BY created_at DESC LIMIT 80'),
    unprocessedSignals: db.prepare('SELECT * FROM ideation_signals WHERE processed=0 ORDER BY created_at ASC LIMIT 40')
  };
  db.prepare("UPDATE ideation_jobs SET status='pending', updated_at=? WHERE status='running'").run(now());

  // The first generated batch used timecoded long-form headings. They are
  // editorial scaffolding, not spoken copy, and made the script needlessly
  // noisy. Clean existing active proposals once; the operation is idempotent
  // and intentionally does not create a user-edit learning signal.
  const migrateScript = db.prepare('UPDATE ideation_ideas SET script=?, estimated_runtime=?, runtime_seconds=? WHERE id=?');
  db.prepare("SELECT id,script,content_type FROM ideation_ideas WHERE status='active'").all().forEach(function (idea) {
    const script = cleanGeneratedScript(idea.script);
    if (script === idea.script) return;
    const runtime = corpus.estimateRuntime(script, idea.content_type);
    migrateScript.run(script, runtime.label, runtime.seconds, idea.id);
  });

  let workerBusy = false;

  function decodeIdea(row) {
    if (!row) return null;
    const out = Object.assign({}, row);
    ['alternative_titles','manuscript_sources','relevant_sections','relevant_pages','verified_quotes','paraphrases','generation_meta'].forEach(function (key) {
      out[key] = json(row[key], key === 'generation_meta' ? {} : []);
    });
    out.edited = !!row.edited;
    out.feedback = q.feedback.all(row.id).map(function (f) { return Object.assign({}, f); });
    out.revisions = q.revisions.all(row.id).map(function (r) {
      return Object.assign({}, r, { snapshot: json(r.snapshot, {}), diff: json(r.diff, []) });
    });
    return out;
  }

  function state() {
    capturePipelineSignals();
    const settings = q.settings.get();
    return {
      target: TARGET_ACTIVE,
      selectedProvider: settings.selected_provider,
      preferenceProfile: json(settings.preference_profile, DEFAULT_PROFILE),
      ideas: q.active.all().map(decodeIdea),
      jobs: q.jobs.all().map(function (j) { return Object.assign({}, j, { activity: json(j.activity, []) }); })
    };
  }

  function addSignal(ideaId, type, strength, detail) {
    db.prepare('INSERT INTO ideation_signals (id, idea_id, signal_type, strength, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uuid(), ideaId || null, type, strength, stringify(detail || {}), now());
  }

  function capturePipelineSignals() {
    const ranks = ['archived','ideation','outline_started','outline_completed','filmed','edited','uploaded','processed','final_check','scheduled','live'];
    const pieces = new Map(q.pieces.all().map(function (r) { const p = json(r.data, {}); return [p.id, p]; }));
    db.prepare("SELECT id,destination_piece_id,exit_reason FROM ideation_ideas WHERE status='transferred' AND destination_piece_id IS NOT NULL").all().forEach(function (idea) {
      const piece = pieces.get(idea.destination_piece_id);
      if (!piece || ranks.indexOf(piece.stage) <= ranks.indexOf(idea.exit_reason)) return;
      const type = 'pipeline_progress_' + piece.stage;
      if (!db.prepare('SELECT 1 FROM ideation_signals WHERE idea_id=? AND signal_type=?').get(idea.id, type)) {
        addSignal(idea.id, type, piece.stage === 'live' ? 1 : 0.65, { stage: piece.stage, pieceId: piece.id });
      }
    });
  }

  function addFeedback(ideaId, text, source, strength) {
    const value = clean(text, 8000);
    if (!value) return null;
    const id = uuid();
    db.prepare('INSERT INTO ideation_feedback (id, idea_id, text, source, strength, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, ideaId, value, source === 'voice' ? 'voice' : 'typed', strength || 1, now());
    addSignal(ideaId, 'explicit_feedback', strength || 1, { text: value });
    return id;
  }

  function snapshot(idea) {
    return { title: idea.title, bigIdea: idea.big_idea, hook: idea.hook, script: idea.script,
      alternativeTitles: json(idea.alternative_titles, []),
      contentType: idea.content_type, sources: json(idea.manuscript_sources, []), sections: json(idea.relevant_sections, []),
      pages: json(idea.relevant_pages, []), quotes: json(idea.verified_quotes, []), paraphrases: json(idea.paraphrases, []) };
  }

  function diffLines(before, after) {
    const a = String(before || '').split('\n'), b = String(after || '').split('\n');
    const matrix = Array.from({ length: a.length + 1 }, function () { return Array(b.length + 1).fill(0); });
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) matrix[i][j] = a[i] === b[j] ? matrix[i + 1][j + 1] + 1 : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
    const result = []; let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) { result.push({ type: 'same', text: a[i] }); i++; j++; }
      else if (j < b.length && (i === a.length || matrix[i][j + 1] >= matrix[i + 1][j])) { result.push({ type: 'add', text: b[j++] }); }
      else { result.push({ type: 'remove', text: a[i++] }); }
    }
    return result;
  }

  function saveManual(idea, body) {
    const title = clean(body.title == null ? idea.title : body.title, 300);
    const bigIdea = clean(body.bigIdea == null ? idea.big_idea : body.bigIdea, 5000);
    const hook = clean(body.hook == null ? idea.hook : body.hook, 5000);
    const script = clean(body.script == null ? idea.script : body.script, 100000);
    if (!title || !bigIdea || !script) throw new Error('Title, big idea, and script are required');
    if (title === idea.title && bigIdea === idea.big_idea && hook === idea.hook && script === idea.script) return idea;
    const prior = snapshot(idea), revision = idea.revision_number + 1;
    const runtime = corpus.estimateRuntime(script, idea.content_type);
    const next = Object.assign({}, idea, { title: title, big_idea: bigIdea, hook: hook, script: script, revision_number: revision, edited: 1, updated_at: now() });
    db.transaction(function () {
      db.prepare('UPDATE ideation_ideas SET title=?, big_idea=?, hook=?, script=?, estimated_runtime=?, runtime_seconds=?, revision_number=?, edited=1, updated_at=? WHERE id=?')
        .run(title, bigIdea, hook, script, runtime.label, runtime.seconds, revision, next.updated_at, idea.id);
      db.prepare('INSERT INTO ideation_revisions (id,idea_id,revision_number,kind,snapshot,diff,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(uuid(), idea.id, revision, 'manual', stringify(snapshot(next)), stringify(diffLines(prior.script, script)), now());
      addSignal(idea.id, 'manual_edit', 1, { changedWords: Math.abs(corpus.wordCount(script) - corpus.wordCount(idea.script)), before: prior.script.slice(0, 3000), after: script.slice(0, 3000) });
    })();
    return q.idea.get(idea.id);
  }

  function existingContext() {
    const pieces = q.pieces.all().map(function (r) { return json(r.data, {}); });
    const completed = pieces.filter(function (p) { return p.stage === 'outline_completed'; })
      .sort(function (a, b) { return corpus.wordCount(corpus.stripHtml(b.notesHtml)) - corpus.wordCount(corpus.stripHtml(a.notesHtml)); });
    const examples = [];
    completed.slice(0, 4).forEach(function (p) { examples.push(p); });
    TYPES.forEach(function (type) {
      const hit = completed.find(function (p) { return p.contentType === type && examples.indexOf(p) < 0; });
      if (hit) examples.push(hit);
    });
    return {
      pieces: pieces,
      duplicateCatalog: pieces.map(function (p) { return { title: p.title, angle: corpus.stripHtml(p.notesHtml).slice(0, 320), stage: p.stage, type: p.contentType }; })
        .concat(q.allIdeas.all().map(function (p) { return { title: p.title, angle: p.big_idea, status: p.status, type: p.content_type }; })),
      examples: examples.map(function (p) { return { title: p.title, type: p.contentType, script: corpus.stripHtml(p.notesHtml).slice(0, 15000) }; })
    };
  }

  function basePrompt(provider) {
    const settings = q.settings.get();
    const ctx = existingContext();
    const distribution = q.allIdeas.all().reduce(function (acc, idea) { acc[idea.content_type] = (acc[idea.content_type] || 0) + 1; return acc; }, {});
    return `You are the Content Ideation engine for The Reality Manual. This is a production content-development task, not generic self-help brainstorming.

Read the canonical completed manuscript at THE_REALITY_MANUAL_COMPLETE_MANUSCRIPT.txt. It contains ==PAGE N== markers. Ground every proposal in its actual arguments, rules, examples, terminology, and reasoning. Do not invent quotations. A direct quote must be copied exactly from the manuscript.

The following is the permanent doctrine map extracted from that manuscript. Treat it as a set of reusable intellectual anchors, not as a requirement to cram every rule into every script:
${doctrine.promptText()}

Physical format: overhead camera, physical book and hands in frame. The speaker can read or show an exact passage or diagram and then explain its relevance to emotional well-being, life strategy, or improving life. Use TURN/READ/SHOW instructions only when the specific passage or visual will genuinely appear. Never instruct the speaker to trace a paragraph or prose; TRACE is reserved for a diagram whose visual structure is itself being explained.

Established method inferred from the strongest Outline Completed records: provocative and concrete hook; state a precise central argument; translate formal book rules into candid conversational speech; use examples/thought experiments; connect apparently distant sections when useful; return to practical emotional well-being. Preserve the author's direct, irreverent, intellectually serious voice. Vary formats. Ultra-short ideas can be one sharp quotation or implication rather than inflated mini-essays.

Each proposal must be structurally rooted in at least one named Rule, core definition, or recurring pillar above. Do not merely mention it: show the logical chain. When natural, establish the objective first (maximizing EWB / the pleasantness of being alive), then explain how the relevant Rule changes the diagnosis of the human problem and what strategy follows. For example, an ordinary annoyance becomes important because it lowers lifetime-average EWB; the Rule of Desire explains the negative emotion as an unmet desire; a subconscious block is an emotional signature under the Rule of Crystallized Emotion, not merely a sentence to repeat over. Use the manuscript's exact numbering and terminology when naming a Rule.

Scripts must not contain timestamps, timecodes, or timed beat ranges. Use plain descriptive section headings when a long script needs structure.

Representative completed outlines (these are style references, not ideas to duplicate):
${JSON.stringify(ctx.examples)}

Learned preference profile (compact summary, underlying signals remain stored separately):
${settings.preference_profile}

Existing/active/rejected catalog. Avoid obvious semantic duplicates; a related manuscript concept is acceptable only with a materially different argument, application, connection, or format:
${JSON.stringify(ctx.duplicateCatalog.slice(0, 260))}

Historical Ideation format counts (use these to steer toward the long-run mix without sacrificing the best idea): ${JSON.stringify(distribution)}

Use the reasoning chain MANUSCRIPT CONCEPT -> interesting implication -> human problem/experience -> useful or counterintuitive angle -> well-being/life strategy -> format -> hook -> central argument -> supporting manuscript material -> script.

Return STRICT JSON only. Do not include markdown fences or commentary. Provider requested: ${provider}.`;
  }

  function generationPrompt(count, provider) {
    return basePrompt(provider) + `\nGenerate ${count} NEW proposals. Across long-run generations target approximately six short-form proposals per one longform proposal; within short form mix ultra_short (<25 sec), short (<60 sec), and long_short (1-3 min). Longform is 6-38 min. Quality beats a mechanical batch ratio. Every longform proposal must include exactly three genuinely distinct alternative titles in addition to its working title; other formats should return an empty alternativeTitles array.\nSchema: {"proposals":[{"contentType":"ultra_short|short|long_short|longform","title":"...","alternativeTitles":["...","...","..."],"bigIdea":"the exact point, named rule/pillar, logical chain, and why it matters to EWB","hook":"...","manuscriptSources":["specific concept/example"],"relevantSections":["section title"],"relevantPages":[12],"directQuotes":["exact manuscript text"],"paraphrases":["clearly paraphrased source claim"],"script":"complete usable script or detailed longform outline with no timestamps"}]}.`;
  }

  function revisionPrompt(idea, feedback, provider) {
    return basePrompt(provider) + `\nRevise this proposal to address the feedback precisely. Preserve manual wording and unrelated parts. Recheck all direct quotes against the manuscript. A longform proposal must retain or provide exactly three alternativeTitles; other formats use an empty array. Do not add timestamps.\nCURRENT=${JSON.stringify(snapshot(idea))}\nFEEDBACK=${JSON.stringify(feedback)}\nReturn {"proposal":{same fields as generation schema, including alternativeTitles},"changeSummary":["specific change"]}.`;
  }

  function normalizeProposal(raw, providerResult) {
    const requestedType = TYPES.indexOf(raw.contentType) >= 0 ? raw.contentType : 'short';
    const title = clean(raw.title, 300), bigIdea = clean(raw.bigIdea, 5000), hook = clean(raw.hook, 5000), script = cleanGeneratedScript(raw.script);
    if (!title || !bigIdea || !script) throw new Error('Proposal missing title, bigIdea, or script');
    const runtime = corpus.estimateRuntime(script, requestedType);
    if (runtime.seconds > 45 * 60) throw new Error('Proposal exceeds the maximum practical runtime');
    // The provider chooses a format deliberately, but the saved label must
    // still agree with the script it actually wrote. These generous bands
    // keep the requested "approximately" semantics while correcting clear
    // mismatches such as a five-minute script labelled long-short.
    const type = runtime.seconds <= 35 ? 'ultra_short' : runtime.seconds <= 90 ? 'short' : runtime.seconds <= 270 ? 'long_short' : 'longform';
    runtime.contentType = type;
    const verifiedQuotes = corpus.verifyQuotes(raw.directQuotes);
    const validPages = new Set(corpus.loadManuscript().pages.map(function (p) { return p.page; }));
    const suppliedQuoteCount = Array.isArray(raw.directQuotes) ? raw.directQuotes.length : 0;
    if (suppliedQuoteCount > verifiedQuotes.length) console.warn('[ideation] discarded', suppliedQuoteCount - verifiedQuotes.length, 'unverified direct quote(s) from', providerResult.provider);
    const alternativeTitles = type === 'longform' ? (Array.isArray(raw.alternativeTitles) ? raw.alternativeTitles : []).map(function (x) { return clean(x, 300); }).filter(Boolean).filter(function (x, i, all) { return x !== title && all.indexOf(x) === i; }).slice(0, 3) : [];
    if (type === 'longform' && alternativeTitles.length !== 3) throw new Error('Longform proposal requires exactly three alternative titles');
    return { contentType: type, title: title, alternativeTitles: alternativeTitles, bigIdea: bigIdea, hook: hook,
      manuscriptSources: (raw.manuscriptSources || []).map(function (x) { return clean(x, 1000); }).filter(Boolean),
      relevantSections: (raw.relevantSections || []).map(function (x) { return clean(x, 300); }).filter(Boolean),
      relevantPages: (raw.relevantPages || []).map(Number).filter(function (n) { return Number.isInteger(n) && validPages.has(n); }),
      verifiedQuotes: verifiedQuotes,
      paraphrases: (raw.paraphrases || []).map(function (x) { return clean(x, 2000); }).filter(Boolean),
      script: script, runtime: runtime, provider: providerResult.provider, model: providerResult.model,
      meta: { sessionId: providerResult.sessionId, generatedAt: now(), discardedQuoteCount: suppliedQuoteCount - verifiedQuotes.length }
    };
  }

  function isDuplicate(proposal) {
    const comparison = proposal.title + ' ' + proposal.bigIdea;
    return existingContext().duplicateCatalog.some(function (item) {
      return corpus.similarity(comparison, (item.title || '') + ' ' + (item.angle || '')) >= 0.72;
    });
  }

  function insertProposal(proposal) {
    const min = db.prepare("SELECT MIN(sort_order) AS n FROM ideation_ideas WHERE status='active'").get().n;
    const order = min == null ? 0 : min - 10;
    const id = uuid(), stamp = now();
    db.prepare(`INSERT INTO ideation_ideas
      (id,status,sort_order,content_type,estimated_runtime,runtime_seconds,title,alternative_titles,big_idea,hook,manuscript_sources,relevant_sections,relevant_pages,verified_quotes,paraphrases,script,provider,model,generation_meta,created_at,updated_at)
      VALUES (?,'active',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, order, proposal.contentType, proposal.runtime.label, proposal.runtime.seconds, proposal.title, stringify(proposal.alternativeTitles), proposal.bigIdea,
        proposal.hook, stringify(proposal.manuscriptSources), stringify(proposal.relevantSections), stringify(proposal.relevantPages),
        stringify(proposal.verifiedQuotes), stringify(proposal.paraphrases), proposal.script, proposal.provider, proposal.model,
        stringify(proposal.meta), stamp, stamp);
    db.prepare('INSERT INTO ideation_revisions (id,idea_id,revision_number,kind,snapshot,diff,provider,model,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(uuid(), id, 0, 'generated', stringify(snapshot(db.prepare('SELECT * FROM ideation_ideas WHERE id=?').get(id))), '[]', proposal.provider, proposal.model, stamp);
    return id;
  }

  function enqueue(kind, provider, ideaId, count) {
    if (kind === 'generate') {
      // A failed provider call remains visible and explicitly retryable. Do
      // not create an invisible retry loop (or silently switch providers).
      const existing = db.prepare("SELECT id,status FROM ideation_jobs WHERE kind='generate' AND status IN ('pending','running','error')").get();
      if (existing) {
        if (existing.status === 'pending') {
          db.prepare('UPDATE ideation_jobs SET requested_count=MAX(requested_count,?),updated_at=? WHERE id=?')
            .run(count || 1, now(), existing.id);
        }
        return existing.id;
      }
    }
    if (kind === 'profile') {
      const existingProfile = db.prepare("SELECT id FROM ideation_jobs WHERE kind='profile' AND status IN ('pending','running') ORDER BY created_at DESC LIMIT 1").get();
      if (existingProfile) return existingProfile.id;
    }
    const id = uuid(), stamp = now();
    db.prepare('INSERT INTO ideation_jobs (id,kind,status,provider,idea_id,requested_count,activity,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, kind, 'pending', provider, ideaId || null, count || 1, '[]', stamp, stamp);
    setImmediate(runWorker);
    return id;
  }

  function ensureQueue() {
    const count = q.active.all().length;
    if (count < TARGET_ACTIVE) enqueue('generate', q.settings.get().selected_provider, null, TARGET_ACTIVE - count);
  }

  async function processGenerate(job) {
    const count = Math.max(1, Math.min(10, job.requested_count));
    const activity = [];
    const result = await providerEngine.generate(job.provider, generationPrompt(count, job.provider), function (line) {
      if (String(line).indexOf('💭') === 0) return;
      activity.push(clean(line, 500));
      db.prepare('UPDATE ideation_jobs SET activity=?, updated_at=? WHERE id=?').run(stringify(activity.slice(-30)), now(), job.id);
    });
    const parsed = extractJson(result.text);
    const proposals = Array.isArray(parsed) ? parsed : parsed.proposals;
    if (!Array.isArray(proposals)) throw new Error('Provider JSON did not contain proposals');
    let inserted = 0;
    for (const raw of proposals) {
      if (q.active.all().length >= TARGET_ACTIVE) break;
      try {
        const proposal = normalizeProposal(raw, result);
        if (isDuplicate(proposal)) { activity.push('Rejected a near-duplicate: ' + proposal.title); continue; }
        insertProposal(proposal); inserted++;
      } catch (err) {
        activity.push('Rejected an invalid proposal: ' + clean(err.message, 180));
      }
    }
    if (!inserted) throw new Error('All generated proposals were invalid or near-duplicates');
    return inserted;
  }

  async function processRevise(job) {
    const idea = q.idea.get(job.idea_id);
    if (!idea || idea.status !== 'active') throw new Error('Idea is no longer active');
    const feedbackRows = q.feedback.all(idea.id);
    const feedback = feedbackRows.slice(-5).map(function (f) { return f.text; });
    if (!feedback.length) throw new Error('Feedback is required before revision');
    const activity = [];
    const result = await providerEngine.generate(job.provider, revisionPrompt(idea, feedback, job.provider), function (line) {
      if (String(line).indexOf('💭') === 0) return;
      activity.push(clean(line, 500));
      db.prepare('UPDATE ideation_jobs SET activity=?, updated_at=? WHERE id=?').run(stringify(activity.slice(-30)), now(), job.id);
    });
    const parsed = extractJson(result.text), raw = parsed.proposal || parsed;
    const revised = normalizeProposal(raw, result), prior = snapshot(idea), revision = idea.revision_number + 1;
    const top = db.prepare("SELECT MIN(sort_order) AS n FROM ideation_ideas WHERE status='active'").get().n;
    const changeSummary = Array.isArray(parsed.changeSummary) ? parsed.changeSummary : [];
    db.transaction(function () {
      db.prepare(`UPDATE ideation_ideas SET sort_order=?,content_type=?,estimated_runtime=?,runtime_seconds=?,title=?,alternative_titles=?,big_idea=?,hook=?,manuscript_sources=?,relevant_sections=?,relevant_pages=?,verified_quotes=?,paraphrases=?,script=?,provider=?,model=?,generation_meta=?,revision_number=?,edited=1,updated_at=? WHERE id=?`)
        .run((top == null ? 0 : top - 10), revised.contentType, revised.runtime.label, revised.runtime.seconds, revised.title, stringify(revised.alternativeTitles), revised.bigIdea,
          revised.hook, stringify(revised.manuscriptSources), stringify(revised.relevantSections), stringify(revised.relevantPages), stringify(revised.verifiedQuotes),
          stringify(revised.paraphrases), revised.script, revised.provider, revised.model, stringify(Object.assign(revised.meta, { changeSummary: changeSummary })), revision, now(), idea.id);
      db.prepare('INSERT INTO ideation_revisions (id,idea_id,revision_number,kind,snapshot,diff,provider,model,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(uuid(), idea.id, revision, 'ai_revision', stringify({ title: revised.title, alternativeTitles: revised.alternativeTitles, bigIdea: revised.bigIdea, hook: revised.hook, script: revised.script, changeSummary: changeSummary }), stringify(diffLines(prior.script, revised.script)), result.provider, result.model, now());
      addSignal(idea.id, 'implemented_feedback', 1, { feedback: feedback, changeSummary: changeSummary });
    })();
  }

  async function rebuildProfile() {
    const rows = q.unprocessedSignals.all();
    if (!rows.length) return;
    const current = json(q.settings.get().preference_profile, DEFAULT_PROFILE);
    const prompt = `Maintain a compact, inspectable content preference profile. Update cautiously: repeated signals matter more than one unusual action. Explicit feedback/manual rewrites are strong; completed transfer is positive; started transfer weaker; explained rejection strong negative; unexplained rejection weak. Return JSON only with keys summary, likes, avoids, hookPreferences, formatPreferences. CURRENT=${JSON.stringify(current)} NEW_SIGNALS=${JSON.stringify(rows.map(function (r) { return { type: r.signal_type, strength: r.strength, detail: json(r.detail, {}) }; }))}`;
    const provider = q.settings.get().selected_provider;
    const result = await providerEngine.generate(provider, prompt);
    const profile = extractJson(result.text);
    profile.updatedAt = now(); profile.signalCount = (current.signalCount || 0) + rows.length;
    db.transaction(function () {
      db.prepare('UPDATE ideation_settings SET preference_profile=?,updated_at=? WHERE id=1').run(stringify(profile), now());
      const mark = db.prepare('UPDATE ideation_signals SET processed=1 WHERE id=?'); rows.forEach(function (r) { mark.run(r.id); });
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
          else if (job.kind === 'revise') await processRevise(job);
          else if (job.kind === 'profile') await rebuildProfile();
          db.prepare("UPDATE ideation_jobs SET status='done',updated_at=? WHERE id=?").run(now(), job.id);
          console.log('[ideation] job complete', job.kind, job.provider, job.id);
        } catch (err) {
          console.error('[ideation] job failed', job.kind, job.provider, job.id, err.message);
          db.prepare("UPDATE ideation_jobs SET status='error',error=?,updated_at=? WHERE id=?").run(clean(err.message, 2000), now(), job.id);
        }
      }
    } finally {
      workerBusy = false;
      ensureQueue();
    }
  }

  function exitAndTransfer(idea, destination) {
    if (['outline_started','outline_completed'].indexOf(destination) < 0) throw new Error('Invalid destination');
    if (idea.status !== 'active') throw new Error('Idea already left the active queue');
    const pieces = q.pieces.all().map(function (r) { return json(r.data, {}); });
    const seq = pieces.reduce(function (m, p) { return Math.max(m, Number(p.seq) || 0); }, 0) + 1;
    const stageOrders = pieces.filter(function (p) { return p.stage === destination; }).map(function (p) { return Number(p.order); }).filter(Number.isFinite);
    const order = stageOrders.length ? Math.min.apply(Math, stageOrders) - 10 : 0;
    const id = uuid(), stamp = now();
    const platforms = idea.content_type === 'longform' ? ['ytlong','facebook'] : ['ytshort','tiktok','instagram','facebook'];
    const piece = { id: id, seq: seq, title: idea.title, stage: destination, platforms: platforms, contentType: idea.content_type,
      notesHtml: scriptHtml(idea.script), order: order, createdAt: stamp, updatedAt: stamp,
      ideationMetadata: { ideaId: idea.id, alternativeTitles: json(idea.alternative_titles, []), bigIdea: idea.big_idea, hook: idea.hook, estimatedRuntime: idea.estimated_runtime,
        runtimeSeconds: idea.runtime_seconds, manuscriptSources: json(idea.manuscript_sources, []), relevantSections: json(idea.relevant_sections, []),
        relevantPages: json(idea.relevant_pages, []), verifiedQuotes: json(idea.verified_quotes, []), provider: idea.provider, model: idea.model,
        revisionNumber: idea.revision_number } };
    db.transaction(function () {
      db.prepare('INSERT INTO records (store_name,id,data,updated_at) VALUES (?,?,?,?)').run('pieces', id, stringify(piece), stamp);
      db.prepare("UPDATE ideation_ideas SET status='transferred',destination_piece_id=?,exit_reason=?,updated_at=? WHERE id=? AND status='active'")
        .run(id, destination, stamp, idea.id);
      addSignal(idea.id, destination === 'outline_completed' ? 'sent_outline_completed' : 'sent_outline_started', destination === 'outline_completed' ? 0.8 : 0.55, { title: idea.title });
    })();
    ensureQueue();
    enqueue('profile', q.settings.get().selected_provider, null, 1);
    return piece;
  }

  const router = express.Router();
  router.get('/state', function (req, res) { ensureQueue(); res.json(state()); });
  router.put('/provider', function (req, res) {
    const provider = req.body && req.body.provider;
    if (provider !== 'claude' && provider !== 'codex') return res.status(400).json({ error: 'invalid_provider' });
    db.prepare('UPDATE ideation_settings SET selected_provider=?,updated_at=? WHERE id=1').run(provider, now());
    res.json({ ok: true, selectedProvider: provider });
  });
  router.patch('/ideas/:id', function (req, res) {
    try { const idea = q.idea.get(req.params.id); if (!idea || idea.status !== 'active') return res.status(404).json({ error: 'not_found' }); res.json({ ok: true, idea: decodeIdea(saveManual(idea, req.body || {})) }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  router.post('/ideas/:id/feedback', function (req, res) {
    const idea = q.idea.get(req.params.id); if (!idea || idea.status !== 'active') return res.status(404).json({ error: 'not_found' });
    const id = addFeedback(idea.id, req.body && req.body.text, req.body && req.body.source, 1);
    if (!id) return res.status(400).json({ error: 'feedback_required' });
    res.json({ ok: true, feedback: q.feedback.all(idea.id) });
  });
  router.post('/ideas/:id/revise', function (req, res) {
    try {
      let idea = q.idea.get(req.params.id); if (!idea || idea.status !== 'active') return res.status(404).json({ error: 'not_found' });
      if (req.body && (req.body.script != null || req.body.title != null || req.body.bigIdea != null || req.body.hook != null)) idea = saveManual(idea, req.body);
      if (req.body && clean(req.body.feedback)) addFeedback(idea.id, req.body.feedback, req.body.source, 1);
      if (!q.feedback.all(idea.id).length) return res.status(400).json({ error: 'feedback_required' });
      const provider = q.settings.get().selected_provider;
      const jobId = enqueue('revise', provider, idea.id, 1);
      res.status(202).json({ ok: true, jobId: jobId, provider: provider });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  router.post('/ideas/:id/transfer', function (req, res) {
    try {
      let idea = q.idea.get(req.params.id); if (!idea || idea.status !== 'active') return res.status(404).json({ error: 'not_found' });
      if (req.body) idea = saveManual(idea, req.body);
      if (req.body && clean(req.body.feedback)) addFeedback(idea.id, req.body.feedback, req.body.source, 1);
      res.json({ ok: true, piece: exitAndTransfer(idea, req.body.destination) });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  router.post('/ideas/:id/reject', function (req, res) {
    try {
      let idea = q.idea.get(req.params.id); if (!idea || idea.status !== 'active') return res.status(404).json({ error: 'not_found' });
      if (req.body) idea = saveManual(idea, req.body);
      const feedback = clean(req.body && req.body.feedback);
      if (feedback) addFeedback(idea.id, feedback, req.body.source, 1);
      db.prepare("UPDATE ideation_ideas SET status='rejected',exit_reason='not_interested',updated_at=? WHERE id=? AND status='active'").run(now(), idea.id);
      addSignal(idea.id, 'not_interested', feedback ? 0.9 : 0.3, { title: idea.title, bigIdea: idea.big_idea, feedback: feedback });
      ensureQueue(); enqueue('profile', q.settings.get().selected_provider, null, 1);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  router.post('/jobs/:id/retry', function (req, res) {
    const job = db.prepare("SELECT * FROM ideation_jobs WHERE id=? AND status='error'").get(req.params.id);
    if (!job) return res.status(404).json({ error: 'not_found' });
    db.prepare("UPDATE ideation_jobs SET status='pending',error=NULL,activity='[]',updated_at=? WHERE id=?").run(now(), job.id); setImmediate(runWorker); res.json({ ok: true });
  });

  if (autoStart) {
    ensureQueue();
    setImmediate(runWorker);
  }
  return { router: router, state: state, ensureQueue: ensureQueue };
}

module.exports = { setup: setup };
