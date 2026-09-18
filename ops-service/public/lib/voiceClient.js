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
    var intervalMs = opts.intervalMs || 1200;
    var timeoutMs = opts.timeoutMs || 20 * 60 * 1000;
    var onTick = opts.onTick; // called with every row, including the final one — lets a caller render activity_log live as it grows
    var started = Date.now();
    return new Promise(function (resolve, reject) {
      (function tick() {
        getMessage(id).then(function (row) {
          if (onTick) onTick(row);
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

  // Shared cross-device thread engine used by both index.html's Project
  // Manager tab and voice-mobile.html, so "one very long chat thread" is
  // literally true rather than two independent UIs reading the same table.
  // A single polling loop does double duty as both "load history on open"
  // (its first tick, against whatever's already in the table) and "notice
  // what another device just did" (every tick after) — there's no separate
  // one-shot history fetch to keep in sync with the recurring one.
  //
  // callbacks: onNewMessage(row) — a row never seen before, fires once per id
  //            onPending(row)    — row is now queued/running (fires once per
  //                                pending->running transition too, since both
  //                                bucket to "inflight" — treat as idempotent)
  //            onDone(row)       — row finished successfully
  //            onError(row)      — row finished with an error
  //            onActivity(row)   — row's activity_log grew
  function syncThread(callbacks, opts) {
    opts = opts || {};
    var intervalMs = opts.intervalMs || 2500;
    var limit = opts.limit || 60;
    var known = {}; // id -> { bucket, activityLen }
    var stopped = false;
    var timer = null;

    function bucketOf(status) {
      return (status === 'pending' || status === 'running') ? 'inflight' : status;
    }

    function applyRow(row) {
      var seen = known[row.id];
      if (!seen) {
        known[row.id] = seen = { bucket: null, activityLen: 0 };
        if (callbacks.onNewMessage) callbacks.onNewMessage(row);
      }
      var bucket = bucketOf(row.status);
      if (bucket !== seen.bucket) {
        seen.bucket = bucket;
        if (bucket === 'inflight' && callbacks.onPending) callbacks.onPending(row);
        else if (bucket === 'done' && callbacks.onDone) callbacks.onDone(row);
        else if (bucket === 'error' && callbacks.onError) callbacks.onError(row);
      }
      var activityLen = (row.activity_log && row.activity_log.length) || 0;
      if (activityLen !== seen.activityLen) {
        seen.activityLen = activityLen;
        if (callbacks.onActivity) callbacks.onActivity(row);
      }
    }

    function tick() {
      if (stopped) return;
      listMessages(limit).then(function (rows) {
        rows.slice().reverse().forEach(applyRow);
      }).catch(function () {
        // transient network hiccup or backend hiccup — just try again next
        // tick, same "never break the page" spirit as the analytics client.
      }).then(function () {
        if (!stopped) timer = setTimeout(tick, intervalMs);
      });
    }

    tick();

    return {
      stop: function () {
        stopped = true;
        if (timer) clearTimeout(timer);
      },
      // Call right after this device's own POST /api/voice/messages succeeds,
      // once it's already rendered the user bubble + typing state itself for
      // instant feedback — marks the row known so the next tick updates that
      // same message in place instead of rendering a duplicate from scratch.
      markKnown: function (row) {
        known[row.id] = { bucket: bucketOf(row.status || 'pending'), activityLen: 0 };
      }
    };
  }

  return {
    startRecording: startRecording,
    transcribe: transcribe,
    sendMessage: sendMessage,
    getMessage: getMessage,
    listMessages: listMessages,
    pollMessage: pollMessage,
    speak: speak,
    resetSession: resetSession,
    syncThread: syncThread
  };
})();
