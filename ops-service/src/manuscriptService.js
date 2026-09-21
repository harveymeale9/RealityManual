'use strict';

const express = require('express');
const crypto = require('crypto');
const corpus = require('./ideationCorpus');
const providers = require('./ideationProviders');

function now() { return new Date().toISOString(); }
function clean(value, max) { return String(value || '').trim().slice(0, max || 100000); }
function json(value, fallback) { try { return JSON.parse(value); } catch (e) { return fallback; } }

function readerText(value) {
  return String(value || '')
    .replace(/^==END PAGE \d+==\s*$/gm, '')
    .replace(/^\*IMAGE:.*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function pages() {
  return corpus.loadManuscript().pages.map(function (entry) {
    return { page: entry.page, text: readerText(entry.text) };
  });
}

function extractJson(text) {
  let raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('AI search returned no JSON');
  raw = raw.slice(start, raw.lastIndexOf('}') + 1);
  return JSON.parse(raw);
}

function fallbackExcerpt(text) {
  const paragraph = String(text || '').split(/\n\s*\n/).map(function (part) { return part.trim(); }).find(function (part) {
    return part.length > 60;
  }) || String(text || '').trim();
  return paragraph.slice(0, 360) + (paragraph.length > 360 ? '…' : '');
}

function normalizeResults(raw, pageMap) {
  const source = raw && Array.isArray(raw.results) ? raw.results : [];
  const seen = new Set();
  return source.map(function (item) {
    const page = Number(item && item.page);
    const sourcePage = pageMap.get(page);
    if (!sourcePage || seen.has(page)) return null;
    seen.add(page);
    let excerpt = clean(item.excerpt, 500);
    if (!excerpt || corpus.normalize(sourcePage.text).indexOf(corpus.normalize(excerpt)) === -1) {
      excerpt = fallbackExcerpt(sourcePage.text);
    }
    return {
      page: page,
      title: clean(item.title, 180) || 'Page ' + page,
      relevance: clean(item.relevance, 700) || 'This passage is relevant to the search.',
      excerpt: excerpt
    };
  }).filter(Boolean).slice(0, 8);
}

function searchPrompt(query) {
  return `You are the semantic finder for The Reality Manual. Read the canonical manuscript file THE_REALITY_MANUAL_COMPLETE_MANUSCRIPT.txt and find the passages that best answer or illuminate the user's request below.

This is meaning-based research, not keyword matching. Search for relevant arguments, Rules, definitions, implications, examples, and closely related concepts even when the manuscript uses different words. Rank only genuinely useful passages. Prefer distinct results that illuminate different facets over adjacent duplicate pages. Never edit any file.

USER REQUEST: ${JSON.stringify(query)}

Return strict JSON only, with no markdown: {"results":[{"page":34,"title":"short descriptive label","relevance":"one concise sentence explaining why this answers the request","excerpt":"an exact short quotation copied from that page"}]}. Return 3-8 results when supported. Every page must be an integer from 1 through 180 and every excerpt must occur verbatim on that page. Do not invent quotations.`;
}

function setup(db, options) {
  options = options || {};
  const providerEngine = options.providers || providers;
  const autoStart = options.autoStart !== false;
  const manuscriptPages = pages();
  const pageMap = new Map(manuscriptPages.map(function (entry) { return [entry.page, entry]; }));

  db.exec(`
    CREATE TABLE IF NOT EXISTS manuscript_search_jobs (
      id TEXT PRIMARY KEY, query TEXT NOT NULL, status TEXT NOT NULL,
      provider TEXT NOT NULL, results TEXT NOT NULL DEFAULT '[]',
      activity TEXT NOT NULL DEFAULT '[]', error TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_manuscript_search_status ON manuscript_search_jobs(status, created_at);
  `);
  db.prepare("UPDATE manuscript_search_jobs SET status='pending',updated_at=? WHERE status='running'").run(now());

  let workerBusy = false;

  function publicJob(row) {
    if (!row) return null;
    return {
      id: row.id,
      query: row.query,
      status: row.status,
      provider: row.provider,
      results: json(row.results, []),
      activity: json(row.activity, []),
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async function runWorker() {
    if (workerBusy) return;
    workerBusy = true;
    try {
      for (;;) {
        const job = db.prepare("SELECT * FROM manuscript_search_jobs WHERE status='pending' ORDER BY created_at ASC LIMIT 1").get();
        if (!job) break;
        db.prepare("UPDATE manuscript_search_jobs SET status='running',error=NULL,updated_at=? WHERE id=?").run(now(), job.id);
        const activity = [];
        try {
          const result = await providerEngine.generate(job.provider, searchPrompt(job.query), function (line) {
            const message = clean(line, 500);
            if (!message || message.indexOf('💭') === 0) return;
            activity.push(message);
            db.prepare('UPDATE manuscript_search_jobs SET activity=?,updated_at=? WHERE id=?')
              .run(JSON.stringify(activity.slice(-20)), now(), job.id);
          });
          const normalized = normalizeResults(extractJson(result.text), pageMap);
          if (!normalized.length) throw new Error('AI search found no verifiable manuscript passages');
          db.prepare("UPDATE manuscript_search_jobs SET status='done',results=?,updated_at=? WHERE id=?")
            .run(JSON.stringify(normalized), now(), job.id);
          console.log('[manuscript] search complete', job.provider, job.id, normalized.length + ' result(s)');
        } catch (error) {
          console.error('[manuscript] search failed', job.provider, job.id, error.message);
          db.prepare("UPDATE manuscript_search_jobs SET status='error',error=?,updated_at=? WHERE id=?")
            .run(clean(error.message, 2000), now(), job.id);
        }
      }
    } finally {
      workerBusy = false;
    }
  }

  function enqueue(query) {
    const cached = db.prepare("SELECT * FROM manuscript_search_jobs WHERE query=? AND status='done' ORDER BY updated_at DESC LIMIT 1").get(query);
    if (cached) return publicJob(cached);
    const existing = db.prepare("SELECT * FROM manuscript_search_jobs WHERE query=? AND status IN ('pending','running') ORDER BY created_at DESC LIMIT 1").get(query);
    if (existing) return publicJob(existing);
    let provider = 'codex';
    try {
      const setting = db.prepare('SELECT selected_provider FROM ideation_settings WHERE id=1').get();
      if (setting && (setting.selected_provider === 'codex' || setting.selected_provider === 'claude')) provider = setting.selected_provider;
    } catch (e) { /* ideation initializes first in production, but keep this service standalone-testable */ }
    const id = crypto.randomUUID(), stamp = now();
    db.prepare("INSERT INTO manuscript_search_jobs (id,query,status,provider,created_at,updated_at) VALUES (?,?,'pending',?,?,?)")
      .run(id, query, provider, stamp, stamp);
    setImmediate(runWorker);
    return publicJob(db.prepare('SELECT * FROM manuscript_search_jobs WHERE id=?').get(id));
  }

  const router = express.Router();
  router.get('/meta', function (req, res) {
    res.json({ title: 'The Reality Manual', pageCount: manuscriptPages.length });
  });
  router.get('/pages/:page', function (req, res) {
    const requested = Number(req.params.page);
    if (!Number.isInteger(requested) || requested < 1 || requested > manuscriptPages.length) {
      return res.status(400).json({ error: 'invalid_page', pageCount: manuscriptPages.length });
    }
    const leftNumber = requested === 1 ? null : (requested % 2 === 0 ? requested : requested - 1);
    const rightNumber = requested === 1 ? 1 : (requested % 2 === 0 ? requested + 1 : requested);
    res.json({
      requestedPage: requested,
      pageCount: manuscriptPages.length,
      left: leftNumber ? pageMap.get(leftNumber) || null : null,
      right: rightNumber <= manuscriptPages.length ? pageMap.get(rightNumber) || null : null
    });
  });
  router.post('/search', function (req, res) {
    const query = clean(req.body && req.body.query, 1000);
    if (query.length < 3) return res.status(400).json({ error: 'Enter at least three characters.' });
    res.status(202).json(enqueue(query));
  });
  router.get('/search/:id', function (req, res) {
    const job = db.prepare('SELECT * FROM manuscript_search_jobs WHERE id=?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'not_found' });
    res.json(publicJob(job));
  });
  router.post('/search/:id/retry', function (req, res) {
    const job = db.prepare("SELECT * FROM manuscript_search_jobs WHERE id=? AND status='error'").get(req.params.id);
    if (!job) return res.status(404).json({ error: 'not_found' });
    db.prepare("UPDATE manuscript_search_jobs SET status='pending',results='[]',activity='[]',error=NULL,updated_at=? WHERE id=?").run(now(), job.id);
    setImmediate(runWorker);
    res.json(publicJob(db.prepare('SELECT * FROM manuscript_search_jobs WHERE id=?').get(job.id)));
  });

  if (autoStart) setImmediate(runWorker);
  return { router: router, runWorker: runWorker, readerText: readerText, normalizeResults: normalizeResults };
}

module.exports = { setup: setup, readerText: readerText, normalizeResults: normalizeResults, searchPrompt: searchPrompt };
