'use strict';

const elevenlabs = require('./elevenlabs');
const openaiTts = require('./openaiTts');

// Agent identity and speech provider are related by configuration, not by
// provider-specific branches spread through the app. These two defaults are
// today's requested mapping and can be changed independently later.
const PROVIDER_BY_AGENT = Object.freeze({
  claude: process.env.VOICE_TTS_PROVIDER_CLAUDE || 'elevenlabs',
  codex: process.env.VOICE_TTS_PROVIDER_CODEX || 'openai'
});

function providerForAgent(agent) {
  return PROVIDER_BY_AGENT[agent === 'codex' ? 'codex' : 'claude'];
}

async function synthesizeSpeech(agent, text) {
  const provider = providerForAgent(agent);
  if (provider === 'elevenlabs') {
    return {
      provider: provider,
      body: await elevenlabs.synthesizeSpeech(text),
      contentType: 'audio/mpeg',
      streaming: false
    };
  }
  if (provider === 'openai') {
    const result = await openaiTts.synthesizeSpeech(text);
    result.provider = provider;
    return result;
  }
  throw new Error('unsupported_tts_provider_' + provider);
}

module.exports = { providerForAgent, synthesizeSpeech };
