const METRICS_URL = 'https://api.resend.com/emails/metrics';
const metric = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
let cached = null;
let expiresAt = 0;

export async function getEmailHealth(env) {
  const domain = String(env.RESEND_FROM_EMAIL || '').match(/@([a-z0-9.-]+)(?:>|\s|$)/i)?.[1]?.toLowerCase();
  if (!env.RESEND_API_KEY || !domain) throw new Error('Email health is not configured.');
  if (cached && cached.domain === domain && Date.now() < expiresAt) return cached;
  const end = new Date();
  async function range(days) {
    const params = new URLSearchParams({
      start_date: new Date(end.getTime() - days * 86400000).toISOString(),
      end_date: end.toISOString(), dimensions: 'domain',
      metrics: 'sent,delivered,bounced,failed,suppressed,complained,delivery_delayed,delivery_rate,bounce_rate',
    });
    const response = await fetch(`${METRICS_URL}?${params}`, {
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}` }, signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Resend metrics returned ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body.data)) throw new Error('Resend metrics response has no domain data.');
    const row = body.data.find((item) => String(item.domain_name || '').toLowerCase() === domain) || {};
    return {
      days, sent: metric(row.sent), delivered: metric(row.delivered), bounced: metric(row.bounced),
      failed: metric(row.failed), suppressed: metric(row.suppressed), complained: metric(row.complained),
      delivery_delayed: metric(row.delivery_delayed), delivery_rate: metric(row.delivery_rate),
      bounce_rate: metric(row.bounce_rate),
    };
  }
  const [seven, thirty] = await Promise.all([range(7), range(30)]);
  cached = { provider: 'Resend', domain, checked_at: end.toISOString(), last_7_days: seven, last_30_days: thirty };
  expiresAt = Date.now() + 300000;
  return cached;
}
