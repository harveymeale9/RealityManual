// BookVault has no sandbox or idempotency key. Every POST is preceded by a
// DocRef lookup, and an ambiguous response is never followed by a blind POST.
async function request(env, method, path, body, fetcher = fetch) {
  if (!env.BOOKVAULT_API_KEY) throw new Error('BOOKVAULT_API_KEY is not configured.');
  const response = await fetcher(`${env.BOOKVAULT_API_BASE_URL || 'https://api.bookvault.app/v3'}${path}`, {
    method,
    headers: { authorization: `basic ${env.BOOKVAULT_API_KEY}`, 'content-type': 'application/json', accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) {
    const error = new Error(data?.Message || (typeof data === 'string' ? data : null) || `BookVault ${method} ${path} returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export function orderPayload(order, isbn) {
  if (!isbn) throw new Error('BOOKVAULT_TITLE_ISBN is not configured.');
  const payload = {
    Status: 'Active', DocRef: order.id, CustRef: order.id, PartnerID: 1,
    ProductionLevel: 'Standard',
    DispatchRequest: order.shipping_service_id
      ? { RequestedService: 'Specified', RequestedServID: [Number(order.shipping_service_id)] }
      : { RequestedService: 'CheapestTracked' },
    Notifications: { NotifyCustomer: false },
    Address: {
      Addressee: order.customer_name, Address1: order.street1, Address2: order.street2 || '',
      Town: order.city, County: order.state || order.city, Postcode: order.postal_code,
      Country: { ISO_Code: order.country }, TelNumber: order.phone, Email: order.email,
    },
    OrderLines: [{ LineNumber: 1, ISBN: isbn, Quantity: Number(order.quantity) }],
  };
  if (String(order.country).toUpperCase() !== 'GB') {
    payload.CustomsDeclaration = { UseOrderValue: true, HSCode: '49019900', UseIOSS: false, IncoTerms: 'DDU' };
  }
  return payload;
}

export async function getOrder(env, podRef, fetcher = fetch) {
  return request(env, 'GET', `/Order?PodRef=${encodeURIComponent(podRef)}`, undefined, fetcher);
}

export async function findOrderByDocRef(env, docRef, fetcher = fetch) {
  try { return await request(env, 'GET', `/Order?DocRef=${encodeURIComponent(docRef)}`, undefined, fetcher); }
  catch (error) {
    if (error.status === 404 || /not found/i.test(error.message)) return null;
    throw error;
  }
}

export function isScheduledPaymentPending(order) {
  return String(order?.Status || '').toLowerCase() === 'batchpayment' &&
    String(order?.Progress?.Status || '').toLowerCase() === 'created';
}

export function assertActive(order) {
  if (order?.PodRef && String(order.Status || '').toLowerCase() === 'active') return order;
  const error = new Error(`BookVault order is not active (status: ${order?.Status || 'unknown'}).`);
  if (order?.PodRef) error.podRef = order.PodRef;
  error.pendingPayment = isScheduledPaymentPending(order);
  throw error;
}

export async function submitOrder(env, order, fetcher = fetch) {
  const existing = order.bookvault_order_id
    ? await getOrder(env, order.bookvault_order_id, fetcher)
    : await findOrderByDocRef(env, order.id, fetcher);
  if (existing?.PodRef) return assertActive(existing);
  const created = await request(env, 'POST', '/Order?payMethod=Saved', orderPayload(order, env.BOOKVAULT_TITLE_ISBN), fetcher);
  if (!created?.PodRef || created.CriticalError ||
      !['active', 'batchpayment'].includes(String(created.Status || '').toLowerCase())) {
    const error = new Error('BookVault did not accept the order.');
    if (created?.PodRef) error.podRef = created.PodRef;
    throw error;
  }
  try { return assertActive(await getOrder(env, created.PodRef, fetcher)); }
  catch (error) {
    error.podRef = created.PodRef;
    if (error.status === 404 && isScheduledPaymentPending(created)) error.pendingPayment = true;
    throw error;
  }
}

export async function cancelUnpaidDraft(env, docRef, podRef, fetcher = fetch) {
  let order = null;
  if (podRef) {
    try { order = await getOrder(env, podRef, fetcher); }
    catch (error) { if (error.status !== 404) throw error; }
  }
  if (!order) order = await findOrderByDocRef(env, docRef, fetcher);
  if (!order || String(order.Status).toLowerCase() === 'deleted') return true;
  if (order.DocRef && order.DocRef !== docRef) throw new Error('BookVault reference mismatch; refund requires manual review.');
  if (!isScheduledPaymentPending(order)) throw new Error('BookVault order is not a verified unpaid draft; refund requires manual review.');
  await request(env, 'DELETE', `/Order?PodRef=${encodeURIComponent(order.PodRef)}`, undefined, fetcher);
  try {
    const after = await getOrder(env, order.PodRef, fetcher);
    if (String(after?.Status).toLowerCase() !== 'deleted') throw new Error('BookVault draft still exists after cancellation.');
  } catch (error) { if (error.status !== 404) throw error; }
  const byReference = await findOrderByDocRef(env, docRef, fetcher);
  if (byReference && String(byReference.Status).toLowerCase() !== 'deleted') throw new Error('BookVault draft still exists after cancellation.');
  return true;
}
