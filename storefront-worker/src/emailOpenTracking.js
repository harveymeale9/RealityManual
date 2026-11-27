// Persist provider-observed unique opens before Resend's rolling retention expires.
// The mapping contains no recipient address, order details, or open IP/user-agent.
export async function captureReviewOpenMetrics(env, now = new Date()) {
  if (!env.RESEND_API_KEY) return 0;
  const start = new Date(now.getTime() - 28 * 86400000);
  const params = new URLSearchParams({
    start_date: start.toISOString(), end_date: now.toISOString(),
    dimensions: 'email', metrics: 'unique_opened',
  });
  const response = await fetch(`https://api.resend.com/emails/metrics?${params}`, {
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Resend open metrics returned ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body.data)) throw new Error('Resend open metrics have no email data.');
  const opened = body.data.filter((row) => row.email_id && Number(row.unique_opened) > 0);
  for (const row of opened) {
    await env.DB.prepare(`UPDATE email_open_tracking
      SET open_observed_at = COALESCE(open_observed_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      WHERE email_id = ? AND open_observed_at IS NULL`).bind(row.email_id).run();
  }
  return opened.length;
}
