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

// Speech providers accept only bounded inputs, and a multi-minute reply should
// not make the Play button wait for the complete recording before it can start.
// Keep punctuation on the preceding part so independently synthesized parts
// still sound like one continuous reading.
function splitForSpeech(text, maxChars) {
  const source = String(text || '').trim();
  const limit = Math.max(200, Math.floor(Number(maxChars) || 1800));
  if (!source) return [];
  const parts = [];
  let remaining = source;
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    const minimum = Math.floor(limit * 0.55);
    let cut = -1;
    const sentence = /[.!?]["')\]]?\s+/g;
    let match;
    while ((match = sentence.exec(window))) {
      const candidate = match.index + match[0].length;
      if (candidate >= minimum && candidate <= limit) cut = candidate;
    }
    if (cut < minimum) {
      const whitespace = window.lastIndexOf(' ', limit);
      if (whitespace >= minimum) cut = whitespace + 1;
    }
    if (cut < 1) cut = limit;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

module.exports = { stripMarkdownForSpeech, splitForSpeech };
