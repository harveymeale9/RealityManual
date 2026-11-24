const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  orderConfirmedEmail,
  orderShippedEmail,
  orderRefundedEmail,
  reviewRequestEmail,
} = require('../src/services/emailTemplates');
const { createResendClient } = require('../src/services/resendService');

test('the Worker-safe face-reveal template matches its editable HTML source', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/faceRevealEmail.html'), 'utf8');
  assert.equal(require('../src/services/faceRevealEmail.generated'), source);
});

const order = {
  id: 'RM-1001',
  customer_name: 'Ava <script>alert(1)</script>',
  street1: '1 Example Road',
  city: 'London',
  postal_code: 'SW1A 1AA',
  country: 'GB',
  quantity: 2,
  total_price_cents: 13998,
  currency: 'usd',
};

test('confirmation email is branded, responsive, plain-text backed, and escapes customer data', () => {
  const email = orderConfirmedEmail(order, { preview: true });
  assert.equal(email.subject, 'We’ve Received Your Reality Manual Order');
  assert.match(email.html, /We’ve Received Your Reality Manual Order<\/h1>/);
  assert.match(email.text, /WE’VE RECEIVED YOUR REALITY MANUAL ORDER/);
  assert.match(email.html, /15 working days/);
  assert.match(email.html, /specialist book manufacturer in England/);
  assert.match(email.text, /Each hardcover copy is individually printed and bound to order by a specialist book manufacturer in England\./);
  assert.doesNotMatch(email.html, /leading printers|bespoke bookbinders|time and individual attention/);
  assert.match(email.html, /We are arranging production/);
  assert.match(email.html, /within 60 hours/);
  assert.match(email.text, /within 60 hours/);
  assert.doesNotMatch(email.html, /<script>alert/);
  assert.match(email.html, /Ava &lt;script&gt;/);
  assert.match(email.text, /Hardcover, Deluxe First Edition/);
  assert.match(email.text, /\$139\.98 USD/);
});

test('dispatch email includes tracking only when BookVault supplies it', () => {
  const tracked = orderShippedEmail(order, {
    carrierName: 'Royal Mail',
    trackingNumber: 'TRACK-123',
    trackingUrl: 'https://tracking.example/TRACK-123',
    minDeliveryDays: 2,
    maxDeliveryDays: 5,
  });
  assert.equal(tracked.subject, 'Your Copy of The Reality Manual Is on Its Way');
  assert.match(tracked.html, /Wonderful news, Ava/);
  assert.match(tracked.html, /Thank you for your patience/);
  assert.match(tracked.html, /2 to 5 working days after dispatch/);
  assert.match(tracked.html, /Track your shipment/);
  assert.match(tracked.html, /https:\/\/tracking\.example\/TRACK-123/);
  assert.match(tracked.text, /TRACK-123/);
  assert.match(tracked.html, /printing defect or be damaged in transit/);
  assert.match(tracked.html, /take photos of the damage or printing errors and reply to this email with them/);
  assert.match(tracked.html, /get another copy on the way immediately/);
  assert.ok(tracked.html.indexOf('Track your shipment</a>') < tracked.html.indexOf('If your book arrives damaged'));
  assert.match(tracked.text, /IF YOUR BOOK ARRIVES DAMAGED/);
  assert.match(tracked.text, /get another copy on the way immediately/);

  const untracked = orderShippedEmail(order, { carrierName: 'Local post' });
  assert.doesNotMatch(untracked.html, /Track your shipment/);
  assert.doesNotMatch(untracked.text, /Track your shipment:/);
  assert.match(untracked.html, /If your book arrives damaged/);
});

test('refund email says the refund was issued without promising bank timing', () => {
  const email = orderRefundedEmail(order);
  assert.equal(email.subject, 'We Couldn’t Complete Your Order');
  assert.match(email.html, /issued a full refund/);
  assert.doesNotMatch(email.html, /Try Your Order Again/);
  assert.match(email.text, /Please do not place another order yet/);
  assert.match(email.text, /We’ll let you know when ordering is available again/);
  assert.match(email.text, /bank may take several working days/);
  assert.match(email.text, /\$139\.98 USD/);
});

test('review request uses the approved face-reveal email and retains unsubscribe controls', () => {
  const preview = reviewRequestEmail(order, { preview: true });
  assert.equal(preview.subject, '[PREVIEW] Face Reveal!');
  assert.match(preview.html, /A message from the author/);
  assert.match(preview.html, /face-reveal-harvey-smudged\.png/);
  assert.match(preview.html, /face-reveal-click-here\.png/);
  assert.match(preview.html, /alt="CLICK HERE ›"/);
  assert.match(preview.html, /I have something important to discuss with you/);
  assert.match(preview.html, /https:\/\/realitymanual\.com\/iloveyou/);
  assert.doesNotMatch(preview.html, />Important Message<|How are you finding The Reality Manual/);
  assert.match(preview.text, /Please watch this video ASAP!/);
  assert.match(preview.text, /Unsubscribe from review emails/);
  assert.match(preview.html, /Unsubscribe from review emails/i);
  assert.match(preview.html, /api\.realitymanual\.com\/api\/review\/unsubscribe\?order=RM-1001/);
  assert.match(preview.headers['List-Unsubscribe'], /api\.realitymanual\.com\/api\/review\/unsubscribe\?order=RM-1001/);
  assert.equal(preview.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');

  const eventualCustomerVersion = reviewRequestEmail({ id: 'order-1', customer_name: 'Sam Reader' });
  assert.equal(eventualCustomerVersion.subject, 'Face Reveal!');
  assert.doesNotMatch(eventualCustomerVersion.html, /\{\{UNSUBSCRIBE_URL\}\}/);
  assert.match(eventualCustomerVersion.html, /order=order-1/);
});

test('customer-facing email content never contains an em dash', () => {
  const emails = [
    orderConfirmedEmail(order, { preview: true }),
    orderShippedEmail(order, { minDeliveryDays: 2, maxDeliveryDays: 5 }, { preview: true }),
    orderRefundedEmail(order, { preview: true }),
    reviewRequestEmail(order, { preview: true }),
  ];
  for (const email of emails) {
    assert.doesNotMatch(`${email.subject}\n${email.html}\n${email.text}`, /—/);
  }
});

test('Resend client sends HTML and text with domain identity and idempotency', async () => {
  let request;
  const client = createResendClient({
    apiKey: 're_test_key',
    fromEmail: 'The Reality Manual <orders@realitymanual.com>',
    replyTo: 'info@realitymanual.com',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ id: 'email_123' }) };
    },
  });

  const result = await client.sendEmail({
    to: 'reader@example.com',
    subject: 'Subject',
    html: '<p>Hello</p>',
    text: 'Hello',
    idempotencyKey: 'order-123-confirmed',
  });

  assert.equal(result.id, 'email_123');
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.options.headers.Authorization, 'Bearer re_test_key');
  assert.equal(request.options.headers['Idempotency-Key'], 'order-123-confirmed');
  assert.deepEqual(JSON.parse(request.options.body), {
    from: 'The Reality Manual <orders@realitymanual.com>',
    to: ['reader@example.com'],
    subject: 'Subject',
    html: '<p>Hello</p>',
    text: 'Hello',
    reply_to: 'info@realitymanual.com',
  });
});

test('Resend client forwards one-click unsubscribe headers on review requests', async () => {
  let payload;
  const client = createResendClient({
    apiKey: 're_test_key',
    fromEmail: 'orders@example.com',
    fetchImpl: async (_url, options) => {
      payload = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ id: 'review-email' }) };
    },
  });
  await client.sendEmail({ to: 'reader@example.com', ...reviewRequestEmail({ id: 'order-1', customer_name: 'Ava' }) });
  assert.equal(payload.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
});
