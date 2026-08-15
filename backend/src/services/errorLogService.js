const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const insertStmt = db.prepare(`
  INSERT INTO error_logs (id, order_id, service, error_type, error_message, request_reference, attempt_number)
  VALUES (@id, @order_id, @service, @error_type, @error_message, @request_reference, @attempt_number)
`);

// service: 'stripe' | 'lulu' | 'refund' | 'database' | 'backend'
function logError({ orderId = null, service, errorType, errorMessage, requestReference = null, attemptNumber = 1 }) {
  console.error(`[${service}] ${errorType}: ${errorMessage}`);

  try {
    insertStmt.run({
      id: uuidv4(),
      order_id: orderId,
      service,
      error_type: errorType,
      error_message: errorMessage,
      request_reference: requestReference,
      attempt_number: attemptNumber,
    });
  } catch (dbErr) {
    // Logging must never crash the request path it's called from.
    console.error('[database] failed to write error_logs row:', dbErr.message);
  }
}

module.exports = { logError };
