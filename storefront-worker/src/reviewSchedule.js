const DAY_MS = 86400000;

function addWorkingDays(start, count) {
  const date = new Date(start.getTime());
  let remaining = count;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) remaining--;
  }
  return date;
}

export function reviewRequestDueAt(order) {
  if (!order?.shipping_email_sent_at) return null;
  const dispatched = new Date(order.shipping_email_sent_at);
  if (!Number.isFinite(dispatched.getTime())) return null;
  const baseline = new Date(dispatched.getTime() + 14 * DAY_MS);
  const quotedDays = Number(order.shipping_max_delivery_days);
  const quoted = Number.isInteger(quotedDays) && quotedDays > 0 && quotedDays <= 365
    ? addWorkingDays(dispatched, quotedDays) : null;
  const estimatedArrival = quoted && quoted > baseline ? quoted : baseline;
  return new Date(estimatedArrival.getTime() + 7 * DAY_MS).toISOString();
}
