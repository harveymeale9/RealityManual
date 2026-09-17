const express = require('express');
const analyticsService = require('../services/analyticsService');
const errorLogService = require('../services/errorLogService');

const router = express.Router();

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
    analyticsService.recordEvent(body);
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
