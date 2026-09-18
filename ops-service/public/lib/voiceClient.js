// Shared client for the voice/chat app (voice-mobile.html + index.html):
// mic recording, transcription, sending messages to the headless Claude
// agent, polling for a reply, and playing it back via TTS.
window.RMVoice = (function () {
  var API_BASE = window.RMStore ? window.RMStore.API_BASE : '';

  // Screen Wake Lock: held for the duration of a recording so the phone
  // doesn't auto-lock mid-sentence (Harvey couldn't find the stop button
  // again once the screen went dark). Feature-detected — Safari <16.4 and
  // any non-secure context just silently skip it, same "never break the
  // page over this" spirit as the rest of this file.
  var wakeLock = null;
  function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (lock) { wakeLock = lock; }).catch(function () {});
  }
  function releaseWakeLock() {
    if (!wakeLock) return;
    var lock = wakeLock;
    wakeLock = null;
    lock.release().catch(function () {});
  }

  function startRecording() {
    // echoCancellation/noiseSuppression/autoGainControl explicitly off:
    // Chrome's default "voice processing" audio path is the same one used
    // for an actual phone call, so on Android it forces a connected
    // Bluetooth headset to switch from its music (A2DP) profile to the
    // call (HFP) profile — which is what plays the "call connected"/"call
    // ended" tone Harvey was hearing. Turning processing off lets Chrome
    // capture the mic without needing that switch. Trade-off: slightly
    // lower mic quality (no echo cancellation), acceptable for short
    // dictation; this is the only lever available from a web page — there
    // is no API to directly block the Bluetooth profile switch itself.
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    }).then(function (stream) {
      requestWakeLock();
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
              releaseWakeLock();
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

  // imageFile (optional): a File/Blob — sent as multipart alongside text/mode
  // when present. The endpoint accepts both plain JSON (text-only, as
  // before) and multipart (image attached) — see server.js.
  function sendMessage(text, mode, imageFile) {
    if (imageFile) {
      var form = new FormData();
      form.append('text', text || '');
      form.append('mode', mode);
      form.append('image', imageFile, imageFile.name || 'pasted-image.png');
      return fetch(API_BASE + '/api/voice/messages', { method: 'POST', credentials: 'include', body: form })
        .then(function (r) { if (!r.ok) throw new Error('Could not send message'); return r.json(); });
    }
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

  // Strips the app's own [NEEDS_ACTION] marker and common markdown syntax
  // down to plain spoken text before anything reaches TTS — the chat still
  // renders the original markdown (see renderMarkdownLite); this only
  // affects what gets spoken. A fenced code block becomes a short spoken
  // pointer rather than being read character-by-character (that produced
  // exactly the unusable "ssh dash i tilde slash..." Harvey flagged).
  function stripMarkdownForSpeech(text) {
    if (!text) return '';
    var codeBlocks = 0;
    var out = String(text).replace(/^\[NEEDS_ACTION\]\s*/i, '');
    out = out.replace(/```[a-zA-Z0-9]*\n?[\s\S]*?```/g, function () {
      codeBlocks++;
      return codeBlocks === 1 ? ' I’ve put it in the chat for you to copy.' : ' Another one is in the chat too.';
    });
    out = out.replace(/`([^`]+)`/g, '$1');
    out = out.replace(/^#{1,6}\s+/gm, '');
    out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
    out = out.replace(/\*([^*]+)\*/g, '$1');
    out = out.replace(/^\s*[-*+]\s+/gm, '');
    out = out.replace(/^\s*\d+\.\s+/gm, '');
    return out.replace(/\n{2,}/g, '. ').replace(/\n/g, ' ').trim();
  }

  // Very small, safe markdown-lite renderer — NOT a general markdown
  // library. Escapes HTML first (never trusts the content), then only
  // recognizes fenced code blocks (with a copy button), inline code,
  // **bold**, and *italic* — Harvey flagged bold showing up as literal
  // asterisks in the chat bubble rather than actually bold. Returns a
  // DOM fragment ready to append, not an HTML string, so there is no
  // innerHTML injection point at all.
  function renderMarkdownLite(text) {
    var frag = document.createDocumentFragment();
    var src = String(text).replace(/^\[NEEDS_ACTION\]\s*/i, '');
    var re = /```([a-zA-Z0-9]*)\n?([\s\S]*?)```/g;
    var lastIndex = 0;
    var match;
    // Order matters: try inline code, then **bold** (two asterisks), then
    // *italic* (one) — bold has to be attempted before italic or a "**"
    // pair would first get eaten as two separate unmatched single
    // asterisks instead of one bold span.
    function appendTextWithInlineCode(str) {
      var parts = str.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
      parts.forEach(function (part) {
        if (!part) return;
        if (part.charAt(0) === '`' && part.charAt(part.length - 1) === '`' && part.length > 1) {
          var code = document.createElement('code');
          code.className = 'pm-inline-code';
          code.textContent = part.slice(1, -1);
          frag.appendChild(code);
        } else if (part.length > 4 && part.slice(0, 2) === '**' && part.slice(-2) === '**') {
          var strong = document.createElement('strong');
          strong.textContent = part.slice(2, -2);
          frag.appendChild(strong);
        } else if (part.length > 2 && part.charAt(0) === '*' && part.charAt(part.length - 1) === '*') {
          var em = document.createElement('em');
          em.textContent = part.slice(1, -1);
          frag.appendChild(em);
        } else {
          frag.appendChild(document.createTextNode(part));
        }
      });
    }
    while ((match = re.exec(src))) {
      if (match.index > lastIndex) appendTextWithInlineCode(src.slice(lastIndex, match.index));
      var pre = document.createElement('pre');
      pre.className = 'pm-code-block';
      var codeEl = document.createElement('code');
      codeEl.textContent = match[2].replace(/\n$/, '');
      pre.appendChild(codeEl);
      var copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'pm-code-copy';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', function () {
        var text2 = codeEl.textContent;
        (navigator.clipboard ? navigator.clipboard.writeText(text2) : Promise.reject())
          .then(function () { copyBtn.textContent = 'Copied'; setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1500); })
          .catch(function () {});
      });
      pre.appendChild(copyBtn);
      frag.appendChild(pre);
      lastIndex = re.lastIndex;
    }
    if (lastIndex < src.length) appendTextWithInlineCode(src.slice(lastIndex));
    return frag;
  }

  var currentAudio = null;
  function stopSpeaking() {
    if (currentAudio) {
      try { currentAudio.pause(); } catch (e) { /* ignore */ }
      currentAudio = null;
    }
  }

  function speak(text) {
    var clean = stripMarkdownForSpeech(text);
    if (!clean) return Promise.resolve(null);
    stopSpeaking();
    return fetch(API_BASE + '/api/voice/tts', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean })
    }).then(function (r) { if (!r.ok) throw new Error('Could not synthesize speech'); return r.blob(); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var audio = new Audio(url);
        currentAudio = audio;
        audio.addEventListener('ended', function () {
          if (currentAudio === audio) currentAudio = null;
          URL.revokeObjectURL(url);
        });
        return audio.play().then(function () { return audio; });
      });
  }

  // Whether this device/tab looks like the one Harvey is actually looking
  // at right now — used to gate the completion ping so both an open phone
  // and an open desktop tab don't both chime for the same message.
  function isActiveHere() {
    try { return document.visibilityState === 'visible' && document.hasFocus(); } catch (e) { return true; }
  }

  // Short synthesized chime (no audio asset needed) for "a response is
  // ready" — distinct from the spoken reply itself, and safe to call even
  // when this tab isn't the active one (isActiveHere() gates it there).
  function playPing() {
    if (!isActiveHere()) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.34);
      osc.addEventListener('ended', function () { ctx.close().catch(function () {}); });
    } catch (e) { /* never let a chime failure affect anything else */ }
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
  //            onEarlyAck(row)   — row.early_ack just appeared, fires once
  //            onDone(row)       — row finished successfully
  //            onError(row)      — row finished with an error
  //            onActivity(row)   — row's activity_log grew
  //            onTick(rows)      — every poll, the raw current window of rows
  //                                (oldest-last, as the API returns them) —
  //                                for a "queue" view that needs the whole
  //                                current picture rather than per-row deltas
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
        known[row.id] = seen = { bucket: null, activityLen: 0, hadEarlyAck: false };
        if (callbacks.onNewMessage) callbacks.onNewMessage(row);
      }
      // Fires once, the moment early_ack first appears — well before the
      // row's bucket transitions to done/error, since it's written mid-turn
      // (see server.js's onEarlyAck / claudeRunner.js's handleEvent).
      if (!seen.hadEarlyAck && row.early_ack) {
        seen.hadEarlyAck = true;
        if (callbacks.onEarlyAck) callbacks.onEarlyAck(row);
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
        if (callbacks.onTick) callbacks.onTick(rows);
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
    stopSpeaking: stopSpeaking,
    playPing: playPing,
    isActiveHere: isActiveHere,
    stripMarkdownForSpeech: stripMarkdownForSpeech,
    renderMarkdownLite: renderMarkdownLite,
    resetSession: resetSession,
    syncThread: syncThread
  };
})();
