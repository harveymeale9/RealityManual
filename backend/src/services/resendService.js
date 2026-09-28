const config = require('../config');

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';

function createResendClient({
  apiKey = config.resend.apiKey,
  fromEmail = config.resend.fromEmail,
  replyTo = config.resend.replyTo,
  fetchImpl = global.fetch,
} = {}) {
  async function sendEmail({ to, subject, html, text, idempotencyKey }) {
    if (!apiKey || !fromEmail) {
      throw new Error('Resend is not configured. RESEND_API_KEY and RESEND_FROM_EMAIL are required.');
    }
    if (!to || !subject || !html || !text) {
      throw new Error('A recipient, subject, HTML body, and plain-text body are required.');
    }

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    const payload = {
      from: fromEmail,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
    };
    if (replyTo) payload.reply_to = replyTo;

    const response = await fetchImpl(RESEND_EMAILS_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    let body = {};
    try {
      body = await response.json();
    } catch {
      // A non-JSON upstream error is still reported safely below.
    }

    if (!response.ok) {
      const message = body?.message || body?.error || `HTTP ${response.status}`;
      throw new Error(`Resend rejected the email: ${message}`);
    }

    return body;
  }

  return { sendEmail };
}

module.exports = {
  createResendClient,
  resendClient: createResendClient(),
};
