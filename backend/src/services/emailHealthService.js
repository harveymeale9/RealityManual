const config = require('../config');

const CACHE_MS = 5 * 60 * 1000;
const METRICS_URL = 'https://api.resend.com/emails/metrics';

function sendingDomain(fromEmail) {
  const match = String(fromEmail || '').match(/@([a-z0-9.-]+)(?:>|\s|$)/i);
  return match ? match[1].toLowerCase() : '';
}

function metric(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function createEmailHealthService({
  apiKey = config.resend.apiKey,
  fromEmail = config.resend.fromEmail,
  fetchImpl = global.fetch,
  now = () => Date.now(),
} = {}) {
  let cached = null;
  let expiresAt = 0;
  let pending = null;
  const domain = sendingDomain(fromEmail);

  async function range(days, end) {
    const start = new Date(end.getTime() - days * 86400000);
    const params = new URLSearchParams({
      start_date: start.toISOString(),
      end_date: end.toISOString(),
      dimensions: 'domain',
      metrics: 'sent,delivered,bounced,failed,suppressed,complained,delivery_delayed,delivery_rate,bounce_rate',
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetchImpl(`${METRICS_URL}?${params}`, {
        headers: { Authorization: `Bearer ${apiKey}` }, signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Resend metrics returned ${response.status}`);
      const body = await response.json();
      if (!Array.isArray(body.data)) throw new Error('Resend metrics response has no domain data');
      const row = body.data.find((item) => String(item.domain_name || '').toLowerCase() === domain) || {};
      return {
        days,
        sent: metric(row.sent),
        delivered: metric(row.delivered),
        bounced: metric(row.bounced),
        failed: metric(row.failed),
        suppressed: metric(row.suppressed),
        complained: metric(row.complained),
        delivery_delayed: metric(row.delivery_delayed),
        delivery_rate: metric(row.delivery_rate),
        bounce_rate: metric(row.bounce_rate),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function get() {
    if (!apiKey || !domain) throw new Error('Resend email health is not configured');
    const timestamp = now();
    if (cached && timestamp < expiresAt) return cached;
    if (pending) return pending;
    pending = (async () => {
      const end = new Date(timestamp);
      const [seven, thirty] = await Promise.all([range(7, end), range(30, end)]);
      cached = { provider: 'Resend', domain, checked_at: end.toISOString(), last_7_days: seven, last_30_days: thirty };
      expiresAt = now() + CACHE_MS;
      return cached;
    })();
    try { return await pending; }
    finally { pending = null; }
  }

  return { get };
}

module.exports = { createEmailHealthService, sendingDomain };
