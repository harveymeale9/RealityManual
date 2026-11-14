const EVENTS = new Set([
  'human_verified', 'page_view', 'utm_landing', 'landing_page_view', 'purchase_cta_clicked',
  'checkout_cta_header_clicked', 'checkout_cta_primary_clicked', 'checkout_cta_final_clicked',
  'checkout_arrival_header', 'checkout_arrival_primary', 'checkout_arrival_final',
  'checkout_view', 'checkout_started', 'payment_submitted', 'order_complete', 'order_failed',
]);
const FUNNEL = [
  'page_view', 'landing_page_view', 'purchase_cta_clicked', 'checkout_cta_header_clicked',
  'checkout_cta_primary_clicked', 'checkout_cta_final_clicked', 'checkout_arrival_header',
  'checkout_arrival_primary', 'checkout_arrival_final', 'checkout_view', 'checkout_started',
  'payment_submitted', 'order_complete', 'order_failed',
];
const BOT = /bot|crawler|spider|headless|phantom|selenium|playwright|puppeteer|curl|wget|python-requests|httpclient|facebookexternalhit|meta-externalagent|googleother|bingpreview|bytespider|claudebot|anthropic-ai|gptbot|chatgpt-user|perplexitybot/i;
const BROWSER = /mozilla|chrome|chromium|safari|firefox|edg\//i;
const clip = (value) => value == null ? null : String(value).slice(0, 500);
const response = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });

function verified(request, body, env) {
  const agent = request.headers.get('user-agent') || '';
  const origin = request.headers.get('origin') || '';
  const fetchSite = (request.headers.get('sec-fetch-site') || '').toLowerCase();
  const allowed = String(env.CORS_ORIGIN || '').split(',').map((part) => part.trim());
  return Boolean(agent && !BOT.test(agent) && BROWSER.test(agent) && allowed.includes(origin) &&
    (!fetchSite || ['same-origin', 'same-site'].includes(fetchSite)) &&
    body.human_verified === true && ['interaction', 'visible_time'].includes(body.human_verification));
}

export async function recordEvent(request, env) {
  try {
    const raw = await request.text();
    if (raw.length > 8192) return response({ error: 'invalid_event' }, 400);
    const body = JSON.parse(raw);
    if (!body?.event_name || !body?.session_id) return response({ error: 'missing_fields' }, 400);
    if (!EVENTS.has(body.event_name)) return response({ error: 'unsupported_event' }, 400);
    if (!verified(request, body, env)) return new Response(null, { status: 204 });
    await env.DB.prepare(`INSERT INTO analytics_events (
      id,session_id,event_name,page,order_id,referrer,utm_source,utm_medium,
      utm_campaign,utm_term,utm_content,country,verified_human,verification_method,classification_reason
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      crypto.randomUUID(), clip(body.session_id), body.event_name, clip(body.page), null,
      clip(body.referrer), clip(body.utm_source), clip(body.utm_medium), clip(body.utm_campaign),
      clip(body.utm_term), clip(body.utm_content), clip(body.country), 1,
      clip(body.human_verification), 'verified',
    ).run();
  } catch { /* Analytics may never interrupt checkout. */ }
  return new Response(null, { status: 204 });
}

function mergeCounts(rows, output = {}) {
  for (const row of rows) {
    const existing = output[row.event_name] || { count: 0, unique_sessions: 0 };
    existing.count += Number(row.n) || 0;
    existing.unique_sessions += Number(row.unique_sessions) || 0;
    output[row.event_name] = existing;
  }
  return output;
}

export async function getSummary(env, now = new Date()) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const today = start.toISOString();
  const period = new Date(start);
  period.setUTCDate(period.getUTCDate() - 29);
  const periodDay = period.toISOString().slice(0, 10);
  const todayRows = await env.DB.prepare(`SELECT event_name,COUNT(*) AS n,COUNT(DISTINCT session_id) AS unique_sessions
    FROM analytics_events WHERE created_at >= ? AND verified_human = 1 GROUP BY event_name`).bind(today).all();
  const recentRows = await env.DB.prepare(`SELECT event_name,COUNT(*) AS n,COUNT(DISTINCT session_id) AS unique_sessions
    FROM analytics_events WHERE created_at >= ? AND verified_human = 1 GROUP BY event_name`).bind(`${periodDay}T00:00:00.000Z`).all();
  const dailyRows = await env.DB.prepare(`SELECT event_name,SUM(event_count) AS n,SUM(verified_visits) AS unique_sessions
    FROM analytics_daily_events WHERE day >= ? GROUP BY event_name`).bind(periodDay).all();
  const sources = await env.DB.prepare(`SELECT utm_source,COUNT(DISTINCT session_id) AS sessions FROM analytics_events
    WHERE created_at >= ? AND verified_human = 1 AND event_name = 'page_view'
      AND utm_source IS NOT NULL AND utm_source != '' GROUP BY utm_source`).bind(`${periodDay}T00:00:00.000Z`).all();
  const dailySources = await env.DB.prepare(`SELECT utm_source,SUM(verified_visits) AS sessions FROM analytics_daily_utm_sources
    WHERE day >= ? GROUP BY utm_source`).bind(periodDay).all();
  const todayMap = mergeCounts(todayRows.results || []);
  const last30 = mergeCounts([...(recentRows.results || []), ...(dailyRows.results || [])]);
  const sourceTotals = new Map();
  for (const row of [...(sources.results || []), ...(dailySources.results || [])]) {
    sourceTotals.set(row.utm_source, (sourceTotals.get(row.utm_source) || 0) + Number(row.sessions || 0));
  }
  return response({
    today: { page_views: todayMap.page_view?.count || 0, unique_visitors: todayMap.page_view?.unique_sessions || 0 },
    last_30_days: { page_views: last30.page_view?.count || 0, unique_visitors: last30.page_view?.unique_sessions || 0 },
    funnel: FUNNEL.map((step) => ({ step, count: last30[step]?.count || 0, unique_sessions: last30[step]?.unique_sessions || 0 })),
    top_utm_sources: [...sourceTotals].map(([source, sessions]) => ({ source, sessions })).sort((a, b) => b.sessions - a.sessions).slice(0, 10),
    excluded_unverified_events: 0,
    visitor_definition: 'A verified browser visit after real interaction or seven visible seconds. Individual event rows are reduced to anonymous daily totals; different browsers or days may represent the same person.',
  });
}

// D1 batch is atomic. Never delete raw events before every aggregate upsert
// succeeds, otherwise a mid-sweep failure would erase visitor counts.
export async function aggregateCompletedDays(env, now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setUTCHours(0, 0, 0, 0);
  const iso = cutoff.toISOString();
  const events = await env.DB.prepare(`SELECT substr(created_at,1,10) AS day,event_name,COUNT(*) AS event_count,
    COUNT(DISTINCT session_id) AS verified_visits FROM analytics_events
    WHERE verified_human = 1 AND created_at < ? GROUP BY day,event_name`).bind(iso).all();
  const sources = await env.DB.prepare(`SELECT substr(created_at,1,10) AS day,utm_source,
    COUNT(DISTINCT session_id) AS verified_visits FROM analytics_events
    WHERE verified_human = 1 AND event_name = 'page_view' AND created_at < ?
      AND utm_source IS NOT NULL AND utm_source != '' GROUP BY day,utm_source`).bind(iso).all();
  const landings = await env.DB.prepare(`SELECT substr(created_at,1,10) AS day,utm_source,
    COALESCE(utm_medium,'') AS utm_medium,COALESCE(utm_campaign,'') AS utm_campaign,
    COALESCE(utm_content,'') AS utm_content,COUNT(DISTINCT session_id) AS verified_visits
    FROM analytics_events WHERE verified_human = 1 AND event_name = 'utm_landing' AND created_at < ?
      AND utm_source IS NOT NULL AND utm_source != '' GROUP BY day,utm_source,utm_medium,utm_campaign,utm_content`).bind(iso).all();
  const statements = [];
  for (const row of events.results || []) statements.push(env.DB.prepare(`INSERT INTO analytics_daily_events
    (day,event_name,event_count,verified_visits) VALUES(?,?,?,?)
    ON CONFLICT(day,event_name) DO UPDATE SET event_count=excluded.event_count,verified_visits=excluded.verified_visits`)
    .bind(row.day, row.event_name, row.event_count, row.verified_visits));
  for (const row of sources.results || []) statements.push(env.DB.prepare(`INSERT INTO analytics_daily_utm_sources
    (day,utm_source,verified_visits) VALUES(?,?,?) ON CONFLICT(day,utm_source)
    DO UPDATE SET verified_visits=excluded.verified_visits`).bind(row.day, row.utm_source, row.verified_visits));
  for (const row of landings.results || []) statements.push(env.DB.prepare(`INSERT INTO analytics_daily_utm_landings
    (day,utm_source,utm_medium,utm_campaign,utm_content,verified_visits) VALUES(?,?,?,?,?,?)
    ON CONFLICT(day,utm_source,utm_medium,utm_campaign,utm_content)
    DO UPDATE SET verified_visits=excluded.verified_visits`).bind(
      row.day, row.utm_source, row.utm_medium, row.utm_campaign, row.utm_content, row.verified_visits));
  statements.push(env.DB.prepare('DELETE FROM analytics_events WHERE verified_human = 1 AND created_at < ?').bind(iso));
  await env.DB.batch(statements);
}
