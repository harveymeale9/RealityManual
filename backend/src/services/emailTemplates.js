const BRAND = Object.freeze({
  ink: '#0e0b07',
  surface: '#17120c',
  ivory: '#f0e7d8',
  soft: '#b9aa92',
  gold: '#c9a24d',
  border: '#3b3020',
});

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function firstName(fullName) {
  return String(fullName || 'there').trim().split(/\s+/)[0] || 'there';
}

function formatMoney(cents, currency = 'usd') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: String(currency).toUpperCase(),
  }).format(Number(cents || 0) / 100);
}

function addressLines(order) {
  return [
    order.customer_name,
    order.street1,
    order.street2,
    [order.city, order.state, order.postal_code].filter(Boolean).join(', '),
    order.country_name || order.country,
  ].filter(Boolean).map(String);
}

function positiveDeliveryDays(value) {
  const days = Number(value);
  return Number.isInteger(days) && days > 0 ? days : null;
}

function deliveryEstimate(order, shipment) {
  const minDays = positiveDeliveryDays(
    shipment.minDeliveryDays ?? shipment.min_delivery_days ?? order.shipping_min_delivery_days,
  );
  const maxDays = positiveDeliveryDays(
    shipment.maxDeliveryDays ?? shipment.max_delivery_days ?? order.shipping_max_delivery_days,
  );

  if (minDays && maxDays && minDays !== maxDays) {
    return `${minDays} to ${maxDays} working days after dispatch`;
  }
  if (minDays || maxDays) {
    return `approximately ${minDays || maxDays} working days after dispatch`;
  }
  return null;
}

function detailsTable(rows) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:28px 0;border-top:1px solid ${BRAND.border};">
      ${rows.map(([label, value]) => `
        <tr>
          <td valign="top" style="padding:13px 12px 13px 0;border-bottom:1px solid ${BRAND.border};color:${BRAND.gold};font-family:Arial,sans-serif;font-size:10px;line-height:16px;letter-spacing:1.6px;text-transform:uppercase;width:34%;">${escapeHtml(label)}</td>
          <td valign="top" style="padding:13px 0;border-bottom:1px solid ${BRAND.border};color:${BRAND.ivory};font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:22px;text-align:right;">${value}</td>
        </tr>`).join('')}
    </table>`;
}

function layout({ preview = false, previewLabel = 'Sample Preview: Not a Real Order', preheader, eyebrow, title, body, details, callout, button, afterButton }) {
  const previewBanner = preview
    ? `<tr><td style="background:${BRAND.gold};color:${BRAND.ink};padding:9px 24px;text-align:center;font-family:Arial,sans-serif;font-size:10px;font-weight:bold;letter-spacing:1.7px;text-transform:uppercase;">${escapeHtml(previewLabel)}</td></tr>`
    : '';
  const buttonMarkup = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto 8px;"><tr><td style="border:1px solid ${BRAND.gold};"><a href="${escapeHtml(button.href)}" style="display:inline-block;padding:14px 28px;color:${BRAND.ivory};font-family:Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1.8px;text-decoration:none;text-transform:uppercase;">${escapeHtml(button.label)}</a></td></tr></table>`
    : '';

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.ink};color:${BRAND.ivory};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${BRAND.ink};">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:620px;background:${BRAND.surface};border:1px solid ${BRAND.border};">
        ${previewBanner}
        <tr><td style="padding:38px 34px 30px;border-bottom:1px solid ${BRAND.border};text-align:center;">
          <div style="color:${BRAND.ivory};font-family:Arial,sans-serif;font-size:14px;letter-spacing:5px;text-transform:uppercase;">The Reality Manual</div>
          <div style="width:54px;height:1px;margin:20px auto 0;background:${BRAND.gold};font-size:0;line-height:0;">&nbsp;</div>
        </td></tr>
        <tr><td style="padding:42px 34px 38px;">
          <div style="margin-bottom:14px;color:${BRAND.gold};font-family:Arial,sans-serif;font-size:10px;font-weight:bold;letter-spacing:2.2px;text-transform:uppercase;">${escapeHtml(eyebrow)}</div>
          <h1 style="margin:0 0 24px;color:${BRAND.ivory};font-family:Georgia,'Times New Roman',serif;font-size:34px;font-weight:normal;line-height:41px;">${escapeHtml(title)}</h1>
          <div style="color:${BRAND.soft};font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:28px;">${body}</div>
          ${details || ''}
          ${callout ? `<div style="margin:30px 0 4px;padding:24px;border-left:2px solid ${BRAND.gold};background:${BRAND.ink};color:${BRAND.ivory};font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:26px;">${callout}</div>` : ''}
          ${buttonMarkup}
          ${afterButton || ''}
        </td></tr>
        <tr><td style="padding:26px 34px;border-top:1px solid ${BRAND.border};color:${BRAND.soft};font-family:Arial,sans-serif;font-size:11px;line-height:18px;text-align:center;">
          Questions about your order? Reply to this email.<br>
          <a href="https://realitymanual.com" style="color:${BRAND.gold};text-decoration:none;">realitymanual.com</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function orderConfirmedEmail(order, { preview = false } = {}) {
  const orderNumber = order.display_order_id || order.id;
  const address = addressLines(order);
  const subject = 'We’ve Received Your Reality Manual Order';
  const details = detailsTable([
    ['Order', escapeHtml(orderNumber)],
    ['Edition', 'Hardcover, Deluxe First Edition'],
    ['Quantity', escapeHtml(order.quantity || 1)],
    ['Total', escapeHtml(`${formatMoney(order.total_price_cents, order.currency)} ${String(order.currency || 'usd').toUpperCase()}`)],
    ['Delivering to', address.map(escapeHtml).join('<br>')],
  ]);
  const body = `
    <p style="margin:0 0 18px;">Thank you, ${escapeHtml(firstName(order.customer_name))}. We have received your payment and accepted your order for <em>The Reality Manual</em>.</p>
    <p style="margin:0;">Every copy is printed, bound, carefully inspected and finished to order by one of Europe’s leading printers of bespoke books. Nothing is pulled from a warehouse shelf. Your book receives the time and individual attention needed to create a beautiful volume you can return to and keep for a lifetime.</p>`;
  const callout = `We are arranging production with our bespoke printer. If that takes longer than expected, you do not need to pay again or take any action. We aim to resolve any printer issue within 24 hours and will issue a full refund if we cannot fulfill your order. Once in production, please allow up to <strong style="color:${BRAND.gold};">15 working days</strong> before dispatch. We’ll email you when your copy ships.`;
  const text = [
    preview ? 'SAMPLE PREVIEW: NOT A REAL ORDER' : '',
    'THE REALITY MANUAL',
    '',
    'WE’VE RECEIVED YOUR REALITY MANUAL ORDER',
    '',
    `Thank you, ${firstName(order.customer_name)}. We have received your payment and accepted your order for The Reality Manual.`,
    '',
    'Every copy is printed, bound, carefully inspected and finished to order by one of Europe’s leading printers of bespoke books. Nothing is pulled from a warehouse shelf. Your book receives the time and individual attention needed to create a beautiful volume you can return to and keep for a lifetime.',
    '',
    'We are arranging production with our bespoke printer. If that takes longer than expected, you do not need to pay again or take any action. We aim to resolve any printer issue within 24 hours and will issue a full refund if we cannot fulfill your order. Once in production, please allow up to 15 working days before dispatch. We will email you when your copy ships.',
    '',
    `Order: ${orderNumber}`,
    'Edition: Hardcover, Deluxe First Edition',
    `Quantity: ${order.quantity || 1}`,
    `Total: ${formatMoney(order.total_price_cents, order.currency)} ${String(order.currency || 'usd').toUpperCase()}`,
    'Delivering to:',
    ...address,
    '',
    'Questions about your order? Reply to this email.',
    'https://realitymanual.com',
  ].filter((line, index, all) => line || index > 0 || all[0]).join('\n');

  return {
    subject,
    html: layout({ preview, preheader: 'We received your payment and are arranging production.', eyebrow: 'Order received', title: 'We’ve Received Your Reality Manual Order', body, details, callout }),
    text,
  };
}

function orderShippedEmail(order, shipment = {}, { preview = false } = {}) {
  const orderNumber = order.display_order_id || order.id;
  const address = addressLines(order);
  const trackingUrl = shipment.trackingUrl || shipment.tracking_url || '';
  const carrier = shipment.carrierName || shipment.carrier_name || 'Your delivery carrier';
  const trackingNumber = shipment.trackingNumber || shipment.tracking_number || '';
  const estimate = deliveryEstimate(order, shipment);
  const rows = [
    ['Order', escapeHtml(orderNumber)],
    ['Carrier', escapeHtml(carrier)],
  ];
  if (trackingNumber) rows.push(['Tracking', escapeHtml(trackingNumber)]);
  if (estimate) rows.push(['Estimated delivery', escapeHtml(estimate)]);
  rows.push(['Delivering to', address.map(escapeHtml).join('<br>')]);

  const subject = `${preview ? '[PREVIEW] ' : ''}Your Copy of The Reality Manual Is on Its Way`;
  const body = `
    <p style="margin:0 0 18px;">Wonderful news, ${escapeHtml(firstName(order.customer_name))}. Your copy of <em>The Reality Manual</em> is complete and on its way to you.</p>
    <p style="margin:0;">Thank you for your patience while our bespoke printer created, inspected and carefully packed your book. We hope opening it feels every bit as special as the care that went into making it${trackingUrl ? '. You can follow its journey below' : ''}.</p>`;
  const text = [
    preview ? 'SAMPLE PREVIEW: NOT A REAL ORDER' : '',
    'THE REALITY MANUAL',
    '',
    'YOUR COPY OF THE REALITY MANUAL IS ON ITS WAY',
    '',
    `Wonderful news, ${firstName(order.customer_name)}. Your copy of The Reality Manual is complete and on its way to you.`,
    '',
    'Thank you for your patience while our bespoke printer created, inspected and carefully packed your book. We hope opening it feels every bit as special as the care that went into making it.',
    '',
    `Order: ${orderNumber}`,
    `Carrier: ${carrier}`,
    trackingNumber ? `Tracking: ${trackingNumber}` : '',
    estimate ? `Estimated delivery: ${estimate}` : '',
    trackingUrl ? `Track your shipment: ${trackingUrl}` : '',
    'Delivering to:',
    ...address,
    '',
    'IF YOUR BOOK ARRIVES DAMAGED',
    'From time to time, a copy may have a printing defect or be damaged in transit. If this happens to yours, please take photos of the damage or printing errors and reply to this email with them. We’ll get another copy on the way immediately.',
    '',
    'Questions about your order? Reply to this email.',
    'https://realitymanual.com',
  ].filter(Boolean).join('\n');

  return {
    subject,
    html: layout({
      preview,
      preheader: 'Your finished copy has left the printer.',
      eyebrow: 'Dispatched',
      title: 'Your Copy of The Reality Manual Is on Its Way',
      body,
      details: detailsTable(rows),
      callout: estimate
        ? `Your estimated delivery time is <strong style="color:${BRAND.gold};">${escapeHtml(estimate)}</strong>. Delivery times are estimates and may vary slightly by destination or during busy periods.`
        : 'Your book is finally on its way. We cannot wait for it to reach you.',
      button: trackingUrl ? { label: 'Track your shipment', href: trackingUrl } : null,
      afterButton: `<div style="margin:30px 0 0;padding:22px 24px;border:1px solid ${BRAND.border};background:${BRAND.ink};">
        <div style="margin:0 0 10px;color:${BRAND.gold};font-family:Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;">If your book arrives damaged</div>
        <div style="color:${BRAND.soft};font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:24px;">From time to time, a copy may have a printing defect or be damaged in transit. If this happens to yours, please take photos of the damage or printing errors and reply to this email with them. We’ll get another copy on the way immediately.</div>
      </div>`,
    }),
    text,
  };
}

function orderRefundedEmail(order, { preview = false } = {}) {
  const orderNumber = order.display_order_id || order.id;
  const total = `${formatMoney(order.total_price_cents, order.currency)} ${String(order.currency || 'usd').toUpperCase()}`;
  const subject = `${preview ? '[PREVIEW] ' : ''}We Couldn’t Complete Your Order`;
  const body = `
    <p style="margin:0 0 18px;">We’re sorry, ${escapeHtml(firstName(order.customer_name))}, but our printer was unable to accept your order after several attempts.</p>
    <p style="margin:0;">Rather than leave you waiting, we have issued a full refund to your original payment method. Please do not place another order yet. We’ll let you know when ordering is available again.</p>`;
  const callout = 'The refund has left our system, although your bank may take several working days to display it. If you have questions, please reply to this email.';
  const text = [
    preview ? 'SAMPLE PREVIEW: NOT A REAL ORDER' : '',
    'THE REALITY MANUAL',
    '',
    'WE COULDN’T COMPLETE YOUR ORDER',
    '',
    `We’re sorry, ${firstName(order.customer_name)}, but our printer was unable to accept your order after several attempts.`,
    'Rather than leave you waiting, we have issued a full refund to your original payment method. Please do not place another order yet. We’ll let you know when ordering is available again.',
    '',
    `Order: ${orderNumber}`,
    `Refund: ${total}`,
    '',
    'The refund has left our system, although your bank may take several working days to display it. If you have questions, please reply to this email.',
    '',
    'Questions about your order? Reply to this email.',
    'https://realitymanual.com',
  ].filter(Boolean).join('\n');

  return {
    subject,
    html: layout({
      preview,
      preheader: 'Your Reality Manual order has been refunded.',
      eyebrow: 'Order update',
      title: 'We Couldn’t Complete Your Order',
      body,
      details: detailsTable([
        ['Order', escapeHtml(orderNumber)],
        ['Refund', escapeHtml(total)],
      ]),
      callout,
    }),
    text,
  };
}

function reviewRequestEmail(order, { preview = false } = {}) {
  const name = firstName(order.customer_name);
  const subject = `${preview ? '[PREVIEW] ' : ''}How are you finding The Reality Manual?`;
  const unsubscribeUrl = `https://api.realitymanual.com/api/review/unsubscribe?order=${encodeURIComponent(order.id)}`;
  const body = `
    <p style="margin:0 0 18px;">Hi ${escapeHtml(name)},</p>
    <p style="margin:0 0 18px;">I hope your copy of <em>The Reality Manual</em> has arrived and you've had some time with it.</p>
    <p style="margin:0 0 18px;">How are you finding the book so far? I'd love to hear your honest feedback, whether a passage resonated, challenged you, or left you with a question.</p>
    <p style="margin:0 0 18px;">If you'd be willing to share a short review, just reply to this email with a few lines in your own words. There's no form to fill out, and no pressure if you're still reading.</p>
    <p style="margin:0 0 18px;">A short video review would mean a great deal too. You can reply here with the video or a link, tag me on Instagram at <a href="https://www.instagram.com/the_reality_manual/" style="color:${BRAND.gold};text-decoration:underline;">@the_reality_manual</a>, or DM it to me there. I'd be especially grateful to anyone who takes the time to record one.</p>
    <p style="margin:0 0 18px;">If your book hasn't arrived yet, please reply and I'll look into it.</p>
    <p style="margin:0 0 18px;font-size:14px;line-height:23px;"><a href="${escapeHtml(unsubscribeUrl)}" style="color:${BRAND.gold};text-decoration:underline;">Unsubscribe from review emails</a></p>
    <p style="margin:0;">Thank you for reading,<br>The Reality Manual</p>`;
  const text = [
    preview ? 'PREVIEW ONLY: NOT A CUSTOMER EMAIL' : '',
    'THE REALITY MANUAL',
    '',
    'HOW ARE YOU FINDING THE REALITY MANUAL?',
    '',
    `Hi ${name},`,
    '',
    "I hope your copy of The Reality Manual has arrived and you've had some time with it.",
    '',
    "How are you finding the book so far? I'd love to hear your honest feedback, whether a passage resonated, challenged you, or left you with a question.",
    '',
    "If you'd be willing to share a short review, just reply to this email with a few lines in your own words. There's no form to fill out, and no pressure if you're still reading.",
    '',
    "A short video review would mean a great deal too. You can reply here with the video or a link, tag me on Instagram at @the_reality_manual, or DM it to me there. I'd be especially grateful to anyone who takes the time to record one.",
    'Instagram: https://www.instagram.com/the_reality_manual/',
    '',
    "If your book hasn't arrived yet, please reply and I'll look into it.",
    '',
    'Unsubscribe from review emails:',
    unsubscribeUrl,
    '',
    'Thank you for reading,',
    'The Reality Manual',
  ].filter((line, index, all) => line || index > 0 || all[0]).join('\n');

  return {
    subject,
    html: layout({
      preview,
      previewLabel: 'Preview Only: Not a Customer Email',
      preheader: "I'd love to hear what you think of The Reality Manual.",
      eyebrow: 'A note from the author',
      title: 'How are you finding The Reality Manual?',
      body,
    }),
    text,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

module.exports = {
  escapeHtml,
  orderConfirmedEmail,
  orderShippedEmail,
  orderRefundedEmail,
  reviewRequestEmail,
};
