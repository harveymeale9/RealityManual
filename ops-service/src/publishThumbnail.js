'use strict';

// The Production picker stores a source-resolution JPEG, not a file path.
// Validate it before sending it to any platform; never silently upload a
// different frame if the saved selection is corrupt.
function jpegBytes(dataUrl) {
  if (!dataUrl) return null;
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error('The selected thumbnail is not a JPEG image.');
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length < 100 || bytes.length > 50 * 1024 * 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
      bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw new Error('The selected thumbnail JPEG is invalid or too large.');
  }
  return bytes;
}

function offsetMilliseconds(seconds) {
  const value = Number(seconds);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) : null;
}

module.exports = { jpegBytes, offsetMilliseconds };
