// Keep the Worker checkout contract aligned with backend/src/lib/validation.js.
const limits = { customer_name: 200, email: 120, phone: 35, street1: 200, street2: 250, city: 99, state: 200, postal_code: 99 };

export function normalizeQuantity(value) {
  if (value === undefined || value === null || value === '') return 1;
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= 20 ? count : null;
}

export function validateCheckoutInput(body = {}) {
  const errors = {};
  for (const [name, max] of Object.entries(limits)) {
    const value = body[name];
    if (name === 'street2' || name === 'state') {
      if (value != null && typeof value !== 'string') errors[name] = `${name} must be text.`;
    } else if (typeof value !== 'string' || !value.trim()) {
      errors[name] = `${name} is required.`;
    }
    if (typeof value === 'string' && value.trim().length > max) errors[name] = `${name} must be ${max} characters or fewer.`;
  }
  if (typeof body.email === 'string' && body.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) errors.email = 'A valid email address is required.';
  if (typeof body.phone === 'string' && body.phone.trim() && !/^\+?[\d\s\-.()/]{6,35}$/.test(body.phone.trim())) errors.phone = 'A valid phone number is required.';
  if (typeof body.country_code !== 'string' || !/^[A-Z]{2}$/.test(body.country_code.trim())) errors.country_code = 'Please select a valid country.';
  if (normalizeQuantity(body.quantity) === null) errors.quantity = 'Quantity must be a whole number between 1 and 20.';
  if (body.review_request_opt_in !== undefined && typeof body.review_request_opt_in !== 'boolean') errors.review_request_opt_in = 'Review email preference must be true or false.';
  return errors;
}

export function normalizeOrderAttribution(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const clean = (value, max = 120) => String(value == null ? '' : value).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max);
  const touch = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    let referrerHost = '';
    try {
      const url = new URL(value.referrer);
      if (['http:', 'https:'].includes(url.protocol)) referrerHost = clean(url.hostname.toLowerCase(), 180);
    } catch { /* No referrer. */ }
    const captured = Date.parse(value.captured_at);
    return {
      source: clean(value.utm_source), medium: clean(value.utm_medium),
      campaign: clean(value.utm_campaign), content: clean(value.utm_content),
      referrer_host: referrerHost,
      captured_at: Number.isFinite(captured) ? new Date(captured).toISOString() : null,
    };
  };
  const first = touch(input.first);
  const lastTagged = touch(input.last_tagged);
  return first || lastTagged ? JSON.stringify({ first, last_tagged: lastTagged?.source ? lastTagged : null }) : null;
}
