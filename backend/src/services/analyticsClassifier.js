const config = require('../config');

const BOT_PATTERN = /bot|crawler|spider|headless|phantom|selenium|playwright|puppeteer|curl|wget|python-requests|httpclient|facebookexternalhit|meta-externalagent|googleother|bingpreview|bytespider|claudebot|anthropic-ai|gptbot|chatgpt-user|perplexitybot/i;
const BROWSER_PATTERN = /mozilla|chrome|chromium|safari|firefox|edg\//i;
const HUMAN_METHODS = new Set(['interaction', 'visible_time']);

function classifyAnalyticsRequest(req, body) {
  const userAgent = String(req.get('user-agent') || '');
  const origin = String(req.get('origin') || '');
  const fetchSite = String(req.get('sec-fetch-site') || '').toLowerCase();
  const allowedOrigin = config.corsOrigins.includes(origin);

  if (!userAgent || BOT_PATTERN.test(userAgent)) {
    return { verifiedHuman: false, method: null, reason: 'automated_user_agent' };
  }
  if (!allowedOrigin) {
    return { verifiedHuman: false, method: null, reason: 'untrusted_origin' };
  }
  if (!BROWSER_PATTERN.test(userAgent)) {
    return { verifiedHuman: false, method: null, reason: 'non_browser_client' };
  }
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site') {
    return { verifiedHuman: false, method: null, reason: 'cross_site_request' };
  }

  const method = String(body.human_verification || '');
  if (body.human_verified !== true || !HUMAN_METHODS.has(method)) {
    return { verifiedHuman: false, method: null, reason: 'no_human_evidence' };
  }

  return { verifiedHuman: true, method, reason: 'verified' };
}

module.exports = { classifyAnalyticsRequest };
