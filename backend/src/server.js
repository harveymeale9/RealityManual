const express = require('express');
const cors = require('cors');
const config = require('./config');
require('./db'); // bootstraps schema + seeds shipping_rates as a side effect

const webhookRoutes = require('./routes/webhooks');
const shippingRoutes = require('./routes/shipping');
const checkoutRoutes = require('./routes/checkout');
const orderRoutes = require('./routes/orders');

const app = express();

app.use(cors({ origin: config.corsOrigin }));

// Must be mounted before express.json() — Stripe webhook signature
// verification needs the raw, unparsed request body.
app.use('/api/webhooks', webhookRoutes);

app.use(express.json());

app.use('/api/shipping', shippingRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/orders', orderRoutes);

app.get('/health', (req, res) => res.json({ ok: true }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_server_error' });
});

app.listen(config.port, () => {
  console.log(`Reality Manual backend listening on port ${config.port} (${config.nodeEnv})`);
  if (!config.stripe.secretKey) {
    console.warn('STRIPE_SECRET_KEY is not set — payment endpoints will fail until backend/.env is configured.');
  }
});
