'use strict';

const crypto = require('crypto');

const VERSION_FIELD = '_recordVersion';

function decodeRow(row) {
  if (!row) return null;
  const record = JSON.parse(row.data);
  if (!record[VERSION_FIELD]) record[VERSION_FIELD] = row.updated_at;
  return record;
}

function preparePieceWrite(existingRow, incoming, id) {
  const current = decodeRow(existingRow);
  if (current && incoming[VERSION_FIELD] !== current[VERSION_FIELD]) {
    return { conflict: true, latest: current };
  }
  const record = Object.assign({}, incoming, { id: id });
  record[VERSION_FIELD] = crypto.randomUUID();
  return { conflict: false, record: record };
}

function matchesPieceVersion(existingRow, suppliedVersion) {
  const current = decodeRow(existingRow);
  return !current || suppliedVersion === current[VERSION_FIELD];
}

function stampServerWrite(piece) {
  piece[VERSION_FIELD] = crypto.randomUUID();
  return piece;
}

module.exports = {
  VERSION_FIELD: VERSION_FIELD,
  decodeRow: decodeRow,
  preparePieceWrite: preparePieceWrite,
  matchesPieceVersion: matchesPieceVersion,
  stampServerWrite: stampServerWrite
};
