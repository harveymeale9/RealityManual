'use strict';

function representativeTranscript(text, maxCharacters) {
  const input = String(text || '').trim();
  const limit = Math.max(300, Number(maxCharacters) || 9000);
  if (input.length <= limit) return input;
  const separator = '\n\n[... middle sample ...]\n\n';
  const tailSeparator = '\n\n[... ending sample ...]\n\n';
  const available = Math.max(1, limit - separator.length - tailSeparator.length);
  const headSize = Math.floor(available * 0.5);
  const middleSize = Math.floor(available * 0.25);
  const tailSize = available - headSize - middleSize;
  const middleStart = Math.max(headSize, Math.floor((input.length - middleSize) / 2));
  return input.slice(0, headSize).trimEnd() + separator +
    input.slice(middleStart, middleStart + middleSize).trim() + tailSeparator +
    input.slice(-tailSize).trimStart();
}

module.exports = { representativeTranscript };
