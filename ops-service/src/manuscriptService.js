'use strict';

const express = require('express');
const crypto = require('crypto');
const corpus = require('./ideationCorpus');
const manuscriptSearchIndex = require('./manuscriptSearchIndex');

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

function setup(db, options) {
  options = options || {};
  const autoStart = options.autoStart !== false;
  const manuscriptPages = pages();
  const pageMap = new Map(manuscriptPages.map(function (entry) { return [entry.page, entry]; }));
  const searchIndex = manuscriptSearchIndex.setup(db, manuscriptPages);

  db.exec(`
    CREATE TABLE IF NOT EXISTS manuscript_search_jobs (
      id TEXT PRIMARY KEY, query TEXT NOT NULL, status TEXT NOT NULL,
      provider TEXT NOT NULL, results TEXT NOT NULL DEFAULT '[]',
      activity TEXT NOT NULL DEFAULT '[]', error TEXT,
      index_fingerprint TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_manuscript_search_status ON manuscript_search_jobs(status, created_at);
  `);
  try { db.exec('ALTER TABLE manuscript_search_jobs ADD COLUMN index_fingerprint TEXT'); } catch (e) { /* already exists */ }
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
        try {
          const results = searchIndex.search(job.query);
          if (!results.length) throw new Error('The manuscript index found no relevant passages');
          db.prepare("UPDATE manuscript_search_jobs SET status='done',provider='instant semantic index',results=?,activity='[]',index_fingerprint=?,updated_at=? WHERE id=?")
            .run(JSON.stringify(results), searchIndex.fingerprint, now(), job.id);
          console.log('[manuscript] indexed search complete', job.id, results.length + ' result(s)');
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
    const cached = db.prepare("SELECT * FROM manuscript_search_jobs WHERE query=? AND status='done' AND index_fingerprint=? ORDER BY updated_at DESC LIMIT 1").get(query, searchIndex.fingerprint);
    if (cached) return publicJob(cached);
    const existing = db.prepare("SELECT * FROM manuscript_search_jobs WHERE query=? AND status IN ('pending','running') ORDER BY created_at DESC LIMIT 1").get(query);
    if (existing) return publicJob(existing);
    const id = crypto.randomUUID(), stamp = now();
    const results = searchIndex.search(query);
    const status = results.length ? 'done' : 'error';
    const error = results.length ? null : 'The manuscript index found no relevant passages';
    db.prepare('INSERT INTO manuscript_search_jobs (id,query,status,provider,results,error,index_fingerprint,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, query, status, 'instant semantic index', JSON.stringify(results), error, searchIndex.fingerprint, stamp, stamp);
    return publicJob(db.prepare('SELECT * FROM manuscript_search_jobs WHERE id=?').get(id));
  }

  const router = express.Router();
  router.get('/meta', function (req, res) {
    res.json({ title: 'The Reality Manual', pageCount: manuscriptPages.length, search: 'instant semantic index' });
  });
  router.get('/download', function (req, res) {
    // The parent server mounts this router behind requireAuth, so the full
    // unpublished manuscript remains private while still being a one-tap
    // download from Harvey's logged-in phone or desktop.
    res.download(corpus.loadManuscript().file, 'The Reality Manual - Complete Manuscript.txt');
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
    const job = enqueue(query);
    res.status(job.status === 'done' ? 200 : 202).json(job);
  });
  router.get('/search/:id', function (req, res) {
    const job = db.prepare('SELECT * FROM manuscript_search_jobs WHERE id=?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'not_found' });
    res.json(publicJob(job));
  });
  router.post('/search/:id/retry', function (req, res) {
    const job = db.prepare("SELECT * FROM manuscript_search_jobs WHERE id=? AND status='error'").get(req.params.id);
    if (!job) return res.status(404).json({ error: 'not_found' });
    const results = searchIndex.search(job.query);
    db.prepare("UPDATE manuscript_search_jobs SET status=?,provider='instant semantic index',results=?,activity='[]',error=?,index_fingerprint=?,updated_at=? WHERE id=?")
      .run(results.length ? 'done' : 'error', JSON.stringify(results), results.length ? null : 'The manuscript index found no relevant passages', searchIndex.fingerprint, now(), job.id);
    res.json(publicJob(db.prepare('SELECT * FROM manuscript_search_jobs WHERE id=?').get(job.id)));
  });

  if (autoStart) setImmediate(runWorker);
  return { router: router, runWorker: runWorker, readerText: readerText, normalizeResults: normalizeResults };
}

module.exports = { setup: setup, readerText: readerText, normalizeResults: normalizeResults };
