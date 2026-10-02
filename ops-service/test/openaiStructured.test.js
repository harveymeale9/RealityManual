'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.OPENAI_STRUCTURED_MODEL = 'gpt-5.4-mini';
process.env.OPENAI_RESEARCH_MODEL = 'gpt-5.4-mini';
const structured = require('../src/openaiStructured');

const schema = {
  type: 'object', additionalProperties: false,
  properties: { answer: { type: 'string' } }, required: ['answer']
};

function response(value) {
  return {
    ok: true,
    status: 200,
    json: async function () {
      return {
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }]
      };
    }
  };
}

test('restricted structured calls expose no tools and do not store responses', async function () {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async function (url, options) { request = { url: url, options: options }; return response({ answer: 'safe' }); };
  try {
    const result = await structured.generate('classify this', schema, { name: 'mail triage' });
    assert.deepEqual(result, { answer: 'safe' });
    const body = JSON.parse(request.options.body);
    assert.equal(request.options.headers.Authorization, 'Bearer test-openai-key');
    assert.equal(body.model, 'gpt-5.4-mini');
    assert.equal(body.store, false);
    assert.equal(body.tools, undefined);
    assert.equal(body.text.format.type, 'json_schema');
    assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.name, 'mail_triage');
  } finally {
    global.fetch = originalFetch;
  }
});

test('research calls expose only OpenAI web search', async function () {
  const originalFetch = global.fetch;
  let body;
  global.fetch = async function (url, options) { body = JSON.parse(options.body); return response({ answer: 'researched' }); };
  try {
    const result = await structured.generateWithWebSearch('research this', schema, { name: 'research' });
    assert.deepEqual(result, { answer: 'researched' });
    assert.deepEqual(body.tools, [{ type: 'web_search' }]);
    assert.equal(body.store, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('non-completed responses fail closed', async function () {
  const originalFetch = global.fetch;
  global.fetch = async function () {
    return { ok: true, status: 200, json: async function () { return { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }; } };
  };
  try {
    await assert.rejects(structured.generate('classify this', schema), /openai_structured_incomplete/);
  } finally {
    global.fetch = originalFetch;
  }
});
