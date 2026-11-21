// Reader-feedback vouchers are issued only by Content Studio over the
// existing VPS-IP + bearer protected internal channel. Codes have no expiry
// and discount one book, never the BookVault shipping quote.
const CODE = /^RM50-[A-Z0-9]{8}-[A-Z0-9]{8}$/;

async function codeHash(code) {
  const bytes = new TextEncoder().encode(code);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function ensureVoucherTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS feedback_vouchers (
    submission_id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL, issued_at TEXT NOT NULL,
    redeemed_order_id TEXT, redeemed_at TEXT
  )`).run();
}

export async function issueVoucher(request, env) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }); }
  const submissionId = String(body?.submission_id || '');
  const email = String(body?.email || '').trim().toLowerCase();
  const code = String(body?.code || '').trim().toUpperCase();
  if (!/^[0-9a-f-]{36}$/i.test(submissionId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !CODE.test(code)) {
    return Response.json({ error: 'invalid_voucher' }, { status: 400 });
  }
  const hash = await codeHash(code);
  await ensureVoucherTable(env.DB);
  const existing = await env.DB.prepare('SELECT code_hash,email FROM feedback_vouchers WHERE submission_id=?').bind(submissionId).first();
  if (existing) return existing.code_hash === hash && existing.email === email
    ? Response.json({ ok: true, existing: true }) : Response.json({ error: 'submission_already_issued' }, { status: 409 });
  try {
    await env.DB.prepare(`INSERT INTO feedback_vouchers(submission_id,code_hash,email,issued_at)
      VALUES(?,?,?,?)`).bind(submissionId, hash, email, new Date().toISOString()).run();
    return Response.json({ ok: true, existing: false });
  } catch { return Response.json({ error: 'voucher_conflict' }, { status: 409 }); }
}

export async function voucherDiscount(db, code, email, bookPriceCents) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return { discountCents: 0, codeHash: null };
  if (!CODE.test(normalized) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())) return null;
  await ensureVoucherTable(db);
  const hash = await codeHash(normalized);
  const row = await db.prepare('SELECT email,redeemed_order_id FROM feedback_vouchers WHERE code_hash=?').bind(hash).first();
  if (!row || row.redeemed_order_id || row.email !== String(email).trim().toLowerCase()) return null;
  return { discountCents: Math.floor(Number(bookPriceCents) / 2), codeHash: hash };
}

export async function redeemVoucher(db, order) {
  if (!order?.voucher_code_hash || !order.id) return;
  await db.prepare(`UPDATE feedback_vouchers SET redeemed_order_id=?,redeemed_at=?
    WHERE code_hash=? AND redeemed_order_id IS NULL`).bind(order.id, new Date().toISOString(), order.voucher_code_hash).run();
}
