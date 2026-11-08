const test = require('node:test');
const assert = require('node:assert/strict');
const {
  orderConfirmedEmail,
  orderShippedEmail,
  orderRefundedEmail,
  reviewRequestEmail,
} = require('../src/services/emailTemplates');
const { createResendClient } = require('../src/services/resendService');

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
  assert.equal(email.subject, 'We’re Making Your Copy of The Reality Manual!');
  assert.match(email.html, /We’re Making Your Copy of The Reality Manual!<\/h1>/);
  assert.match(email.text, /WE’RE MAKING YOUR COPY OF THE REALITY MANUAL!/);
  assert.match(email.html, /15 working days/);
  assert.match(email.html, /leading printers of bespoke books/);
  assert.match(email.html, /time and individual attention/);
  assert.match(email.html, /Thank you for giving us the time/);
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

  const untracked = orderShippedEmail(order, { carrierName: 'Local post' });
  assert.doesNotMatch(untracked.html, /Track your shipment/);
  assert.doesNotMatch(untracked.text, /Track your shipment:/);
});

test('refund email says the refund was issued without promising bank timing', () => {
  const email = orderRefundedEmail(order);
  assert.equal(email.subject, 'We Couldn’t Complete Your Order');
  assert.match(email.html, /issued a full refund/);
  assert.match(email.html, /Try Your Order Again/);
  assert.match(email.html, /https:\/\/realitymanual\.com\/checkout\.html/);
  assert.match(email.text, /Please try placing your order once more/);
  assert.match(email.text, /We’ll be in touch to help resolve it/);
  assert.match(email.text, /bank may take several working days/);
  assert.match(email.text, /\$139\.98 USD/);
});

test('review request is personalized and offers written or video feedback', () => {
  const preview = reviewRequestEmail(order, { preview: true });
  assert.equal(preview.subject, '[PREVIEW] How are you finding The Reality Manual?');
  assert.match(preview.html, /Preview Only: Not a Customer Email/);
  assert.match(preview.html, /Hi Ava,/);
  assert.doesNotMatch(preview.html, /<script>alert/);
  assert.match(reviewRequestEmail({ customer_name: '<img>' }).html, /Hi &lt;img&gt;,/);
  assert.match(preview.html, /short review, just reply to this email/);
  assert.match(preview.html, /https:\/\/www\.instagram\.com\/the_reality_manual\//);
  assert.match(preview.text, /DM it to me there/);
  assert.match(preview.text, /Unsubscribe from review emails/);
  assert.doesNotMatch(preview.text, /future review requests|\b(?:we|us|our)\b|we(?:'|’)ll|we(?:'|’)d/i);
  assert.match(preview.html, /Unsubscribe from review emails/i);
  assert.match(preview.headers['List-Unsubscribe'], /api\.realitymanual\.com\/api\/review\/unsubscribe/);
  assert.equal(preview.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.match(preview.text, /If your book hasn't arrived yet/);
  assert.doesNotMatch(preview.html, /Order:|Tracking:/);

  const eventualCustomerVersion = reviewRequestEmail({ customer_name: 'Sam Reader' });
  assert.equal(eventualCustomerVersion.subject, 'How are you finding The Reality Manual?');
  assert.doesNotMatch(eventualCustomerVersion.html, /Preview Only/);
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
