'use strict';

const codexRunner = require('./codexRunner');

function modelLabel(provider) {
  return 'Codex';
}

async function generate(provider, prompt, onActivity) {
  if (provider !== 'codex') throw new Error('Unsupported ideation provider: ' + provider);
  const result = await codexRunner.runCodex({
    prompt: prompt,
    // Inactivity watchdog (rearmed by every streamed Codex event), not a
    // twenty-minute total generation cap.
    timeoutMs: 60 * 60 * 1000,
    onActivity: onActivity || function () {}
  });
  if (!result.ok) throw new Error(result.error || 'Codex generation failed');
  return { text: result.replyText, provider: 'codex', model: modelLabel(provider), sessionId: result.sessionId || null };
}

module.exports = { generate: generate, modelLabel: modelLabel };
