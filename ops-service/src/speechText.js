'use strict';

// Server-side counterpart to voiceClient.js's stripMarkdownForSpeech. Codex
// TTS is generated from the completed database row rather than browser-
// supplied text, so an early acknowledgment, command, log line, or activity
// event can never be substituted for the final user-facing response.
function stripMarkdownForSpeech(text) {
  if (!text) return '';
  let codeBlocks = 0;
  let out = String(text).replace(/^\[NEEDS_ACTION\]\s*/i, '');
  out = out.replace(/```[a-zA-Z0-9]*\n?[\s\S]*?```/g, function () {
    codeBlocks++;
    return codeBlocks === 1 ? ' I’ve put it in the chat for you to copy.' : ' Another one is in the chat too.';
  });
  out = out.replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/g, '$1 (link below)');
  out = out.replace(/https?:\/\/\S+/g, 'link below');
  out = out.replace(/`([^`]+)`/g, '$1');
  out = out.replace(/^#{1,6}\s+/gm, '');
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
  out = out.replace(/\*([^*]+)\*/g, '$1');
  out = out.replace(/^\s*[-*+]\s+/gm, '');
  out = out.replace(/^\s*\d+\.\s+/gm, '');
  return out.replace(/\n{2,}/g, '. ').replace(/\n/g, ' ').trim();
}

module.exports = { stripMarkdownForSpeech };
