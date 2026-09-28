const test = require('node:test');
const assert = require('node:assert/strict');

process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder';

const { PAYMENT_METHOD_TYPES } = require('../src/services/stripeService');

test('checkout permits only card wallets and Link funding sources', () => {
  assert.deepEqual(PAYMENT_METHOD_TYPES, ['card', 'link']);
  assert.equal(PAYMENT_METHOD_TYPES.includes('us_bank_account'), false);
  assert.equal(PAYMENT_METHOD_TYPES.includes('klarna'), false);
  assert.equal(PAYMENT_METHOD_TYPES.includes('afterpay_clearpay'), false);
});
