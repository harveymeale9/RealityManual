// Speech-to-text for Project Manager microphone uploads via ElevenLabs.
'use strict';

const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;
const STT_MODEL = 'scribe_v1';
const STT_TIMEOUT_MS = timeoutSetting(process.env.ELEVENLABS_STT_TIMEOUT_MS, 10 * 60 * 1000);

function timeoutSetting(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1000 ? Math.min(parsed, 60 * 60 * 1000) : fallback;
}

async function fetchWithDeadline(fetchImpl, url, options, timeoutMs, errorCode) {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    return await fetchImpl(url, Object.assign({}, options, { signal: signal }));
  } catch (error) {
    if (signal.aborted) throw new Error(errorCode + '_timeout');
    throw error;
  }
}

async function transcribeAudioDetailed(buffer, mimeType) {
  if (!ELEVEN_API_KEY) throw new Error('ELEVENLABS_API_KEY not configured');
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType || 'audio/webm' }), 'audio.webm');
  form.append('model_id', STT_MODEL);
  const res = await fetchWithDeadline(fetch, 'https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': ELEVEN_API_KEY },
    body: form
  }, STT_TIMEOUT_MS, 'stt');
  if (!res.ok) throw new Error('stt_failed_' + res.status + ': ' + (await res.text()).slice(0, 500));
  return await res.json();
}

async function transcribeAudio(buffer, mimeType) {
  const data = await transcribeAudioDetailed(buffer, mimeType);
  return (data.text || '').trim();
}

module.exports = { transcribeAudio, transcribeAudioDetailed, timeoutSetting, fetchWithDeadline };
