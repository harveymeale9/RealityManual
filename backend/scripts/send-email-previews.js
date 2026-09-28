const {
  orderConfirmedEmail,
  orderShippedEmail,
  orderRefundedEmail,
} = require('../src/services/emailTemplates');
const { resendClient } = require('../src/services/resendService');

const recipient = process.env.PREVIEW_EMAIL_TO;
if (!recipient) {
  console.error('PREVIEW_EMAIL_TO is required.');
  process.exit(1);
}

const sampleOrder = {
  id: 'RM-PREVIEW-1001',
  display_order_id: 'RM-PREVIEW-1001',
  customer_name: 'Harvey',
  street1: '123 Example Street',
  city: 'London',
  postal_code: 'SW1A 1AA',
  country: 'GB',
  country_name: 'United Kingdom',
  quantity: 1,
  total_price_cents: 7499,
  currency: 'usd',
};

const previews = [
  ['confirmed', orderConfirmedEmail(sampleOrder, { preview: true })],
  ['shipped', orderShippedEmail(sampleOrder, {
    carrierName: 'Royal Mail',
    trackingNumber: 'RM123456789GB',
    trackingUrl: 'https://www.royalmail.com/track-your-item',
    minDeliveryDays: 2,
    maxDeliveryDays: 5,
  }, { preview: true })],
  ['refunded', orderRefundedEmail(sampleOrder, { preview: true })],
];

(async () => {
  const runId = Date.now();
  for (const [name, email] of previews) {
    await resendClient.sendEmail({
      to: recipient,
      ...email,
      idempotencyKey: `preview-${name}-${runId}`,
    });
    console.log(`${name}=sent`);
  }
})().catch((err) => {
  console.error(`preview_send_failed=${err.message}`);
  process.exit(1);
});
