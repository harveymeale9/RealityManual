'use strict';

const express = require('express');
const crypto = require('crypto');
const manual = require('./manualConceptIndex');

const TARGET_ACTIVE = 10;
const SOURCES = [
  ['Naval Ravikant', 'happiness, desire, freedom, wealth, judgment and self-knowledge'],
  ['Kapil Gupta', 'truth, conditioning, prescriptions, freedom and self-mastery'],
  ['Jiddu Krishnamurti', 'conditioning, observation, fear, thought and psychological freedom'],
  ['Alan Watts', 'self, reality, control, play and non-duality'],
  ['Michael A. Singer', 'inner freedom, resistance, surrender and consciousness'],
  ['Byron Katie', 'belief inquiry, suffering, interpretation and reality'],
  ['Anthony de Mello', 'awareness, attachment, illusion and happiness'],
  ['Eckhart Tolle', 'presence, ego, resistance, suffering and acceptance'],
  ['Rupert Spira', 'consciousness, experience, self and non-duality'],
  ['Donald Hoffman', 'perception, reality, consciousness and evolutionary interfaces'],
  ['Bernardo Kastrup', 'analytic idealism, mind, matter and consciousness'],
  ['Iain McGilchrist', 'attention, perception, meaning and divided modes of knowing'],
  ['Sam Harris', 'consciousness, free will, meditation, morality and self'],
  ['Jordan Peterson', 'meaning, responsibility, order, suffering and narrative'],
  ['Carl Jung', 'shadow, individuation, archetypes, meaning and the unconscious'],
  ['Viktor Frankl', 'meaning, suffering, choice and responsibility'],
  ['Gabor Maté', 'trauma, adaptation, authenticity and emotional health'],
  ['Peter Crone', 'mental constructs, identity, limiting beliefs and freedom'],
  ['Ram Dass', 'awareness, identity, love, suffering and spiritual practice'],
  ['Adyashanti', 'awakening, identity, truth and non-resistance'],
  ['David Bohm', 'wholeness, thought, dialogue and the implicate order'],
  ['Philip Goff', 'consciousness, panpsychism and the limits of physicalism'],
  ['David Chalmers', 'consciousness, experience and the hard problem'],
  ['Anil Seth', 'perception, prediction, self and controlled hallucination'],
  ['Nassim Nicholas Taleb', 'uncertainty, antifragility, risk and agency'],
  ['Daniel Kahneman', 'judgment, bias, attention and decision-making'],
  ['Robert Sapolsky', 'behavior, biology, context and free will'],
  ['Steven Pinker', 'reason, human nature, progress and cognition'],
  ['James Clear', 'habits, identity, systems and behavior change'],
  ['William B. Irvine', 'Stoicism, desire, control and tranquility'],
  ['Ryan Holiday', 'Stoicism, obstacle, discipline and acceptance'],
  ['Robert Greene', 'power, human nature, mastery and social behavior'],
  ['Shane Parrish', 'mental models, judgment, decisions and clear thinking'],
  ['Josh Waitzkin', 'learning, performance, presence and mastery'],
  ['Joe Dispenza', 'belief, identity, emotion and personal transformation'],
  ['Deepak Chopra', 'consciousness, mind-body experience and spirituality'],
  ['Teal Swan', 'emotional healing, trauma, subconscious needs and shadow integration'],
  ['Mark Manson', 'values, responsibility, meaning, acceptance and emotional trade-offs'],
  ["Alex O'Connor", 'philosophy, religion, free will, morality, meaning and skepticism'],
  ['The Mindset Mentor Podcast', 'beliefs, habits, identity and behavioral change'],
  ['Chase Hughes', 'behavior, influence, persuasion, subconscious cues and agency']
].map(function (row, index) { return { id: 'source-' + (index + 1), name: row[0], focus: row[1] }; });

const RESULT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['ideas'],
  properties: { ideas: { type: 'array', minItems: 1, maxItems: 10, items: {
    type: 'object', additionalProperties: false,
    required: ['bigIdea', 'thinkerNames', 'manualConceptIds', 'outlierMatches'],
    properties: {
      bigIdea: { type: 'string' },
      thinkerNames: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' } },
      manualConceptIds: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' } },
      outlierMatches: { type: 'array', maxItems: 3, items: {
        type: 'object', additionalProperties: false, required: ['videoId', 'why'],
        properties: { videoId: { type: 'string' }, why: { type: 'string' } }
      } }
    }
  } } }
};

function now() { return new Date().toISOString(); }
function uuid() { return crypto.randomUUID(); }
function clean(value, max) { return String(value == null ? '' : value).trim().slice(0, max || 10000); }
function json(value, fallback) { try { return JSON.parse(value); } catch (error) { return fallback; } }
function esc(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function label(text) { const first = clean(text, 6000).split(/(?<=[.!?])\s+/)[0] || 'Research idea'; return first.length > 140 ? first.slice(0, 137) + '…' : first; }

function setup(db, options) {
  options = options || {};
  const generateIdeas = options.generateIdeas;
  const autoStart = options.autoStart !== false;
  db.exec(`
    CREATE TABLE IF NOT EXISTS research_ideas (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, sort_order REAL NOT NULL,
      big_idea TEXT NOT NULL, thinker_names TEXT NOT NULL, manual_concepts TEXT NOT NULL,
      outlier_matches TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', approved INTEGER NOT NULL DEFAULT 0,
      destination_piece_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_research_ideas_active ON research_ideas(status,sort_order);
    CREATE TABLE IF NOT EXISTS research_idea_jobs (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, requested_count INTEGER NOT NULL,
      error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  let workerBusy = false;

  function decode(row) {
    return row && {
      id: row.id, status: row.status, sortOrder: row.sort_order, bigIdea: row.big_idea,
      thinkerNames: json(row.thinker_names, []), manualConcepts: json(row.manual_concepts, []),
      outlierMatches: json(row.outlier_matches, []), notes: row.notes || '', approved: !!row.approved,
      destinationPieceId: row.destination_piece_id || null, createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  function activeIdeas() { return db.prepare("SELECT * FROM research_ideas WHERE status='active' ORDER BY sort_order,created_at").all().map(decode); }
  function currentOutliers() {
    let rows = [];
    try { rows = db.prepare('SELECT channel_id,title,snapshot_json FROM youtube_competitor_channels WHERE snapshot_json IS NOT NULL').all(); } catch (error) { return []; }
    const found = [];
    rows.forEach(function (row) {
      const snap = json(row.snapshot_json, {});
      (snap.videos || []).forEach(function (video) {
        if (!video.isOneInTenOutlier || !video.captionAnalysisAvailable || !video.creativeAnalysis) return;
        found.push({
          videoId: clean(video.id, 200), channel: clean(snap.title || row.title, 300), title: clean(video.title, 500),
          views: Number(video.views) || 0, medianViews: Number(snap.medianViews) || 0,
          lift: snap.medianViews ? Math.round((Number(video.views) || 0) / snap.medianViews * 10) / 10 : null,
          topic: clean(video.creativeAnalysis.topic, 600), bigIdea: clean(video.creativeAnalysis.bigIdea, 1000), angle: clean(video.creativeAnalysis.angle, 1000)
        });
      });
    });
    return found;
  }

  function state() {
    const jobs = db.prepare("SELECT * FROM research_idea_jobs WHERE status IN ('pending','running','error') ORDER BY created_at DESC LIMIT 10").all();
    return { ideas: activeIdeas(), sources: SOURCES, sourceCount: SOURCES.length, targetCount: TARGET_ACTIVE, outlierCount: currentOutliers().length,
      jobs: jobs.map(function (row) { return { id: row.id, status: row.status, requestedCount: row.requested_count, error: row.error }; }) };
  }

  function enqueue(count) {
    count = Math.max(1, Math.min(Number(count) || 1, TARGET_ACTIVE));
    const stamp = now();
    db.prepare('INSERT INTO research_idea_jobs (id,status,requested_count,error,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(uuid(), 'pending', count, null, stamp, stamp);
    if (autoStart) setImmediate(runWorker);
  }

  function ensureQueue() {
    const active = db.prepare("SELECT count(*) n FROM research_ideas WHERE status='active'").get().n;
    // An errored job still represents the missing queue slots until Harvey
    // retries or requests a fresh set. Counting it prevents an outage from
    // creating an unbounded chain of automatic replacement jobs.
    const queued = db.prepare("SELECT coalesce(sum(requested_count),0) n FROM research_idea_jobs WHERE status IN ('pending','running','error')").get().n;
    if (active + queued < TARGET_ACTIVE) enqueue(TARGET_ACTIVE - active - queued);
  }

  function prompt(count, outliers, nonce, history) {
    const orderedSources = SOURCES.slice().sort(function (a, b) {
      const left = crypto.createHash('sha1').update(String(nonce) + a.id).digest('hex');
      const right = crypto.createHash('sha1').update(String(nonce) + b.id).digest('hex');
      return left.localeCompare(right);
    });
    return [
      'Generate exactly ' + count + ' concise, sophisticated Big Ideas for Reality Manual content.',
      'A Big Idea is a clear claim or reframing, not a topic, title, outline, slogan, question, or generic self-help advice. It should expose a mistaken assumption, reveal a causal mechanism, or derive a surprising conclusion. Two to five sentences maximum.',
      'Use the thinker list as intellectual lenses for synthesis. Do not invent quotations, claim a thinker said something specific, or imply this is a researched quotation corpus. thinkerNames only identifies the useful lens behind the synthesis.',
      'Use the canonical Manual map to make each idea genuinely native to Harvey\'s body of work. Return only exact concept IDs supplied below.',
      'The outlier set contains summaries derived solely from real public captions of statistically genuine 1-in-10 videos. Check every proposed idea against it. Add an outlier match only when it materially corroborates the premise, mechanism, or angle; never force a match and return only exact video IDs supplied below.',
      'Avoid semantic duplicates within this batch. Prefer varied thinkers, rules, mechanisms, applications and tensions. The full source pool must influence selection over time, rather than repeatedly defaulting to the most famous names.',
      'This is exploration batch ' + nonce + '. Use its shuffled source order to vary which combinations you notice first.',
      'SOURCE POOL (' + SOURCES.length + '):\n' + orderedSources.map(function (item) { return item.name + ' — ' + item.focus; }).join('\n'),
      'CANONICAL MANUAL CONCEPTS:\n' + manual.CONCEPTS.map(function (item) { return item.id + ' | ' + item.title + ' | ' + item.thesis; }).join('\n'),
      'CAPTION-DERIVED 1-IN-10 OUTLIERS:\n' + (outliers.length ? JSON.stringify(outliers) : 'None currently available. Return no outlier matches.'),
      'RECENT IDEAS TO AVOID REPEATING:\n' + (history.length ? history.join('\n') : 'None yet.'),
      'Return the required JSON object only.'
    ].join('\n\n');
  }

  function validateResult(result, count, outliers) {
    const names = new Set(SOURCES.map(function (item) { return item.name; }));
    const concepts = new Map(manual.CONCEPTS.map(function (item) { return [item.id, item]; }));
    const videos = new Map(outliers.map(function (item) { return [item.videoId, item]; }));
    return ((result && result.ideas) || []).slice(0, count).map(function (idea) {
      const bigIdea = clean(idea.bigIdea, 6000);
      if (bigIdea.length < 30) return null;
      return {
        bigIdea: bigIdea,
        thinkerNames: Array.from(new Set((idea.thinkerNames || []).map(function (name) { return clean(name, 200); }).filter(function (name) { return names.has(name); }))).slice(0, 4),
        manualConcepts: Array.from(new Set(idea.manualConceptIds || [])).map(function (id) { return concepts.get(String(id)); }).filter(Boolean).slice(0, 4).map(function (item) {
          return { id: item.id, title: item.title, pages: item.pages, quote: item.quote, quotePage: item.quotePage };
        }),
        outlierMatches: (idea.outlierMatches || []).map(function (match) {
          const video = videos.get(clean(match.videoId, 200));
          return video ? Object.assign({}, video, { why: clean(match.why, 800) }) : null;
        }).filter(Boolean).slice(0, 3)
      };
    }).filter(function (idea) { return idea && idea.thinkerNames.length && idea.manualConcepts.length; });
  }

  async function processJob(job) {
    if (typeof generateIdeas !== 'function') throw new Error('Research idea generation is not configured.');
    const outliers = currentOutliers();
    const history = db.prepare('SELECT big_idea FROM research_ideas ORDER BY created_at DESC LIMIT 40').all().map(function (row) { return clean(row.big_idea, 1000); });
    const result = await generateIdeas({ prompt: prompt(job.requested_count, outliers, job.id, history), schema: RESULT_SCHEMA });
    const ideas = validateResult(result, job.requested_count, outliers);
    if (ideas.length < job.requested_count) throw new Error('Idea generator returned an incomplete or unverifiable batch.');
    const max = db.prepare("SELECT coalesce(max(sort_order),0) n FROM research_ideas WHERE status='active'").get().n;
    const stamp = now();
    const insert = db.prepare(`INSERT INTO research_ideas
      (id,status,sort_order,big_idea,thinker_names,manual_concepts,outlier_matches,notes,approved,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    db.transaction(function () { ideas.forEach(function (idea, index) {
      insert.run(uuid(), 'active', max + index + 1, idea.bigIdea, JSON.stringify(idea.thinkerNames), JSON.stringify(idea.manualConcepts), JSON.stringify(idea.outlierMatches), '', 0, stamp, stamp);
    }); })();
  }

  async function runWorker() {
    if (workerBusy) return;
    workerBusy = true;
    try {
      let job;
      while ((job = db.prepare("SELECT * FROM research_idea_jobs WHERE status='pending' ORDER BY created_at LIMIT 1").get())) {
        db.prepare("UPDATE research_idea_jobs SET status='running',updated_at=? WHERE id=?").run(now(), job.id);
        try {
          await processJob(job);
          db.prepare("UPDATE research_idea_jobs SET status='done',error=NULL,updated_at=? WHERE id=?").run(now(), job.id);
        } catch (error) {
          db.prepare("UPDATE research_idea_jobs SET status='error',error=?,updated_at=? WHERE id=?").run(clean(error.message, 1000), now(), job.id);
        }
      }
    } finally { workerBusy = false; ensureQueue(); }
  }

  function getActive(id) { return db.prepare("SELECT * FROM research_ideas WHERE id=? AND status='active'").get(clean(id, 200)); }
  function update(id, body) {
    const row = getActive(id); if (!row) throw new Error('Idea not found.');
    const notes = clean(body && body.notes, 12000);
    const approved = body && Object.prototype.hasOwnProperty.call(body, 'approved') ? !!body.approved : !!row.approved;
    db.prepare('UPDATE research_ideas SET notes=?,approved=?,updated_at=? WHERE id=?').run(notes, approved ? 1 : 0, now(), row.id);
    return decode(getActive(row.id));
  }
  function reject(id) {
    const row = getActive(id); if (!row) throw new Error('Idea not found.');
    db.prepare("UPDATE research_ideas SET status='rejected',updated_at=? WHERE id=?").run(now(), row.id);
    ensureQueue(); return { ok: true };
  }
  function transfer(id) {
    const row = getActive(id); if (!row) throw new Error('Idea not found.');
    const idea = decode(row);
    const pieces = db.prepare("SELECT data FROM records WHERE store_name='pieces'").all().map(function (item) { return json(item.data, {}); });
    const seq = pieces.reduce(function (max, piece) { return Math.max(max, Number(piece.seq) || 0); }, 0) + 1;
    const orders = pieces.filter(function (piece) { return piece.stage === 'ideation'; }).map(function (piece) { return Number(piece.order); }).filter(Number.isFinite);
    const stamp = now(), pieceId = uuid();
    const sourceItems = idea.thinkerNames.map(function (name) { return '<li>' + esc(name) + '</li>'; }).join('');
    const conceptItems = idea.manualConcepts.map(function (item) { return '<li><b>' + esc(item.title) + '</b> — pp. ' + esc(item.pages.join('–')) + '<br><i>“' + esc(item.quote) + '”</i> (p. ' + Number(item.quotePage) + ')</li>'; }).join('');
    const outlierItems = idea.outlierMatches.map(function (item) { return '<li><b>' + esc(item.title || item.bigIdea) + '</b> (' + esc(item.channel) + (item.lift ? ', ' + item.lift + '× channel median' : '') + ') — ' + esc(item.why) + '</li>'; }).join('');
    const piece = {
      id: pieceId, seq: seq, title: label(idea.bigIdea), stage: 'ideation', platforms: [], contentType: '', contentTypeSelectionExplicit: false,
      notesHtml: '<h3>Big Idea</h3><p>' + esc(idea.bigIdea) + '</p><h3>Research lenses</h3><ul>' + sourceItems + '</ul><h3>Manual connections</h3><ul>' + conceptItems + '</ul>' +
        (outlierItems ? '<h3>1/10 synthesis</h3><ul>' + outlierItems + '</ul>' : '') + (idea.notes ? '<h3>Harvey\'s notes</h3><p>' + esc(idea.notes).replace(/\n/g, '<br>') + '</p>' : ''),
      order: orders.length ? Math.min.apply(Math, orders) - 10 : 0, createdAt: stamp, updatedAt: stamp,
      researchMetadata: { ideaId: idea.id, thinkerNames: idea.thinkerNames, manualConcepts: idea.manualConcepts, outlierMatches: idea.outlierMatches }
    };
    db.transaction(function () {
      db.prepare('INSERT INTO records (store_name,id,data,updated_at) VALUES (?,?,?,?)').run('pieces', pieceId, JSON.stringify(piece), stamp);
      db.prepare("UPDATE research_ideas SET status='transferred',destination_piece_id=?,updated_at=? WHERE id=?").run(pieceId, stamp, row.id);
    })();
    ensureQueue(); return piece;
  }
  function fresh() {
    const stamp = now();
    db.transaction(function () {
      db.prepare("UPDATE research_ideas SET status='superseded',updated_at=? WHERE status='active'").run(stamp);
      db.prepare("UPDATE research_idea_jobs SET status='cancelled',updated_at=? WHERE status IN ('pending','running','error')").run(stamp);
    })();
    enqueue(TARGET_ACTIVE); return { ok: true };
  }

  const router = express.Router();
  router.get('/state', function (req, res) { ensureQueue(); res.json(state()); });
  router.put('/ideas/:id', function (req, res) { try { res.json({ ok: true, idea: update(req.params.id, req.body) }); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/ideas/:id/reject', function (req, res) { try { update(req.params.id, req.body || {}); res.json(reject(req.params.id)); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/ideas/:id/transfer', function (req, res) { try { update(req.params.id, req.body || {}); res.json({ ok: true, piece: transfer(req.params.id) }); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/fresh', function (req, res) { res.json(fresh()); });
  router.post('/jobs/:id/retry', function (req, res) {
    const job = db.prepare("SELECT * FROM research_idea_jobs WHERE id=? AND status='error'").get(req.params.id);
    if (!job) return res.status(404).json({ error: 'not_found' });
    db.prepare("UPDATE research_idea_jobs SET status='pending',error=NULL,updated_at=? WHERE id=?").run(now(), job.id);
    setImmediate(runWorker); res.json({ ok: true });
  });

  if (autoStart) { ensureQueue(); setImmediate(runWorker); }
  return { router: router, state: state, ensureQueue: ensureQueue, runWorker: runWorker, update: update, reject: reject, transfer: transfer, fresh: fresh, currentOutliers: currentOutliers };
}

module.exports = { setup: setup, SOURCES: SOURCES, RESULT_SCHEMA: RESULT_SCHEMA, TARGET_ACTIVE: TARGET_ACTIVE };
