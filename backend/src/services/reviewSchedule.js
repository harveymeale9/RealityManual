const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_TRANSIT_DAYS = 14;
const READING_DAYS = 7;

function addWorkingDays(start, count) {
  const date = new Date(start.getTime());
  let remaining = count;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return date;
}

// Delivery is estimated, never confirmed. Start with the shipping email sent
// after BookVault's Dispatched status, then use the slower of the saved
// destination/service quote or a conservative 14-calendar-day UK-origin
// allowance. Wait one further week for time to read before asking for a review.
function reviewRequestDueAt(order) {
  if (!order?.shipping_email_sent_at) return null;
  const dispatched = new Date(order.shipping_email_sent_at);
  if (!Number.isFinite(dispatched.getTime())) return null;

  const baselineArrival = new Date(dispatched.getTime() + MIN_TRANSIT_DAYS * DAY_MS);
  const quotedDays = Number(order.shipping_max_delivery_days);
  const quotedArrival = Number.isInteger(quotedDays) && quotedDays > 0 && quotedDays <= 365
    ? addWorkingDays(dispatched, quotedDays)
    : null;
  const estimatedArrival = quotedArrival && quotedArrival > baselineArrival
    ? quotedArrival
    : baselineArrival;
  return new Date(estimatedArrival.getTime() + READING_DAYS * DAY_MS).toISOString();
}

module.exports = { reviewRequestDueAt, addWorkingDays };
