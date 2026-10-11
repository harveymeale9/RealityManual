const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const config = require('./config');
require('./db'); // bootstraps schema + seeds shipping_rates as a side effect

const webhookRoutes = require('./routes/webhooks');
const shippingRoutes = require('./routes/shipping');
const checkoutRoutes = require('./routes/checkout');
const orderRoutes = require('./routes/orders');
const analyticsRoutes = require('./routes/analytics');
const { startFulfillmentWorker } = require('./services/fulfillmentService');

const app = express();

// Chrome (and other Chromium browsers) block a public HTTPS page fetching a
// private-network address (this includes localhost) unless the server
// explicitly opts in via this header on the preflight response — a separate
// check from ordinary CORS, part of the Private Network Access spec. This
// only matters while the backend runs locally rather than on a real public
// server (see CLAUDE.md §64/README) — harmless once it's deployed properly.
// Must run *before* the cors() middleware below, which ends OPTIONS
// preflight requests itself and would otherwise skip this entirely.
app.use((req, res, next) => {
  if (req.headers['access-control-request-private-network']) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  next();
});

app.use(cors({ origin: config.corsOrigins }));

// Must be mounted before express.json() — Stripe webhook signature
// verification needs the raw, unparsed request body.
app.use('/api/webhooks', webhookRoutes);

app.use(express.json());

app.use('/api/shipping', shippingRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/analytics', analyticsRoutes);

// The storefront VSL is a finished, immutable marketing asset kept on the
// backend's persistent data volume rather than baked into the Docker image or
// committed to Git. Express handles byte-range requests here, which lets the
// native video player seek normally while Cloudflare can cache the file.
app.get('/media/reality-manual-vsl-1080p.mp4', (req, res, next) => {
  const videoPath = '/data/media/reality-manual-vsl-1080p.mp4';
  if (!fs.existsSync(videoPath)) return res.status(404).json({ error: 'video_not_found' });
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.type('video/mp4');
  res.sendFile(path.resolve(videoPath), (err) => {
    if (err) next(err);
  });
});

// Publishable Stripe keys are intentionally public browser configuration,
// not secrets. Serving the active key from the backend prevents the static
// storefront from drifting into test mode while the server is live (or vice
// versa) during future key rotations.
app.get('/api/config/stripe', (req, res) => {
  res.json({ publishable_key: config.stripe.publishableKey });
});

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

startFulfillmentWorker();
