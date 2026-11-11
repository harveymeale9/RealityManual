// The browser supplies campaign tags, not a verified identity. Keep only the
// fields needed to explain an order's source; never persist a full referrer
// URL, which can carry customer information in its query string.
function clean(value, max = 120) {
  return String(value == null ? '' : value).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max);
}

function referrerHost(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? clean(url.hostname.toLowerCase(), 180) : '';
  } catch { return ''; }
}

function touch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const date = new Date(input.captured_at);
  return {
    source: clean(input.utm_source), medium: clean(input.utm_medium),
    campaign: clean(input.utm_campaign), content: clean(input.utm_content),
    referrer_host: referrerHost(input.referrer),
    captured_at: Number.isFinite(date.getTime()) ? date.toISOString() : null,
  };
}

function normalizeOrderAttribution(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const first = touch(input.first);
  const lastTagged = touch(input.last_tagged);
  if (!first && !lastTagged) return null;
  return JSON.stringify({ first, last_tagged: lastTagged?.source ? lastTagged : null });
}

module.exports = { normalizeOrderAttribution };
