'use strict';

const openaiTts = require('./openaiTts');

function providerForAgent(agent) {
  return process.env.VOICE_TTS_PROVIDER_CODEX || 'openai';
}

async function synthesizeSpeech(agent, text) {
  const provider = providerForAgent(agent);
  if (provider === 'openai') {
    const result = await openaiTts.synthesizeSpeech(text);
    result.provider = provider;
    return result;
  }
  throw new Error('unsupported_tts_provider_' + provider);
}

module.exports = { providerForAgent, synthesizeSpeech };
