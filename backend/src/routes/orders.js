const express = require('express');
const orderService = require('../services/orderService');

const router = express.Router();

// Public endpoint polled by the confirmation page. UUID order IDs make this
// safe against enumeration; only a non-PII status subset is ever returned.
router.get('/:id/status', (req, res) => {
  const order = orderService.getById(req.params.id);

  if (!order) {
    return res.status(404).json({ error: 'order_not_found' });
  }

  res.json(orderService.toPublicStatus(order));
});

module.exports = router;
