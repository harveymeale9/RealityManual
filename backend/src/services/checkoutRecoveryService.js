const db = require('../db');

const saveStmt = db.prepare(`
  INSERT INTO checkout_recovery_contacts (capture_id, email)
  VALUES (?, ?)
  ON CONFLICT(capture_id) DO UPDATE SET
    email = excluded.email,
    consented_at = CASE WHEN email <> excluded.email THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE consented_at END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
`);
const removeStmt = db.prepare('DELETE FROM checkout_recovery_contacts WHERE capture_id = ?');
const removeByEmailStmt = db.prepare('DELETE FROM checkout_recovery_contacts WHERE lower(email) = lower(?)');
const paidByEmailStmt = db.prepare("SELECT 1 FROM orders WHERE lower(email)=lower(?) AND stripe_payment_status='succeeded' AND stripe_livemode=1 LIMIT 1");
const pruneStmt = db.prepare("DELETE FROM checkout_recovery_contacts WHERE updated_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')");

function save(captureId, email) {
  pruneStmt.run();
  const normalized = email.trim().toLowerCase();
  if (paidByEmailStmt.get(normalized)) return;
  saveStmt.run(captureId, normalized);
}

function remove(captureId) {
  removeStmt.run(captureId);
}

function removeByEmail(email) {
  removeByEmailStmt.run(email);
}

function startPruning() {
  pruneStmt.run();
  const timer = setInterval(() => pruneStmt.run(), 24 * 60 * 60 * 1000);
  timer.unref();
}

module.exports = { save, remove, removeByEmail, startPruning };
