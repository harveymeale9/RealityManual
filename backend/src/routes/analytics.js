const express = require('express');
const analyticsService = require('../services/analyticsService');
const { classifyAnalyticsRequest } = require('../services/analyticsClassifier');
const errorLogService = require('../services/errorLogService');

const router = express.Router();
const SUPPORTED_EVENTS = new Set([
  'human_verified',
  'page_view',
  'landing_page_view',
  'purchase_cta_clicked',
  'checkout_view',
  'checkout_started',
  'payment_submitted',
  'order_complete',
  'order_failed',
]);

// No auth — deliberately, matching CLAUDE.md §46's "relaxed security, do
// the basics" for this project. Never trust anything in the body as fact
// beyond recording it; this must never throw back to the client, since a
// broken analytics call should never break the page that fired it (§31).
router.post('/event', (req, res) => {
  try {
    const body = req.body || {};
    if (!body.event_name || !body.session_id) {
      return res.status(400).json({ error: 'missing_fields' });
    }
    if (!SUPPORTED_EVENTS.has(body.event_name)) {
      return res.status(400).json({ error: 'unsupported_event' });
    }
    const classification = classifyAnalyticsRequest(req, body);
    // Do not let crawlers, direct scripts, synthetic checks, or unengaged page
    // loads inflate reports or grow the database. The browser queues events
    // until it has genuine interaction evidence before sending any of them.
    if (!classification.verifiedHuman) return res.status(204).end();
    analyticsService.recordEvent(body, classification);
  } catch (err) {
    errorLogService.logError({
      service: 'backend',
      errorType: 'analytics_event_failed',
      errorMessage: err.message,
    });
  }
  res.status(204).end();
});

// Read-only aggregate counts — no PII (no names/emails/addresses), just
// event counts and session counts, so left unauthenticated like the event
// endpoint above. Consumed by the ops panel's Website Analytics tab.
router.get('/summary', (req, res) => {
  try {
    res.json(analyticsService.getSummary());
  } catch (err) {
    errorLogService.logError({
      service: 'backend',
      errorType: 'analytics_summary_failed',
      errorMessage: err.message,
    });
    res.status(500).json({ error: 'analytics_unavailable' });
  }
});

module.exports = router;
