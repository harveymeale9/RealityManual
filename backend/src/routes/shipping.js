const express = require('express');
const shippingService = require('../services/shippingService');
const errorLogService = require('../services/errorLogService');

const router = express.Router();

router.post('/calculate', (req, res) => {
  const countryCode = String(req.body?.country_code || '').trim().toUpperCase();

  if (!/^[A-Z]{2}$/.test(countryCode)) {
    return res.status(400).json({ error: 'invalid_country_code', message: 'Please select a valid country.' });
  }

  try {
    const totals = shippingService.calculateTotal(countryCode);
    res.json({
      book_price_cents: totals.bookPriceCents,
      shipping_price_cents: totals.shippingPriceCents,
      total_price_cents: totals.totalPriceCents,
      currency: totals.currency,
    });
  } catch (err) {
    errorLogService.logError({
      service: 'backend',
      errorType: 'shipping_calculation_failed',
      errorMessage: err.message,
    });
    res.status(500).json({ error: 'shipping_unavailable', message: 'Unable to calculate shipping right now.' });
  }
});

module.exports = router;
