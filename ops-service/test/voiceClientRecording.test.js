const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'voiceClient.js'), 'utf8');

test('voice recorder retries an immediate fresh-stream interruption and returns the stable take', async () => {
  let mediaRequests = 0;
  let recorderInstances = 0;
  const tracks = [];

  class FakeMediaRecorder {
    static isTypeSupported() { return true; }

    constructor(stream) {
      this.stream = stream;
      this.state = 'inactive';
      this.mimeType = 'audio/webm';
      this.listeners = Object.create(null);
      this.instance = ++recorderInstances;
    }

    addEventListener(name, callback) {
      (this.listeners[name] || (this.listeners[name] = [])).push(callback);
    }

    emit(name, event = {}) {
      (this.listeners[name] || []).slice().forEach((callback) => callback(event));
    }

    start() {
      this.state = 'recording';
      if (this.instance === 1) {
        setTimeout(() => {
          this.state = 'inactive';
          this.stream.getTracks()[0].readyState = 'ended';
          this.emit('stop');
        }, 20);
      }
    }

    stop() {
      this.emit('dataavailable', { data: new Blob(['stable audio'], { type: this.mimeType }) });
      this.state = 'inactive';
      this.emit('stop');
    }
  }

  const sandbox = {
    Blob,
    clearTimeout,
    console,
    fetch: () => Promise.reject(new Error('unused')),
    FormData,
    MediaRecorder: FakeMediaRecorder,
    navigator: {
      mediaDevices: {
        getUserMedia: async () => {
          mediaRequests += 1;
          const track = { readyState: 'live', stop() { this.readyState = 'ended'; } };
          tracks.push(track);
          return { getTracks: () => [track] };
        }
      }
    },
    setTimeout,
    window: { MediaRecorder: FakeMediaRecorder }
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.navigator = sandbox.navigator;
  vm.runInNewContext(source, sandbox);

  const recording = await sandbox.window.RMVoice.startRecording();
  assert.equal(mediaRequests, 2);
  assert.equal(recorderInstances, 2);
  assert.equal(tracks[0].readyState, 'ended');

  const blob = await recording.stop();
  assert.equal(blob.size, 12);
  assert.equal(tracks[1].readyState, 'ended');
});

test('voice playback buffers the complete response instead of playing uneven provider chunks', async () => {
  let blobRead = false;
  let streamReaderUsed = false;
  let playCalls = 0;

  class FakeAudio {
    addEventListener() {}
    play() {
      playCalls += 1;
      return Promise.resolve();
    }
    pause() {}
  }

  class FakeMediaSource {
    static isTypeSupported() { return true; }
  }

  const response = {
    ok: true,
    headers: { get: (name) => name === 'X-RM-TTS-Streaming' ? '1' : null },
    body: {
      getReader() {
        streamReaderUsed = true;
        throw new Error('provider chunks must not be played directly');
      }
    },
    async blob() {
      blobRead = true;
      return new Blob(['complete audio'], { type: 'audio/mpeg' });
    }
  };

  const sandbox = {
    Audio: FakeAudio,
    Blob,
    clearTimeout,
    console,
    document: {},
    fetch: async () => response,
    FormData,
    MediaSource: FakeMediaSource,
    navigator: {},
    setTimeout,
    URL: {
      createObjectURL: () => 'blob:complete-audio',
      revokeObjectURL() {}
    },
    window: { Audio: FakeAudio, MediaSource: FakeMediaSource }
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.navigator = sandbox.navigator;
  vm.runInNewContext(source, sandbox);

  await sandbox.window.RMVoice.speak('A smooth spoken acknowledgment.', 'message-1', 'codex', 'early_ack');

  assert.equal(blobRead, true);
  assert.equal(streamReaderUsed, false);
  assert.equal(playCalls, 1);
});

test('turning automatic speech off cancels pending audio and persists the preference', async () => {
  let resolveResponse;
  let playCalls = 0;
  const saved = {};
  class FakeAudio {
    addEventListener() {}
    play() { playCalls += 1; return Promise.resolve(); }
    pause() {}
  }
  const sandbox = {
    Audio: FakeAudio, Blob, clearTimeout, console, document: {}, FormData, navigator: {}, setTimeout,
    fetch: () => new Promise((resolve) => { resolveResponse = resolve; }),
    URL: { createObjectURL: () => 'blob:audio', revokeObjectURL() {} },
    window: {
      Audio: FakeAudio,
      addEventListener() {},
      localStorage: {
        getItem(key) { return saved[key] || null; },
        setItem(key, value) { saved[key] = value; }
      }
    }
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.navigator = sandbox.navigator;
  vm.runInNewContext(source, sandbox);

  const pending = sandbox.window.RMVoice.speak('Opening response.', 'message-2', 'codex', 'early_ack');
  sandbox.window.RMVoice.setAutoSpeechEnabled(false);
  resolveResponse({ ok: true, blob: async () => new Blob(['audio'], { type: 'audio/mpeg' }) });
  await pending;

  assert.equal(playCalls, 0);
  assert.equal(sandbox.window.RMVoice.isAutoSpeechEnabled(), false);
  assert.equal(saved.rm_project_manager_auto_speech, 'off');
});
