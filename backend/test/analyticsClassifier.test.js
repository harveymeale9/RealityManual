const test = require('node:test');
const assert = require('node:assert/strict');

process.env.CORS_ORIGIN = 'https://realitymanual.com';

const { classifyAnalyticsRequest } = require('../src/services/analyticsClassifier');

function request(headers = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  return { get(name) { return normalized[name.toLowerCase()] || ''; } };
}

const browserHeaders = {
  origin: 'https://realitymanual.com',
  'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
  'sec-fetch-site': 'same-site',
};

test('accepts a consenting browser event with interaction evidence', () => {
  assert.deepEqual(
    classifyAnalyticsRequest(request(browserHeaders), {
      human_verified: true,
      human_verification: 'interaction',
    }),
    { verifiedHuman: true, method: 'interaction', reason: 'verified' }
  );
});

test('rejects known crawlers even when they forge the browser payload', () => {
  const result = classifyAnalyticsRequest(request({
    ...browserHeaders,
    'user-agent': 'Mozilla/5.0 compatible; GPTBot/1.0',
  }), { human_verified: true, human_verification: 'interaction' });
  assert.equal(result.verifiedHuman, false);
  assert.equal(result.reason, 'automated_user_agent');
});

test('rejects direct scripts, foreign origins, and page loads without human evidence', () => {
  assert.equal(classifyAnalyticsRequest(request({
    origin: 'https://realitymanual.com',
    'user-agent': 'curl/8.0',
  }), { human_verified: true, human_verification: 'interaction' }).verifiedHuman, false);

  assert.equal(classifyAnalyticsRequest(request({
    ...browserHeaders,
    origin: 'https://example.com',
  }), { human_verified: true, human_verification: 'interaction' }).verifiedHuman, false);

  assert.equal(classifyAnalyticsRequest(request(browserHeaders), {
    human_verified: false,
  }).verifiedHuman, false);
});
