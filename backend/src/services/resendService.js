const config = require('../config');

const RESEND_API_URL = 'https://api.resend.com';
const RESEND_EMAILS_URL = `${RESEND_API_URL}/emails`;
const PURCHASER_SEGMENT_NAME = 'Customers | The Reality Manual';
const PURCHASER_PROPERTIES = [
  { key: 'customer_status', type: 'string' },
  { key: 'products_purchased', type: 'string' },
  { key: 'last_order_quantity', type: 'number' },
  { key: 'largest_order_quantity', type: 'number' },
  { key: 'lifetime_book_quantity', type: 'number' },
  { key: 'purchase_order_count', type: 'number' },
  { key: 'quantity_band', type: 'string' },
  { key: 'first_purchase_at', type: 'string' },
  { key: 'latest_purchase_at', type: 'string' },
];

function splitCustomerName(customerName) {
  const parts = String(customerName || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.shift() || '',
    lastName: parts.join(' '),
  };
}

function quantityBand(quantity) {
  const count = Math.max(1, Number(quantity) || 1);
  return count >= 5 ? '5_plus_books' : `${count}_book${count === 1 ? '' : 's'}`;
}

function createResendClient({
  apiKey = config.resend.apiKey,
  fromEmail = config.resend.fromEmail,
  replyTo = config.resend.replyTo,
  fetchImpl = global.fetch,
} = {}) {
  let purchaserSchemaPromise = null;

  function assertConfigured() {
    if (!apiKey || !fromEmail) {
      throw new Error('Resend is not configured. RESEND_API_KEY and RESEND_FROM_EMAIL are required.');
    }
  }

  async function request(path, { method = 'GET', body, idempotencyKey } = {}) {
    assertConfigured();

    const headers = { Authorization: `Bearer ${apiKey}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    const response = await fetchImpl(`${RESEND_API_URL}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    let responseBody = {};
    try {
      responseBody = await response.json();
    } catch {
      // A non-JSON upstream error is still reported safely below.
    }

    if (!response.ok) {
      const message = responseBody?.message || responseBody?.error || `HTTP ${response.status}`;
      const error = new Error(`Resend rejected the request: ${message}`);
      error.status = response.status;
      throw error;
    }

    return responseBody;
  }

  async function sendEmail({ to, subject, html, text, idempotencyKey, tags }) {
    assertConfigured();
    if (!to || !subject || !html || !text) {
      throw new Error('A recipient, subject, HTML body, and plain-text body are required.');
    }

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    const payload = {
      from: fromEmail,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
    };
    if (replyTo) payload.reply_to = replyTo;
    if (Array.isArray(tags) && tags.length) payload.tags = tags;

    const response = await fetchImpl(RESEND_EMAILS_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    let body = {};
    try {
      body = await response.json();
    } catch {
      // A non-JSON upstream error is still reported safely below.
    }

    if (!response.ok) {
      const message = body?.message || body?.error || `HTTP ${response.status}`;
      throw new Error(`Resend rejected the email: ${message}`);
    }

    return body;
  }

  async function ensurePurchaserSchema() {
    if (purchaserSchemaPromise) return purchaserSchemaPromise;

    purchaserSchemaPromise = (async () => {
      const [propertyList, segmentList] = await Promise.all([
        request('/contact-properties?limit=100'),
        request('/segments?limit=100'),
      ]);

      const existingProperties = new Map(
        (propertyList.data || []).map((property) => [property.key, property]),
      );
      for (const property of PURCHASER_PROPERTIES) {
        const existing = existingProperties.get(property.key);
        if (existing && existing.type !== property.type) {
          throw new Error(
            `Resend contact property ${property.key} is ${existing.type}; expected ${property.type}.`,
          );
        }
        if (!existing) {
          await request('/contact-properties', { method: 'POST', body: property });
        }
      }

      let segment = (segmentList.data || []).find((item) => item.name === PURCHASER_SEGMENT_NAME);
      if (!segment) {
        segment = await request('/segments', {
          method: 'POST',
          body: { name: PURCHASER_SEGMENT_NAME },
        });
      }

      return { segmentId: segment.id };
    })().catch((error) => {
      purchaserSchemaPromise = null;
      throw error;
    });

    return purchaserSchemaPromise;
  }

  async function syncPurchaserContact(order, summary) {
    if (!order?.email) throw new Error('An order email is required to sync a Resend contact.');
    const { segmentId } = await ensurePurchaserSchema();
    const { firstName, lastName } = splitCustomerName(order.customer_name);
    const properties = {
      customer_status: 'purchaser',
      products_purchased: 'reality_manual_hardcover',
      last_order_quantity: Number(order.quantity),
      largest_order_quantity: Number(summary.largest_order_quantity),
      lifetime_book_quantity: Number(summary.lifetime_book_quantity),
      purchase_order_count: Number(summary.purchase_order_count),
      quantity_band: quantityBand(summary.largest_order_quantity),
      first_purchase_at: summary.first_purchase_at,
      latest_purchase_at: summary.latest_purchase_at,
    };
    const contactBody = {
      first_name: firstName,
      last_name: lastName,
      properties,
    };
    const contactPath = `/contacts/${encodeURIComponent(order.email.trim().toLowerCase())}`;

    let contact;
    try {
      contact = await request(contactPath);
    } catch (error) {
      if (error.status !== 404) throw error;
    }

    if (contact) {
      // Deliberately omit `unsubscribed`: a later purchase must never silently
      // reverse an opt-out that the customer already made in Resend.
      await request(contactPath, { method: 'PATCH', body: contactBody });
      await request(`${contactPath}/segments/${segmentId}`, { method: 'POST' });
      return { id: contact.id, created: false, properties };
    }

    const created = await request('/contacts', {
      method: 'POST',
      body: {
        email: order.email.trim().toLowerCase(),
        ...contactBody,
        unsubscribed: false,
        segments: [{ id: segmentId }],
      },
    });
    return { id: created.id, created: true, properties };
  }

  return { sendEmail, ensurePurchaserSchema, syncPurchaserContact };
}

module.exports = {
  PURCHASER_PROPERTIES,
  PURCHASER_SEGMENT_NAME,
  createResendClient,
  quantityBand,
  resendClient: createResendClient(),
};
