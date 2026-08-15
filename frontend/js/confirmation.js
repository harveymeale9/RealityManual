(function () {
  const API_BASE_URL = window.RM_CONFIG.API_BASE_URL;
  const POLL_INTERVAL_MS = 2000;
  const MAX_POLLS = 150; // ~5 minutes

  const spinner = document.getElementById('spinner');
  const statusTitle = document.getElementById('status-title');
  const statusMessage = document.getElementById('status-message');
  const orderMeta = document.getElementById('order-meta');
  const actionArea = document.getElementById('action-area');

  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('order');

  let pollCount = 0;
  let timerId = null;

  if (!orderId) {
    showTerminalState({
      title: 'We could not find your order',
      message: 'No order was specified. If you just completed a payment, check your email for confirmation, or contact us.',
      isError: true,
    });
    return;
  }

  poll();

  async function poll() {
    pollCount += 1;

    try {
      const res = await fetch(`${API_BASE_URL}/api/orders/${encodeURIComponent(orderId)}/status`);

      if (res.status === 404) {
        showTerminalState({
          title: 'We could not find your order',
          message: 'This order link appears to be invalid. If you believe this is a mistake, please contact us.',
          isError: true,
        });
        return;
      }

      if (!res.ok) throw new Error('status_check_failed');

      const data = await res.json();
      render(data);
    } catch (err) {
      // Transient network errors shouldn't stop polling — just try again.
    }

    if (pollCount >= MAX_POLLS) {
      showTerminalState({
        title: "This is taking longer than expected",
        message: "We're still confirming your payment. Please refresh this page in a minute, or contact us if this continues.",
        isError: false,
      });
      return;
    }

    timerId = setTimeout(poll, POLL_INTERVAL_MS);
  }

  function render(order) {
    if (order.order_status === 'PAYMENT_RECEIVED') {
      clearTimeout(timerId);
      spinner.style.display = 'none';
      statusTitle.textContent = 'Payment confirmed';
      statusMessage.textContent = `Thank you for ordering ${order.product_name}. Your order is being prepared for fulfillment — we'll follow up by email once it ships.`;
      orderMeta.textContent = `Order ${order.order_id} · ${order.product_description} · ${formatCents(order.total_price_cents, order.currency)}`;
      return;
    }

    if (order.order_status === 'FAILED') {
      showTerminalState({
        title: "We're sorry, your payment did not go through",
        message: 'No charge was completed. Please try placing your order again.',
        isError: true,
        showRetry: true,
      });
      return;
    }

    // PAYMENT_PENDING — keep polling, waiting state stays as-is.
    orderMeta.textContent = `Order ${order.order_id}`;
  }

  function showTerminalState({ title, message, isError, showRetry }) {
    clearTimeout(timerId);
    spinner.style.display = 'none';
    statusTitle.textContent = title;
    statusTitle.style.color = isError ? 'var(--error)' : 'var(--ink)';
    statusMessage.textContent = message;

    if (showRetry) {
      const link = document.createElement('a');
      link.className = 'btn';
      link.href = 'checkout.html';
      link.textContent = 'Try again';
      actionArea.appendChild(link);
    }
  }

  function formatCents(cents, currency) {
    return `$${(cents / 100).toFixed(2)} ${String(currency || 'usd').toUpperCase()}`;
  }
})();
