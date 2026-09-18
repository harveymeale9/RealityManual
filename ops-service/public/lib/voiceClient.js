// Shared client for the voice/chat app (voice-mobile.html + index.html):
// mic recording, transcription, sending messages to the headless Claude
// agent, polling for a reply, and playing it back via TTS.
window.RMVoice = (function () {
  var API_BASE = window.RMStore ? window.RMStore.API_BASE : '';

  function startRecording() {
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var mimeType = (window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm')) ? 'audio/webm' : '';
      var recorder = mimeType ? new MediaRecorder(stream, { mimeType: mimeType }) : new MediaRecorder(stream);
      var chunks = [];
      recorder.addEventListener('dataavailable', function (e) { if (e.data && e.data.size) chunks.push(e.data); });
      recorder.start();
      return {
        stop: function () {
          return new Promise(function (resolve) {
            recorder.addEventListener('stop', function () {
              stream.getTracks().forEach(function (t) { t.stop(); });
              resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
            });
            recorder.stop();
          });
        }
      };
    });
  }

  function transcribe(blob) {
    var form = new FormData();
    form.append('audio', blob, 'audio.webm');
    return fetch(API_BASE + '/api/voice/transcribe', { method: 'POST', credentials: 'include', body: form })
      .then(function (r) { if (!r.ok) throw new Error('Could not transcribe audio'); return r.json(); })
      .then(function (data) { return data.text || ''; });
  }

  function sendMessage(text, mode) {
    return fetch(API_BASE + '/api/voice/messages', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text, mode: mode })
    }).then(function (r) { if (!r.ok) throw new Error('Could not send message'); return r.json(); });
  }

  function getMessage(id) {
    return fetch(API_BASE + '/api/voice/messages/' + encodeURIComponent(id), { credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error('Could not fetch message'); return r.json(); });
  }

  function listMessages(limit) {
    return fetch(API_BASE + '/api/voice/messages?limit=' + (limit || 30), { credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error('Could not load history'); return r.json(); });
  }

  function pollMessage(id, opts) {
    opts = opts || {};
    var intervalMs = opts.intervalMs || 2000;
    var timeoutMs = opts.timeoutMs || 20 * 60 * 1000;
    var started = Date.now();
    return new Promise(function (resolve, reject) {
      (function tick() {
        getMessage(id).then(function (row) {
          if (row.status === 'done' || row.status === 'error') return resolve(row);
          if (Date.now() - started > timeoutMs) return reject(new Error('Timed out waiting for a reply'));
          setTimeout(tick, intervalMs);
        }).catch(reject);
      })();
    });
  }

  function speak(text) {
    if (!text) return Promise.resolve(null);
    return fetch(API_BASE + '/api/voice/tts', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text })
    }).then(function (r) { if (!r.ok) throw new Error('Could not synthesize speech'); return r.blob(); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var audio = new Audio(url);
        audio.addEventListener('ended', function () { URL.revokeObjectURL(url); });
        return audio.play().then(function () { return audio; });
      });
  }

  function resetSession() {
    return fetch(API_BASE + '/api/voice/session/reset', { method: 'POST', credentials: 'include' })
      .then(function (r) { return r.ok; });
  }

  return {
    startRecording: startRecording,
    transcribe: transcribe,
    sendMessage: sendMessage,
    getMessage: getMessage,
    listMessages: listMessages,
    pollMessage: pollMessage,
    speak: speak,
    resetSession: resetSession
  };
})();
