const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const databasePath = process.env.DATABASE_PATH
  ? path.resolve(__dirname, '..', process.env.DATABASE_PATH)
  : path.join(__dirname, '..', 'data', 'reality-manual.db');

module.exports = {
  port: Number(process.env.PORT) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  databasePath,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5500',

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },

  lulu: {
    clientId: process.env.LULU_CLIENT_ID || '',
    clientSecret: process.env.LULU_CLIENT_SECRET || '',
    apiBaseUrl: process.env.LULU_API_BASE_URL || 'https://api.sandbox.lulu.com',
    podPackageId: process.env.LULU_POD_PACKAGE_ID || '',
  },

  // Product/site settings. Admin-editable site settings land in a later phase —
  // for now this is the single source of truth for price/currency.
  site: {
    productName: 'The Reality Manual',
    productDescription: 'First Edition Premium Hardcover',
    bookPriceCents: 3900,
    currency: 'usd',
  },
};
