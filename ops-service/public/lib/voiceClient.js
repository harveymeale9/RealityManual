// Shared client for the voice/chat app (voice-mobile.html + index.html):
// mic recording, transcription, routing messages to the selected headless
// agent (Claude or Codex), polling for a reply, and playing it back via TTS.
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

  // Three attempts at killing the Bluetooth "call started"/"call ended"
  // tone (§86, §103, §105) were all tried and none of them actually fixed
  // it on Harvey's real hardware — see CLAUDE.md §106 for the full
  // history and why this was reverted to the plain, simple version below
  // rather than keeping any of that added complexity around for no
  // measurable benefit. Accepted as a known, low-priority platform
  // limitation per Harvey's own call ("not a big enough deal to waste
  // more time on").
  function startRecording() {
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
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
  // replyToId (optional): the id of an earlier voice_messages row this
  // message is a tap-to-reply response to — see server.js's promptText
  // wiring for how it's used.
  function sendMessage(text, mode, imageFile, replyToId, agent) {
    agent = agent === 'codex' ? 'codex' : 'claude';
    if (imageFile) {
      var form = new FormData();
      form.append('text', text || '');
      form.append('mode', mode);
      form.append('agent', agent);
      if (replyToId) form.append('replyToId', replyToId);
      form.append('image', imageFile, imageFile.name || 'pasted-image.png');
      return fetch(API_BASE + '/api/voice/messages', { method: 'POST', credentials: 'include', body: form })
        .then(function (r) { if (!r.ok) throw new Error('Could not send message'); return r.json(); });
    }
    var body = { text: text, mode: mode, agent: agent };
    if (replyToId) body.replyToId = replyToId;
    return fetch(API_BASE + '/api/voice/messages', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
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

  function getNotificationStatus() {
    return fetch(API_BASE + '/api/voice/notifications/status', { credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error('Could not load notifications'); return r.json(); });
  }

  function markNotificationsRead(ids) {
    return fetch(API_BASE + '/api/voice/notifications/read', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.isArray(ids) ? ids : [] })
    }).then(function (r) { if (!r.ok) throw new Error('Could not update notifications'); return r.json(); });
  }

  // Best-effort installed-PWA/home-screen badge. The always-visible in-app
  // badge is the reliable fallback on browsers (notably iOS versions) that
  // do not expose the Badging API to a simple home-screen shortcut.
  function setAppBadge(count) {
    count = Number(count) || 0;
    try {
      if (count && navigator.setAppBadge) navigator.setAppBadge(count).catch(function () {});
      else if (!count && navigator.clearAppBadge) navigator.clearAppBadge().catch(function () {});
    } catch (error) { /* unsupported browser */ }
  }

  function getAgentPreference() {
    return fetch(API_BASE + '/api/voice/agent', { credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error('Could not load agent preference'); return r.json(); })
      .then(function (data) { return data.agent === 'codex' ? 'codex' : 'claude'; });
  }

  function setAgentPreference(agent) {
    agent = agent === 'codex' ? 'codex' : 'claude';
    return fetch(API_BASE + '/api/voice/agent', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: agent })
    }).then(function (r) {
      if (!r.ok) throw new Error('Could not save agent preference');
      return r.json();
    }).then(function (data) { return data.agent; });
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
  // exactly the unusable "ssh dash i tilde slash..." Harvey flagged) — a
  // link gets the same treatment for the same reason (reading a raw URL
  // aloud is unusable/"sounds ridiculous," his words).
  function stripMarkdownForSpeech(text) {
    if (!text) return '';
    var codeBlocks = 0;
    var out = String(text).replace(/^\[NEEDS_ACTION\]\s*/i, '');
    out = out.replace(/```[a-zA-Z0-9]*\n?[\s\S]*?```/g, function () {
      codeBlocks++;
      return codeBlocks === 1 ? ' I’ve put it in the chat for you to copy.' : ' Another one is in the chat too.';
    });
    // Markdown links first (so their url doesn't also get caught by the
    // bare-url pass below), keeping the human-readable label but dropping
    // the actual url in favor of a short spoken pointer to it.
    out = out.replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/g, '$1 (link below)');
    // Any remaining bare url (not part of markdown link syntax).
    out = out.replace(/https?:\/\/\S+/g, 'link below');
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
      // `let`, not `var`, is load-bearing here: a message can contain more
      // than one fenced code block, so this loop can run more than once.
      // `var` is function-scoped, not per-iteration, so every click
      // handler created below would have closed over the *same* pre/
      // codeEl/copyBtn bindings — whichever block happened to be the last
      // one in the message — meaning every earlier copy button in a
      // multi-block message silently copied the wrong (last) block's text
      // and updated the wrong (last) button's "Copied" label instead of
      // its own. `let` gives each iteration its own binding, which is
      // what makes each button's closure actually refer to itself.
      let pre = document.createElement('pre');
      pre.className = 'pm-code-block';
      let codeEl = document.createElement('code');
      codeEl.textContent = match[2].replace(/\n$/, '');
      pre.appendChild(codeEl);
      let copyBtn = document.createElement('button');
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
  var currentAudioReader = null;
  // Which message a currently-playing (or about-to-play) audio belongs to,
  // and a tiny pub-sub so any page can keep its UI (a per-message Play/Stop
  // button, a "speaking" highlight) in sync regardless of whether playback
  // was triggered by that exact button or started automatically elsewhere
  // (the early-ack/final-answer auto-speak paths) — a desktop bug Harvey
  // hit was the per-bubble button's own "am I playing" state only ever
  // being set from its own click handler, so auto-speak starting audio
  // behind its back left the button stuck showing "Play" while audio was
  // actually going, and clicking it then restarted the same text from
  // scratch instead of stopping it.
  var speakingMsgId = null;
  var speakingListeners = [];
  // Returns an unsubscribe function — callers that re-register on every
  // tab visit (e.g. bootProjectManager running again each time Project
  // Manager is reopened) should call it before registering again, or the
  // listener list grows once per visit for the lifetime of the page.
  function onSpeakingChange(fn) {
    speakingListeners.push(fn);
    return function unsubscribe() {
      var idx = speakingListeners.indexOf(fn);
      if (idx !== -1) speakingListeners.splice(idx, 1);
    };
  }
  function notifySpeakingChange() {
    speakingListeners.forEach(function (fn) { try { fn(speakingMsgId); } catch (e) { /* ignore */ } });
  }
  function currentlySpeaking() { return speakingMsgId; }

  // Bumped on every stopSpeaking() (including the one speak() itself does
  // before firing off a new TTS request) — a speak() call that's still
  // waiting on its fetch when a *newer* speak()/stopSpeaking() happens
  // checks this before ever creating an Audio element, so a slow/stale
  // request can't start playing after the fact. Without this, pressing
  // Play a second time while the first request was still in flight (TTS
  // synthesis takes a beat — Harvey's exact report: "I pressed play again
  // because I didn't hear anything yet") let both requests eventually
  // resolve and both start playing, since stopSpeaking() could only ever
  // stop an Audio element that already existed, not one still being
  // fetched.
  var playToken = 0;

  // Set true for the exact duration Harvey has a mic open (either page's
  // recording flow — desktop's setRecordingUI, mobile's startFlow/cleanup —
  // calls this on every start/stop, both live-recognition and
  // record-and-upload). Per Harvey: if he's recording a second message
  // while a reply to an earlier one is still due to be spoken, he doesn't
  // want to hear it talking over what he's saying. speak() below refuses
  // to start any new playback while this is true, and starting a
  // recording immediately stops whatever's already playing.
  var recordingActive = false;
  function setRecordingActive(active) {
    recordingActive = !!active;
    if (recordingActive) stopSpeaking();
  }

  function stopSpeaking() {
    playToken++;
    if (currentAudioReader) {
      try { currentAudioReader.cancel(); } catch (e) { /* ignore */ }
      currentAudioReader = null;
    }
    if (currentAudio) {
      try { currentAudio.pause(); } catch (e) { /* ignore */ }
      currentAudio = null;
    }
    if (speakingMsgId !== null) {
      speakingMsgId = null;
      notifySpeakingChange();
    }
  }

  // msgId (optional): the voice_messages row id this audio belongs to, so
  // listeners registered via onSpeakingChange can highlight/un-highlight
  // the right UI element as playback starts and stops.
  function finishAudioLifecycle(audio, url) {
    audio.addEventListener('ended', function () {
      if (currentAudio === audio) {
        currentAudio = null;
        currentAudioReader = null;
        speakingMsgId = null;
        notifySpeakingChange();
      }
      URL.revokeObjectURL(url);
    });
  }

  function abandonAudio(audio, reader, url) {
    if (reader) {
      try { reader.cancel().catch(function () {}); } catch (e) { /* ignore */ }
    }
    try { audio.pause(); } catch (e) { /* ignore */ }
    if (currentAudio === audio) {
      currentAudio = null;
      if (currentAudioReader === reader) currentAudioReader = null;
      speakingMsgId = null;
      notifySpeakingChange();
    }
    URL.revokeObjectURL(url);
  }

  function playBufferedResponse(response, myToken, msgId) {
    return response.blob().then(function (blob) {
      if (myToken !== playToken || recordingActive) return null;
      var url = URL.createObjectURL(blob);
      var audio = new Audio(url);
      currentAudio = audio;
      speakingMsgId = (typeof msgId !== 'undefined') ? msgId : null;
      notifySpeakingChange();
      finishAudioLifecycle(audio, url);
      return audio.play().then(function () { return audio; }).catch(function (err) {
        abandonAudio(audio, null, url);
        throw err;
      });
    });
  }

  // OpenAI's Speech API returns chunked MP3. MediaSource lets a supporting
  // browser start after the first decodable chunk instead of waiting for a
  // complete Blob; browsers without audio/mpeg MediaSource support use the
  // existing full-response playback path below.
  function playStreamingResponse(response, myToken, msgId) {
    var canStream = response.body && window.MediaSource &&
      typeof MediaSource.isTypeSupported === 'function' && MediaSource.isTypeSupported('audio/mpeg');
    if (!canStream) return playBufferedResponse(response, myToken, msgId);

    var mediaSource = new MediaSource();
    var url = URL.createObjectURL(mediaSource);
    var audio = new Audio(url);
    var reader = response.body.getReader();
    currentAudio = audio;
    currentAudioReader = reader;
    speakingMsgId = (typeof msgId !== 'undefined') ? msgId : null;
    notifySpeakingChange();
    finishAudioLifecycle(audio, url);

    return new Promise(function (resolve, reject) {
      var sourceBuffer = null;
      var streamDone = false;
      var playbackStarted = false;
      var settled = false;

      function fail(err) {
        abandonAudio(audio, reader, url);
        if (!settled) {
          settled = true;
          reject(err);
        }
      }
      function finishStream() {
        if (!streamDone || !sourceBuffer || sourceBuffer.updating) return;
        try { if (mediaSource.readyState === 'open') mediaSource.endOfStream(); } catch (e) { /* playback can still finish */ }
        if (currentAudioReader === reader) currentAudioReader = null;
      }
      function readNext() {
        if (myToken !== playToken || recordingActive) {
          reader.cancel().catch(function () {});
          if (!settled) { settled = true; resolve(null); }
          return;
        }
        reader.read().then(function (part) {
          if (part.done) {
            streamDone = true;
            finishStream();
            return;
          }
          sourceBuffer.appendBuffer(part.value);
        }).catch(fail);
      }

      mediaSource.addEventListener('sourceopen', function () {
        try { sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg'); } catch (e) {
          reader.cancel().catch(function () {});
          fail(e);
          return;
        }
        sourceBuffer.addEventListener('error', function () { fail(new Error('Could not stream speech audio')); });
        sourceBuffer.addEventListener('updateend', function () {
          if (!playbackStarted) {
            playbackStarted = true;
            audio.play().then(function () {
              if (!settled) { settled = true; resolve(audio); }
            }).catch(fail);
          }
          if (streamDone) finishStream();
          else readNext();
        });
        readNext();
      }, { once: true });
    });
  }

  function speak(text, msgId, agent, speechKind) {
    var clean = stripMarkdownForSpeech(text);
    if (!clean || recordingActive) return Promise.resolve(null);
    agent = agent === 'codex' ? 'codex' : 'claude';
    stopSpeaking();
    var myToken = playToken;
    return fetch(API_BASE + '/api/voice/tts', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: clean,
        messageId: msgId,
        agent: agent,
        // The backend still resolves Codex speech from the canonical DB
        // row. This flag only tells it whether the requested stored text is
        // the live contextual acknowledgment or the completed final reply.
        speechKind: speechKind === 'early_ack' ? 'early_ack' : 'reply'
      })
    }).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (payload) {
          var code = payload && payload.error ? payload.error : 'tts_failed';
          var message = code === 'openai_tts_not_configured'
            ? 'Codex voice needs an OpenAI API key on the server.'
            : 'Could not synthesize speech.';
          var error = new Error(message);
          error.code = code;
          throw error;
        });
      }
      if (r.headers.get('X-RM-TTS-Streaming') === '1') return playStreamingResponse(r, myToken, msgId);
      return playBufferedResponse(r, myToken, msgId);
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
  //            onUpdate(row)     — a completed row's visible content/read
  //                                state changed in place (mail alerts use
  //                                one living row per topic)
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
      var isNew = !seen;
      if (!seen) {
        known[row.id] = seen = { bucket: null, activityLen: 0, hadEarlyAck: false, contentSignature: null };
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
      var contentSignature = [row.transcript || '', row.reply_text || '', row.error_message || '',
        row.notification_kind || '', Number(row.notification_unread) || 0, row.completed_at || ''].join('\u001f');
      if (!isNew && seen.contentSignature !== null && contentSignature !== seen.contentSignature && callbacks.onUpdate) {
        callbacks.onUpdate(row);
      }
      seen.contentSignature = contentSignature;
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
        known[row.id] = { bucket: bucketOf(row.status || 'pending'), activityLen: 0, contentSignature: null };
      }
    };
  }

  return {
    startRecording: startRecording,
    transcribe: transcribe,
    sendMessage: sendMessage,
    getMessage: getMessage,
    listMessages: listMessages,
    getNotificationStatus: getNotificationStatus,
    markNotificationsRead: markNotificationsRead,
    setAppBadge: setAppBadge,
    getAgentPreference: getAgentPreference,
    setAgentPreference: setAgentPreference,
    pollMessage: pollMessage,
    speak: speak,
    stopSpeaking: stopSpeaking,
    onSpeakingChange: onSpeakingChange,
    currentlySpeaking: currentlySpeaking,
    setRecordingActive: setRecordingActive,
    playPing: playPing,
    isActiveHere: isActiveHere,
    stripMarkdownForSpeech: stripMarkdownForSpeech,
    renderMarkdownLite: renderMarkdownLite,
    resetSession: resetSession,
    syncThread: syncThread
  };
})();
