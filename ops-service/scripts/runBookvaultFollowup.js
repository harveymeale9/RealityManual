'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const mailboxService = require('../src/mailboxService');
const namecheapMailbox = require('../src/namecheapMailbox');
const { runFollowups } = require('../src/bookvaultFollowup');

async function main() {
  const dataDir = process.env.DATA_DIR || '/data';
  const db = new Database(path.join(dataDir, 'db.sqlite'));
  db.pragma('journal_mode = WAL');
  const mailbox = mailboxService.setup(db, {
    dataDir,
    address: process.env.MAILBOX_ADDRESS || 'info@realitymanual.com',
    displayName: process.env.MAILBOX_DISPLAY_NAME || 'Reality Manual Support',
    transport: namecheapMailbox.fromEnv(process.env),
    autoSync: false,
  });
  try {
    const result = await runFollowups({ db, mailbox });
    console.log(JSON.stringify(result));
  } finally {
    mailbox.close();
    db.close();
  }
}

main().catch((error) => {
  console.error('[bookvault-followup]', error.message);
  process.exitCode = 1;
});
