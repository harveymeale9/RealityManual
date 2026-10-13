(function () {
  const API_BASE_URL = window.RM_CONFIG.API_BASE_URL;
  const POLL_INTERVAL_MS = 2000;
  const MAX_POLLS = 150; // ~5 minutes

  const spinner = document.getElementById('spinner');
  const statusEyebrow = document.getElementById('status-eyebrow');
  const statusTitle = document.getElementById('status-title');
  const statusMessage = document.getElementById('status-message');
  const actionArea = document.getElementById('action-area');

  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('order');
  const isDemo = document.body.dataset.orderDemo === 'true';

  let pollCount = 0;
  let timerId = null;
  let trackedEvent = null;

  // Guards against double-firing if render() were ever called again after
  // reaching a terminal state (polling stops on both paths below, but this
  // is cheap insurance against a future change reintroducing a re-render).
  function trackOnce(eventName, orderIdValue) {
    if (trackedEvent === eventName) return;
    trackedEvent = eventName;
    RMAnalytics.track(eventName, { order_id: orderIdValue });
  }

  if (isDemo) {
    runDemo();
    return;
  }

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
      const terminal = render(data);
      if (terminal) return;
    } catch (err) {
      // Transient network errors shouldn't stop polling - just try again.
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
    if (['BOOKVAULT_ACCEPTED', 'SHIPPED'].includes(order.order_status)) {
      clearTimeout(timerId);
      spinner.style.display = 'none';
      statusEyebrow.textContent = '✓ Order confirmed';
      statusEyebrow.classList.add('is-success');
      statusTitle.textContent = 'Our Expert Bookbinders Are Rolling Up Their Sleeves!';
      statusMessage.textContent = "Thank you! Your payment has been received and your order has been confirmed. Please bear in mind that it can take up to 15 business days for us to print your Reality Manual. We'll send you another email as soon as we ship your order!";
      if (!isDemo) trackOnce('order_complete', order.order_id);
      if (!isDemo && window.RMMarketing) {
        RMMarketing.track('Purchase', {
          value: order.total_price_cents / 100,
          currency: String(order.currency || 'usd').toUpperCase(),
          content_ids: ['reality-manual-hardcover'],
          content_type: 'product',
          num_items: order.quantity || 1,
          transaction_id: order.order_id
        }, order.order_id);
      }
      return true;
    }

    if (['PAYMENT_RECEIVED', 'FULFILLMENT_RETRY'].includes(order.order_status)) {
      return false;
    }

    if (order.order_status === 'FAILED') {
      trackOnce('order_failed', order.order_id);
      showTerminalState({
        title: "We're sorry, your payment did not go through",
        message: 'No charge was completed. Please try placing your order again.',
        isError: true,
        showRetry: true,
      });
      return true;
    }

    if (order.order_status === 'PAYMENT_PROCESSING') {
      return false;
    }

    return false;
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

  function runDemo() {
    const demoDurationSeconds = 8;
    let secondsRemaining = demoDurationSeconds;

    const countdown = document.createElement('p');
    countdown.className = 'confirmation-demo-timer';
    countdown.setAttribute('role', 'timer');
    countdown.setAttribute('aria-live', 'off');
    statusMessage.insertAdjacentElement('afterend', countdown);

    function updateCountdown() {
      countdown.textContent = `Demo: order confirmation in ${secondsRemaining} second${secondsRemaining === 1 ? '' : 's'}`;
    }

    function showConfirmingState() {
      clearTimeout(timerId);
      actionArea.replaceChildren();
      spinner.style.display = '';
      statusEyebrow.textContent = 'Order in progress';
      statusEyebrow.classList.remove('is-success');
      statusTitle.textContent = "We're Confirming Your Order";
      statusTitle.style.color = '';
      statusMessage.textContent = "We're confirming your payment and placing your order with our expert bookbinders now. This usually only takes a moment.";
      countdown.hidden = false;
      secondsRemaining = demoDurationSeconds;
      updateCountdown();
      replayStateAnimation();

      timerId = setInterval(() => {
        secondsRemaining -= 1;
        updateCountdown();

        if (secondsRemaining <= 0) {
          clearInterval(timerId);
          countdown.hidden = true;
          render({
            order_status: 'BOOKVAULT_ACCEPTED',
            order_id: 'test-order-demo',
            total_price_cents: 0,
            currency: 'usd',
            quantity: 1,
          });
          replayStateAnimation();

          const replay = document.createElement('button');
          replay.type = 'button';
          replay.className = 'confirmation-demo-replay';
          replay.textContent = 'Replay demo';
          replay.addEventListener('click', showConfirmingState);
          actionArea.appendChild(replay);
        }
      }, 1000);
    }

    function replayStateAnimation() {
      const content = document.querySelector('.confirmation-content');
      content.classList.remove('confirmation-state-enter');
      void content.offsetWidth;
      content.classList.add('confirmation-state-enter');
    }

    showConfirmingState();
  }

})();
