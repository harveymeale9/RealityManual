// Read-only, PII-stripped data for Content Studio's existing report engine.
// Requires a shared owner-installed bearer secret and the known VPS egress IP.
// IP alone is not sufficient: a staging probe showed a client-supplied
// CF-Connecting-IP header could alter the allowlist decision. No customer
// name, email, phone, street, postcode, or raw BookVault error is returned.
const TABLES = {
  orders: `SELECT id,stripe_payment_status,stripe_livemode,
    payment_failure_type,payment_failure_code,payment_decline_code,
    CASE WHEN payment_failure_message IS NOT NULL THEN 'Payment failed' ELSE NULL END AS payment_failure_message,
    country,quantity,book_price_cents,shipping_price_cents,shipping_service_name,
    total_price_cents,currency,attribution_json,bookvault_order_id,
    bookvault_production_cost_gbp_cents,bookvault_shipping_cost_gbp_cents,
    bookvault_total_cost_gbp_cents,bookvault_total_cost_usd_cents,bookvault_gbp_usd_rate,
    fulfillment_attempts,fulfillment_next_attempt_at,
    CASE WHEN fulfillment_last_error LIKE '%BatchPayment%' THEN 'BatchPayment: awaiting BookVault scheduled payment.'
      WHEN fulfillment_last_error IS NOT NULL THEN 'BookVault fulfillment failed'
      ELSE NULL END AS fulfillment_last_error,
    payment_received_at,fulfillment_alert_sent_at,fulfillment_deadline_alert_sent_at,
    confirmation_email_sent_at,shipping_email_sent_at,refund_email_sent_at,
    resend_contact_synced_at,order_status,created_at,updated_at FROM orders`,
  analytics_events: `SELECT id,session_id,event_name,page,utm_source,utm_medium,utm_campaign,
    utm_term,utm_content,country,verified_human,created_at FROM analytics_events`,
  analytics_daily_events: 'SELECT day,event_name,event_count,verified_visits FROM analytics_daily_events',
  analytics_daily_utm_sources: 'SELECT day,utm_source,verified_visits FROM analytics_daily_utm_sources',
  analytics_daily_utm_landings: `SELECT day,utm_source,utm_medium,utm_campaign,utm_content,
    verified_visits FROM analytics_daily_utm_landings`,
  error_logs: 'SELECT id,order_id,service,error_type,created_at FROM error_logs',
};

export function allowedReportSource(request, env) {
  const actualIp = request.headers.get('cf-connecting-ip') || '';
  const allowed = String(env.REPORT_ALLOWED_IPS || '').split(',').map((ip) => ip.trim());
  const bearer = request.headers.get('authorization') || '';
  return Boolean(env.REPORTS_ENABLED === 'true' && env.REPORT_ACCESS_TOKEN &&
    bearer === `Bearer ${env.REPORT_ACCESS_TOKEN}` && actualIp && allowed.includes(actualIp));
}

export async function reportSnapshot(request, env) {
  if (!allowedReportSource(request, env)) return new Response(null, { status: 403 });
  const tables = {};
  for (const [name, sql] of Object.entries(TABLES)) {
    const result = await env.DB.prepare(`${sql} LIMIT 10001`).all();
    if ((result.results || []).length > 10000) {
      return Response.json({ error: 'report_snapshot_too_large', table: name }, { status: 503 });
    }
    tables[name] = result.results || [];
  }
  return Response.json({ generated_at: new Date().toISOString(), tables }, {
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}
