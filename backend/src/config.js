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

  // BookVault has no sandbox — this hits their live API even in development.
  // See CLAUDE.md §26/§64. Never expose bookvault.apiKey to the frontend.
  bookvault: {
    apiKey: process.env.BOOKVAULT_API_KEY || '',
    apiBaseUrl: process.env.BOOKVAULT_API_BASE_URL || 'https://api.bookvault.app/v3',
    // The 13-digit ISBN BookVault assigned to the print-ready title in their
    // library. Required on every OrderLine (shipping quotes and real orders
    // alike) — see CLAUDE.md §64.
    titleIsbn: process.env.BOOKVAULT_TITLE_ISBN || '',
  },

  // Product/site settings. Admin-editable site settings land in a later phase —
  // for now this is the single source of truth for price/currency.
  site: {
    productName: 'The Reality Manual',
    productDescription: 'Hardcover — Deluxe First Edition',
    bookPriceCents: 6500,
    currency: 'usd',
  },
};
