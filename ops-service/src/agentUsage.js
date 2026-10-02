'use strict';

// Codex subscription usage from the host installation. Only a strict,
// non-sensitive normalized result is returned to callers.
const { spawn } = require('child_process');

const HOST = process.env.AGENT_USAGE_HOST || process.env.CODEX_HOST || 'ubuntu@host.docker.internal';
const CODEX_BIN = process.env.CODEX_HOST_BIN || '/root/.local/bin/codex';
const CACHE_MS = Math.max(30000, Number(process.env.AGENT_USAGE_CACHE_MS) || 120000);
const TIMEOUT_MS = Math.max(3000, Number(process.env.AGENT_USAGE_TIMEOUT_MS) || 12000);

let cached = null;
let cachedAt = 0;
let inFlight = null;

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function remaining(used) {
  const n = Number(used);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round((100 - n) * 10) / 10));
}

function limit(name, kind, used, resetAt, windowMinutes) {
  return {
    name: name,
    kind: kind,
    remainingPercentage: remaining(used),
    resetAt: resetAt || null,
    windowMinutes: Number.isFinite(Number(windowMinutes)) ? Number(windowMinutes) : null
  };
}

function planName(value) {
  const raw = String(value || '').toLowerCase();
  if (raw === 'prolite') return 'Pro Lite';
  return raw ? raw.replace(/^./, function (c) { return c.toUpperCase(); }) : null;
}

async function fetchCodex() {
  const command = 'sudo -H ' + shellQuote(CODEX_BIN) + ' app-server';
  try {
    const child = spawn('ssh', [HOST, command], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    let stderr = '';
    let settled = false;
    let rateResult = null;
    let configResult = null;
    const result = await new Promise(function (resolve, reject) {
      function finish(err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { child.kill('SIGTERM'); } catch (e) { /* best effort */ }
        if (err) reject(err); else resolve({ rates: rateResult, config: configResult });
      }
      function send(value) { child.stdin.write(JSON.stringify(value) + '\n'); }
      function handle(message) {
        if (message.id === 1 && message.result) {
          send({ method: 'initialized', params: {} });
          send({ id: 2, method: 'account/rateLimits/read', params: {} });
          send({ id: 3, method: 'config/read', params: { cwd: '/srv/realitymanual-repo', includeLayers: false } });
        } else if (message.id === 2) rateResult = message.result;
        else if (message.id === 3) configResult = message.result;
        if (rateResult && configResult) finish();
      }
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', function (chunk) {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        lines.forEach(function (line) { if (line.trim()) { try { handle(JSON.parse(line)); } catch (e) { /* wait for valid JSONL */ } } });
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', function (chunk) { stderr += chunk; });
      child.on('error', finish);
      child.on('close', function (code) { if (!settled) finish(new Error((stderr || ('Codex app-server exited ' + code)).trim().slice(0, 500))); });
      const timer = setTimeout(function () { finish(new Error('usage request timed out')); }, TIMEOUT_MS);
      send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'rm-content-studio-usage', version: '1.0.0' }, capabilities: { experimentalApi: true } } });
    });
    const rates = result.rates || {};
    const root = rates.rateLimits || {};
    const windows = [root.primary, root.secondary].filter(Boolean);
    const seen = new Set();
    const limits = windows.filter(function (item) {
      const key = String(item.windowDurationMins) + ':' + String(item.resetsAt);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).map(function (item) {
      const mins = Number(item.windowDurationMins);
      const name = mins === 300 ? '5-hour' : mins === 10080 ? 'Weekly' : (mins ? (Math.round(mins / 60) + '-hour') : 'Usage limit');
      return limit(name, mins === 300 ? 'session' : mins === 10080 ? 'weekly' : 'other', item.usedPercent,
        item.resetsAt ? new Date(Number(item.resetsAt) * 1000).toISOString() : null, mins);
    });
    const config = (result.config && result.config.config) || {};
    const credits = root.credits || null;
    return {
      provider: 'codex', displayName: 'Codex', available: true,
      plan: planName(root.planType),
      currentModel: config.model || null,
      reasoningLevel: config.model_reasoning_effort || null,
      limits: limits,
      extraCredits: credits ? { enabled: Boolean(credits.hasCredits || credits.unlimited), unlimited: Boolean(credits.unlimited), remaining: credits.balance == null ? null : Number(credits.balance) } : null
    };
  } catch (err) {
    console.error('Codex usage retrieval failed:', err.message);
    return { provider: 'codex', displayName: 'Codex', available: false, error: 'Usage data unavailable', limits: [] };
  }
}

async function getUsage(options) {
  const force = Boolean(options && options.force);
  if (!force && cached && Date.now() - cachedAt < CACHE_MS) return Object.assign({}, cached, { cached: true });
  if (inFlight) return inFlight;
  inFlight = Promise.all([fetchCodex()]).then(function (providers) {
    const value = { providers: providers, lastUpdated: new Date().toISOString(), cached: false, cacheSeconds: Math.round(CACHE_MS / 1000) };
    cached = value;
    cachedAt = Date.now();
    return value;
  }).finally(function () { inFlight = null; });
  return inFlight;
}

function invalidate() { cachedAt = 0; }

module.exports = { getUsage: getUsage, invalidate: invalidate, _fetchCodex: fetchCodex };
