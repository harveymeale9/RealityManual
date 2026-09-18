// Speech-to-text and text-to-speech for the voice app, via ElevenLabs.
// One provider for both so there's a single key/account to manage.
'use strict';

const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // "Rachel" — default premade voice on every account
const STT_MODEL = 'scribe_v1';
const TTS_MODEL = process.env.ELEVENLABS_TTS_MODEL || 'eleven_turbo_v2_5';

async function transcribeAudio(buffer, mimeType) {
  if (!ELEVEN_API_KEY) throw new Error('ELEVENLABS_API_KEY not configured');
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType || 'audio/webm' }), 'audio.webm');
  form.append('model_id', STT_MODEL);
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': ELEVEN_API_KEY },
    body: form
  });
  if (!res.ok) throw new Error('stt_failed_' + res.status + ': ' + (await res.text()).slice(0, 500));
  const data = await res.json();
  return (data.text || '').trim();
}

async function synthesizeSpeech(text) {
  if (!ELEVEN_API_KEY) throw new Error('ELEVENLABS_API_KEY not configured');
  const res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + ELEVEN_VOICE_ID, {
    method: 'POST',
    headers: { 'xi-api-key': ELEVEN_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: text, model_id: TTS_MODEL })
  });
  if (!res.ok) throw new Error('tts_failed_' + res.status + ': ' + (await res.text()).slice(0, 500));
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { transcribeAudio, synthesizeSpeech };
