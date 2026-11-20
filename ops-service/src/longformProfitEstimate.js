'use strict';

const { TRACKING_START_DAY } = require('./youtubeClickthrough');

const PAID_ORDER_SQL = `order_status != 'REFUNDED' AND
  (stripe_payment_status IN ('succeeded','paid') OR order_status IN
  ('PAYMENT_RECEIVED','BOOKVAULT_PENDING','BOOKVAULT_ACCEPTED','FULFILLMENT_RETRY','SHIPPED','COMPLETE'))`;
const RPM_CENTS = 300;

function sourceIsSocial(touch) {
  const source = String(touch && touch.source || '').toLowerCase();
  const host = String(touch && touch.referrer_host || '').toLowerCase();
  return ['instagram', 'facebook', 'ig', 'fb'].includes(source) ||
    /(^|\.)(instagram\.com|facebook\.com|fb\.com|l\.facebook\.com)$/.test(host);
}

function socialOrder(value) {
  if (!value) return false;
  try {
    const attribution = JSON.parse(value);
    return sourceIsSocial(attribution.first) || sourceIsSocial(attribution.last_tagged);
  } catch { return false; }
}

function report(storeDb, opsDb, pieces, excludedIds = [], nowValue = Date.now()) {
  const now = Date.parse(new Date(nowValue).toISOString());
  const videos = (pieces || []).filter(function (piece) {
    return piece && piece.contentType === 'longform' && piece.stage === 'live' &&
      piece.youtubeVideoId && /^\d{1,6}$/.test(String(piece.seq || '')) &&
      Date.parse(piece.postedAt || '') <= now;
  });
  const bySeq = new Map(videos.map(function (piece) {
    return [String(Number(piece.seq)), { piece_id: piece.id, seq: Number(piece.seq),
      title: piece.title || `Video #${piece.seq}`, youtube_url: piece.youtubeUrl || null,
      views: null, views_captured_at: null, tracked_clicks: 0 }];
  }));
  const byId = new Map(videos.map(function (piece) { return [piece.id, bySeq.get(String(Number(piece.seq)))]; }));
  const latestView = opsDb.prepare(`SELECT captured_at, views FROM content_metric_snapshots
    WHERE piece_id=? AND platform='youtube' AND views IS NOT NULL
    ORDER BY captured_at DESC LIMIT 1`);
  byId.forEach(function (row, pieceId) {
    const snapshot = latestView.get(pieceId);
    if (snapshot) {
      row.views = Math.max(0, Number(snapshot.views) || 0);
      row.views_captured_at = snapshot.captured_at;
    }
  });

  const key = function (row) { return [row.day, String(row.utm_content || '')].join('|'); };
  const daily = storeDb.prepare(`SELECT day, utm_content, verified_visits AS clicks
    FROM analytics_daily_utm_landings WHERE day >= ? AND lower(utm_source)='youtube'
      AND lower(utm_medium)='video' AND lower(utm_campaign)='longform'`)
    .all(TRACKING_START_DAY);
  const compactedKeys = new Set(daily.map(key));
  const raw = storeDb.prepare(`SELECT substr(created_at,1,10) AS day, utm_content,
    COUNT(DISTINCT session_id) AS clicks FROM analytics_events
    WHERE created_at >= ? AND verified_human=1 AND event_name='utm_landing'
      AND lower(utm_source)='youtube' AND lower(utm_medium)='video'
      AND lower(utm_campaign)='longform'
    GROUP BY day, utm_content`).all(TRACKING_START_DAY + 'T00:00:00.000Z');
  daily.concat(raw.filter(function (row) { return !compactedKeys.has(key(row)); }))
    .forEach(function (landing) {
      const content = String(landing.utm_content || '');
      if (!/^\d{1,6}$/.test(content)) return;
      const row = bySeq.get(String(Number(content)));
      if (row) row.tracked_clicks += Math.max(0, Number(landing.clicks) || 0);
    });

  const excluded = Array.from(new Set(excludedIds || [])).filter(function (id) {
    return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
  });
  const orders = storeDb.prepare(`SELECT total_price_cents, bookvault_total_cost_usd_cents,
    attribution_json FROM orders WHERE ${PAID_ORDER_SQL}` +
    (excluded.length ? ` AND id NOT IN (${excluded.map(function () { return '?'; }).join(',')})` : ''))
    .all(...excluded);
  let eligibleOrders = 0;
  let excludedSocialOrders = 0;
  let pendingCostOrders = 0;
  let poolCents = 0;
  orders.forEach(function (order) {
    if (socialOrder(order.attribution_json)) { excludedSocialOrders++; return; }
    eligibleOrders++;
    if (order.bookvault_total_cost_usd_cents == null) { pendingCostOrders++; return; }
    poolCents += Number(order.total_price_cents) - Number(order.bookvault_total_cost_usd_cents);
  });

  const rows = [...bySeq.values()];
  const totalClicks = rows.reduce(function (sum, row) { return sum + row.tracked_clicks; }, 0);
  if (totalClicks) {
    const sign = poolCents < 0 ? -1 : 1;
    const magnitude = Math.abs(poolCents);
    let assigned = 0;
    const fractions = rows.map(function (row) {
      const exact = magnitude * row.tracked_clicks / totalClicks;
      const whole = Math.floor(exact);
      row.est_book_profit_cents = whole * sign;
      assigned += whole;
      return { row, fraction: exact - whole };
    }).sort(function (a, b) { return b.fraction - a.fraction || a.row.seq - b.row.seq; });
    for (let i = 0; i < magnitude - assigned; i++) fractions[i].row.est_book_profit_cents += sign;
  }
  rows.forEach(function (row) {
    row.click_rate_percent = row.views > 0 ? Math.round(row.tracked_clicks / row.views * 10000) / 100 : null;
    row.est_adsense_profit_cents = row.views == null ? null : Math.round(row.views * RPM_CENTS / 1000);
    row.est_total_profit_cents = row.est_book_profit_cents == null || row.est_adsense_profit_cents == null
      ? null : row.est_book_profit_cents + row.est_adsense_profit_cents;
  });
  return { as_of: new Date(now).toISOString(), tracking_since: TRACKING_START_DAY,
    rpm_usd: RPM_CENTS / 100, eligible_orders: eligibleOrders, excluded_social_orders: excludedSocialOrders,
    pending_cost_orders: pendingCostOrders, book_profit_pool_cents: poolCents,
    allocated_book_profit_cents: totalClicks ? poolCents : 0, tracked_clicks: totalClicks,
    videos: rows.sort(function (a, b) { return b.est_total_profit_cents - a.est_total_profit_cents || a.seq - b.seq; }) };
}

module.exports = { report, socialOrder };
