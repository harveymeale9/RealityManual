'use strict';

// OpenAI speech synthesis is deliberately separate from the host Codex
// login. Codex continues to authenticate with ChatGPT on the VPS; this
// module uses an API key only for the Audio API and never exposes it to the
// browser, logs, or Project Manager history.
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_TTS_BASE_URL = (process.env.OPENAI_TTS_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE || 'spruce';

async function synthesizeSpeech(text) {
  if (!OPENAI_API_KEY) {
    const err = new Error('OPENAI_API_KEY not configured for OpenAI TTS');
    err.code = 'openai_tts_not_configured';
    throw err;
  }
  const res = await fetch(OPENAI_TTS_BASE_URL + '/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + OPENAI_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg'
    },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      voice: OPENAI_TTS_VOICE,
      input: text,
      response_format: 'mp3',
      stream_format: 'audio'
    })
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    throw new Error('openai_tts_failed_' + res.status + (detail ? ': ' + detail : ''));
  }
  if (!res.body) throw new Error('openai_tts_empty_stream');
  return {
    body: res.body,
    contentType: res.headers.get('content-type') || 'audio/mpeg',
    streaming: true
  };
}

module.exports = { synthesizeSpeech };
