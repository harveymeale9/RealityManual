'use strict';

const claudeRunner = require('./claudeRunner');
const codexRunner = require('./codexRunner');

function modelLabel(provider) {
  return provider === 'codex' ? 'GPT-5.6 Sol / medium' : 'Claude Code default';
}

async function generate(provider, prompt, onActivity) {
  if (provider === 'claude') {
    if (onActivity) onActivity('Starting Claude generation');
    const text = await claudeRunner.runOneShot(prompt, 20 * 60 * 1000);
    return { text: text, provider: provider, model: modelLabel(provider), sessionId: null };
  }
  if (provider === 'codex') {
    const result = await codexRunner.runCodex({
      prompt: prompt,
      // Inactivity watchdog (rearmed by every streamed Codex event), not a
      // twenty-minute total generation cap.
      timeoutMs: 60 * 60 * 1000,
      onActivity: onActivity || function () {}
    });
    if (!result.ok) throw new Error(result.error || 'Codex generation failed');
    return { text: result.replyText, provider: provider, model: modelLabel(provider), sessionId: result.sessionId || null };
  }
  throw new Error('Unsupported ideation provider: ' + provider);
}

module.exports = { generate: generate, modelLabel: modelLabel };
