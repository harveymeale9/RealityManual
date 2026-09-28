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

function layout({ preview = false, preheader, eyebrow, title, body, details, callout, button }) {
  const previewBanner = preview
    ? `<tr><td style="background:${BRAND.gold};color:${BRAND.ink};padding:9px 24px;text-align:center;font-family:Arial,sans-serif;font-size:10px;font-weight:bold;letter-spacing:1.7px;text-transform:uppercase;">Sample preview — not a real order</td></tr>`
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
  const subject = `${preview ? '[PREVIEW] ' : ''}Your copy of The Reality Manual is being made`;
  const details = detailsTable([
    ['Order', escapeHtml(orderNumber)],
    ['Edition', 'Hardcover — Deluxe First Edition'],
    ['Quantity', escapeHtml(order.quantity || 1)],
    ['Total', escapeHtml(`${formatMoney(order.total_price_cents, order.currency)} ${String(order.currency || 'usd').toUpperCase()}`)],
    ['Delivering to', address.map(escapeHtml).join('<br>')],
  ]);
  const body = `
    <p style="margin:0 0 18px;">Thank you, ${escapeHtml(firstName(order.customer_name))}. Your order has been accepted and your copy of <em>The Reality Manual</em> is now entering production.</p>
    <p style="margin:0;">It is not being pulled from a warehouse shelf. Your copy will be printed, bound and finished to order by one of Europe’s leading specialist book printers.</p>`;
  const callout = `Please allow up to <strong style="color:${BRAND.gold};">15 working days</strong> for this process before dispatch. Those days are spent making a carefully finished volume designed to be read, kept and passed on for a lifetime. We’ll email you again the moment it leaves the printer.`;
  const text = [
    preview ? 'SAMPLE PREVIEW — NOT A REAL ORDER' : '',
    'THE REALITY MANUAL',
    '',
    'YOUR COPY IS BEING MADE',
    '',
    `Thank you, ${firstName(order.customer_name)}. Your order has been accepted and your copy of The Reality Manual is now entering production.`,
    '',
    'It is not being pulled from a warehouse shelf. Your copy will be printed, bound and finished to order by one of Europe’s leading specialist book printers.',
    '',
    'Please allow up to 15 working days for this process before dispatch. Those days are spent making a carefully finished volume designed to be read, kept and passed on for a lifetime. We’ll email you again the moment it leaves the printer.',
    '',
    `Order: ${orderNumber}`,
    'Edition: Hardcover — Deluxe First Edition',
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
    html: layout({ preview, preheader: 'Your copy has been accepted for production.', eyebrow: 'Order confirmed', title: 'Your copy is being made.', body, details, callout }),
    text,
  };
}

function orderShippedEmail(order, shipment = {}, { preview = false } = {}) {
  const orderNumber = order.display_order_id || order.id;
  const address = addressLines(order);
  const trackingUrl = shipment.trackingUrl || shipment.tracking_url || '';
  const carrier = shipment.carrierName || shipment.carrier_name || 'Your delivery carrier';
  const trackingNumber = shipment.trackingNumber || shipment.tracking_number || '';
  const rows = [
    ['Order', escapeHtml(orderNumber)],
    ['Carrier', escapeHtml(carrier)],
  ];
  if (trackingNumber) rows.push(['Tracking', escapeHtml(trackingNumber)]);
  rows.push(['Delivering to', address.map(escapeHtml).join('<br>')]);

  const subject = `${preview ? '[PREVIEW] ' : ''}Your copy of The Reality Manual is on its way`;
  const body = `
    <p style="margin:0 0 18px;">The making is complete. Your copy has been printed, bound and finished, and has now left the printer.</p>
    <p style="margin:0;">It is on its way to you${trackingUrl ? ', and you can follow its journey below' : ''}.</p>`;
  const text = [
    preview ? 'SAMPLE PREVIEW — NOT A REAL ORDER' : '',
    'THE REALITY MANUAL',
    '',
    'YOUR BOOK IS ON ITS WAY',
    '',
    'The making is complete. Your copy has been printed, bound and finished, and has now left the printer.',
    '',
    `Order: ${orderNumber}`,
    `Carrier: ${carrier}`,
    trackingNumber ? `Tracking: ${trackingNumber}` : '',
    trackingUrl ? `Track your shipment: ${trackingUrl}` : '',
    'Delivering to:',
    ...address,
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
      title: 'Your book is on its way.',
      body,
      details: detailsTable(rows),
      callout: 'A book made to last a lifetime is almost in your hands.',
      button: trackingUrl ? { label: 'Track your shipment', href: trackingUrl } : null,
    }),
    text,
  };
}

function orderRefundedEmail(order, { preview = false } = {}) {
  const orderNumber = order.display_order_id || order.id;
  const total = `${formatMoney(order.total_price_cents, order.currency)} ${String(order.currency || 'usd').toUpperCase()}`;
  const subject = `${preview ? '[PREVIEW] ' : ''}An update concerning your Reality Manual order`;
  const body = `
    <p style="margin:0 0 18px;">We’re sorry, ${escapeHtml(firstName(order.customer_name))}, but our printer was unable to accept your order after several attempts.</p>
    <p style="margin:0;">Rather than leave you waiting, we have issued a full refund to your original payment method.</p>`;
  const callout = 'The refund has left our system. Your bank may take several working days to display it on your statement. You are welcome to place the order again at any time.';
  const text = [
    preview ? 'SAMPLE PREVIEW — NOT A REAL ORDER' : '',
    'THE REALITY MANUAL',
    '',
    'WE COULDN’T COMPLETE YOUR ORDER',
    '',
    `We’re sorry, ${firstName(order.customer_name)}, but our printer was unable to accept your order after several attempts.`,
    'Rather than leave you waiting, we have issued a full refund to your original payment method.',
    '',
    `Order: ${orderNumber}`,
    `Refund: ${total}`,
    '',
    'The refund has left our system. Your bank may take several working days to display it on your statement. You are welcome to place the order again at any time.',
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
      title: 'We couldn’t complete your order.',
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

module.exports = {
  escapeHtml,
  orderConfirmedEmail,
  orderShippedEmail,
  orderRefundedEmail,
};
