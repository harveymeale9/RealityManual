'use strict';

const crypto = require('crypto');

const SCHEMA = { type: 'object', additionalProperties: false,
  required: ['constructive', 'reason'], properties: {
    constructive: { type: 'boolean' }, reason: { type: 'string' }
  } };

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function voucherEmail(name, code, preview = false) {
  const subject = preview ? '[PREVIEW] Your 50% thank-you voucher' : 'Your 50% thank-you voucher from Harvey';
  const intro = preview ? '<p style="color:#a68143">Preview only — the sample code below is not redeemable.</p>' : '';
  const safeCode = escapeHtml(code);
  const link = preview ? 'https://realitymanual.com/checkout.html' :
    'https://realitymanual.com/checkout.html?voucher=' + encodeURIComponent(code);
  const htmlBody = '<!doctype html><html><body style="margin:0;background:#11100d;color:#f3ebdc;font-family:Arial,sans-serif">' +
    '<div style="max-width:600px;margin:auto;padding:36px 24px;text-align:center">' +
    '<p style="letter-spacing:.22em;color:#e4bd71;font-size:12px">THE REALITY MANUAL</p>' +
    '<h1 style="font:normal 46px Georgia,serif;margin:30px 0 12px">A little thank you.</h1>' + intro +
    '<p style="line-height:1.7">Hi ' + escapeHtml(name) + ',</p>' +
    '<p style="line-height:1.7">Thank you for taking the time to share such thoughtful feedback. It helps me make The Reality Manual better.</p>' +
    '<div style="border:1px solid #b9904e;border-radius:16px;padding:24px;margin:30px 0;background:#211b12">' +
    '<p style="font-size:13px;color:#d4b47b;letter-spacing:.1em">50% OFF ONE BOOK · NO EXPIRY</p>' +
    '<p style="font:normal 23px Georgia,serif;letter-spacing:.03em;white-space:nowrap">' + safeCode + '</p></div>' +
    '<p style="line-height:1.7">Use it for another copy for a friend now, or save it for Volume II when it launches. The discount is on one book only; shipping is unchanged. Use the same email address you used for your feedback.</p>' +
    '<a href="' + escapeHtml(link) + '" style="display:inline-block;padding:16px 30px;background:#e9be6d;color:#171109!important;-webkit-text-fill-color:#171109!important;text-decoration:none;border-radius:10px;font-weight:bold"><span style="color:#171109!important;-webkit-text-fill-color:#171109!important">SHOP THE BOOK</span></a>' +
    '<p style="margin-top:40px;color:#b7ab98">With gratitude,<br>Harvey</p></div></body></html>';
  const textBody = (preview ? 'PREVIEW ONLY — sample code is not redeemable.\n\n' : '') +
    `Hi ${name},\n\nThank you for taking the time to share such thoughtful feedback. Here is your 50% off voucher for one book: ${code}\n\n` +
    'It never expires. Use it for a copy for a friend now, or save it for Volume II when it launches. ' +
    'The discount is on one book only; shipping is unchanged. Use the same email address you used for your feedback.\n\n' +
    link + '\n\nWith gratitude,\nHarvey';
  return { subject, textBody, htmlBody };
}

function setup(db, options = {}) {
  const rows = db.prepare("SELECT id,data FROM customer_submissions WHERE status='complete' ORDER BY submitted_at ASC");
  const save = db.prepare('UPDATE customer_submissions SET data=? WHERE id=?');
  let running = false;
  async function processPending() {
    if (running) return;
    running = true;
    try {
      for (const row of rows.all()) {
        try {
          const data = JSON.parse(row.data);
          if (data.kind !== 'feedback') continue;
          let review = data.voucherReview;
          if (!review) {
            const result = await options.classify(data.message);
            review = { status: result.constructive === true ? 'approved' : 'not_constructive',
              reason: String(result.reason || '').slice(0, 500), reviewedAt: new Date().toISOString() };
            data.voucherReview = review;
            save.run(JSON.stringify(data), data.id);
          }
          if (review.status !== 'approved' && review.status !== 'issued') continue;
          if (!review.code) {
            // 55 random bits in 11 base-32 characters: shorter in email, still unguessable.
            const raw = BigInt('0x' + crypto.randomBytes(7).toString('hex')) & ((1n << 55n) - 1n);
            review.code = 'RM50-' + raw.toString(32).toUpperCase().padStart(11, '0');
            save.run(JSON.stringify(data), data.id);
          }
          if (review.status === 'approved') {
            await options.issue(data, review.code);
            review.status = 'issued';
            save.run(JSON.stringify(data), data.id);
          }
          await options.send({ to: [data.email], cc: [], ...voucherEmail(data.name, review.code) });
          review.status = 'sent'; review.sentAt = new Date().toISOString();
          save.run(JSON.stringify(data), data.id);
        } catch (error) { console.error('Feedback voucher review/send failed for ' + row.id + ':', error.message); }
      }
    } catch (error) { console.error('Feedback voucher scan failed:', error.message); }
    finally { running = false; }
  }
  const timer = options.start === false ? null : setInterval(() => { processPending(); }, 60_000);
  if (timer) timer.unref();
  if (timer) setTimeout(() => { processPending(); }, 5000).unref();
  return { processPending, voucherEmail, close: () => { if (timer) clearInterval(timer); } };
}

module.exports = { setup, voucherEmail, SCHEMA };
