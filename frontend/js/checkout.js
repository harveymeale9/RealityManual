(function () {
  const API_BASE_URL = window.RM_CONFIG.API_BASE_URL;
  const BOOK_PRICE_CENTS = 6500;

  const form = document.getElementById('checkout-form');
  const submitButton = document.getElementById('submit-button');
  const errorBanner = document.getElementById('form-error-banner');
  const countrySelect = document.getElementById('country_code');
  const postalInput = document.getElementById('postal_code');
  const quantityInput = document.getElementById('quantity');
  const voucherInput = document.getElementById('voucher_code');
  const voucherDiscountRow = document.getElementById('voucher-discount-row');
  const summaryVoucherDiscount = document.getElementById('summary-voucher-discount');
  const qtyDecreaseButton = document.getElementById('qty-decrease');
  const qtyIncreaseButton = document.getElementById('qty-increase');
  const summaryBookPrice = document.getElementById('summary-book-price');
  const summaryShipping = document.getElementById('summary-shipping');
  const shippingOriginNote = document.getElementById('shipping-origin-note');
  const summaryTotal = document.getElementById('summary-total');
  const summaryHint = document.getElementById('summary-hint');
  const quantityWarningBanner = document.getElementById('quantity-warning-banner');
  const qtyBooks = document.getElementById('qty-books');
  const QTY_ICON_MAX = 5; // beyond this many copies, show a "+N" badge instead of one icon per copy

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  form.email.addEventListener('input', () => {
    // Email only affects pricing when a voucher is present. Without one,
    // changing/autofilling email must not invalidate a valid shipping quote.
    if (voucherInput.value.trim()) { lastQuote = null; clearTimeout(postalDebounceTimer); postalDebounceTimer = setTimeout(updateShipping, 500); }
  });
  const PHONE_REGEX = /^\+?[\d\s\-.()/]{6,35}$/;
  function canadianPostalCode(value) {
    const compact = String(value || '').toUpperCase().replace(/[\s-]/g, '');
    return /^[A-Z][0-9][A-Z][0-9][A-Z][0-9]$/.test(compact)
      ? `${compact.slice(0, 3)} ${compact.slice(3)}` : null;
  }
  // Field limits mirror BookVault's OrderAddress schema - see
  // backend/src/lib/validation.js and CLAUDE.md §64 for the source.
  const NAME_MAX = 200;
  const STREET1_MAX = 200;
  const STREET2_MAX = 250;
  const CITY_MAX = 99;
  const STATE_MAX = 200;
  const POSTAL_MAX = 99;
  const PHONE_MAX = 35;
  // Not a BookVault limit - a sane cap, matching backend/src/lib/validation.js.
  const QUANTITY_MIN = 1;
  const QUANTITY_MAX = 20;
  const SHIPPING_ORIGIN_NOTE_THRESHOLD_CENTS = 1200;

  let currentTotalCents = BOOK_PRICE_CENTS;
  let lastQuote = null;
  let shippingRequestSeq = 0;
  let postalDebounceTimer = null;
  let checkoutStartedTracked = false;
  let stripe = null;
  let elements = null;
  let checkoutPaused = false;
  let lastShippingError = false;

  const ctaSource = new URLSearchParams(window.location.search).get('cta_source') || '';
  const checkoutArrivalEvent = {
    header: 'checkout_arrival_header',
    primary_offer: 'checkout_arrival_primary',
    final_cta: 'checkout_arrival_final'
  }[ctaSource];
  RMAnalytics.track('checkout_view');
  if (checkoutArrivalEvent) RMAnalytics.track(checkoutArrivalEvent);
  if (window.RMMarketing) {
    const marketingCheckout = {
      value: BOOK_PRICE_CENTS / 100,
      currency: 'USD',
      content_ids: ['reality-manual-hardcover'],
      content_type: 'product'
    };
    if (checkoutArrivalEvent) marketingCheckout.cta_source = ctaSource;
    RMMarketing.track('InitiateCheckout', marketingCheckout);
  }
  // Fired once, on the first time the shopper actually touches the form -
  // distinct from checkout_view (just landing on the page) per CLAUDE.md §31.
  form.addEventListener('input', function trackCheckoutStarted() {
    if (checkoutStartedTracked) return;
    checkoutStartedTracked = true;
    RMAnalytics.track('checkout_started');
  }, { once: true });

  populateCountrySelect();
  initializeStripe();

  async function initializeStripe() {
    let setupStage = 'availability_request';
    try {
      const availability = await fetch(`${API_BASE_URL}/api/checkout/availability`, { cache: 'no-store' });
      setupStage = 'availability_response';
      if (!availability.ok) throw new Error('checkout_availability_unavailable');
      checkoutPaused = !(await availability.json()).available;
      if (checkoutPaused) {
        showFormError('Orders are temporarily unavailable while we resolve a printer issue. No payment has been taken. Please check back later.', 'checkout_unavailable');
        submitButton.disabled = true;
        return;
      }
      setupStage = 'config_request';
      const response = await fetch(`${API_BASE_URL}/api/config/stripe`);
      setupStage = 'config_response';
      if (!response.ok) throw new Error('stripe_config_unavailable');
      const { publishable_key: publishableKey } = await response.json();
      if (!publishableKey || !publishableKey.startsWith('pk_')) throw new Error('stripe_config_invalid');

      setupStage = 'stripe_setup';
      stripe = Stripe(publishableKey);
      elements = stripe.elements({
        mode: 'payment',
        amount: BOOK_PRICE_CENTS,
        currency: 'usd',
        // Matches the server's payment_method_types. `card` gives customers
        // ordinary cards plus eligible Apple Pay / Google Pay wallets; `link`
        // adds Link and its eligible Instant Bank Payments funding source.
        // We intentionally do not expose the rest of the Dashboard catalogue.
        paymentMethodTypes: ['card', 'link'],
        appearance: {
          theme: 'night',
          variables: {
            colorPrimary: '#c9a24d',
            colorBackground: '#14100b',
            colorText: '#ece4d5',
            colorTextSecondary: '#a2957e',
            colorDanger: '#e2685f',
            fontFamily: 'Archivo, system-ui, sans-serif',
            borderRadius: '0px',
          },
          rules: {
            '.Input': { border: '1px solid #2a2318', boxShadow: 'none' },
            '.Input:focus': { border: '1px solid #c9a24d', boxShadow: 'none' },
          },
        },
      });
      const paymentElement = elements.create('payment');
      setupStage = 'element_mount';
      paymentElement.mount('#payment-element');
      paymentElement.on('ready', () => {
        submitButton.disabled = checkoutPaused;
      });
    } catch (err) {
      showFormError('Secure payment options could not be loaded. Please refresh the page and try again.', `payment_config_error:${setupStage}`);
    }
  }

  function populateCountrySelect() {
    const priorityGroup = document.createElement('optgroup');
    priorityGroup.label = 'Ships with a calculated rate';
    window.RM_PRIORITY_COUNTRIES.forEach(([code, name]) => {
      priorityGroup.appendChild(new Option(name, code));
    });

    const otherGroup = document.createElement('optgroup');
    otherGroup.label = 'Other countries (Rest of World shipping rate)';
    window.RM_OTHER_COUNTRIES.forEach(([code, name]) => {
      otherGroup.appendChild(new Option(name, code));
    });

    countrySelect.appendChild(new Option('Select a country', '', true, true));
    countrySelect.options[0].disabled = true;
    countrySelect.appendChild(priorityGroup);
    countrySelect.appendChild(otherGroup);

    countrySelect.addEventListener('change', updateShipping);

    // Shipping is quoted live against BookVault for the exact country +
    // postcode + quantity (see backend/src/services/bookvaultService.js -
    // quantity matters here because BookVault's quote is weight-based), so
    // a postcode edit needs to re-trigger it too, not just a country
    // change. Debounced so we're not firing a request per keystroke.
    postalInput.addEventListener('input', () => {
      lastQuote = null;
      shippingOriginNote.hidden = true;
      clearTimeout(postalDebounceTimer);
      postalDebounceTimer = setTimeout(updateShipping, 500);
    });
    postalInput.addEventListener('change', () => {
      // Some mobile autofill paths emit change/blur but not input.
      if (lastQuote?.postalCode === postalInput.value.trim() &&
          lastQuote.countryCode === countrySelect.value) return;
      clearTimeout(postalDebounceTimer);
      updateShipping();
    });
    postalInput.addEventListener('blur', () => {
      if (countrySelect.value !== 'CA') return;
      const formatted = canadianPostalCode(postalInput.value);
      if (formatted && postalInput.value !== formatted) {
        postalInput.value = formatted;
        updateShipping();
      }
    });

    qtyDecreaseButton.addEventListener('click', () => setQuantity(getQuantity() - 1));
    qtyIncreaseButton.addEventListener('click', () => setQuantity(getQuantity() + 1));
    quantityInput.addEventListener('change', () => setQuantity(getQuantity()));
    voucherInput.addEventListener('change', updateShipping);
    voucherInput.addEventListener('input', () => {
      lastQuote = null;
      clearTimeout(postalDebounceTimer);
      postalDebounceTimer = setTimeout(updateShipping, 500);
    });

    renderQtyBooks(getQuantity());
  }

  // One small book icon per copy, up to QTY_ICON_MAX - beyond that a "+N"
  // badge instead of letting the row grow without bound.
  function renderQtyBooks(quantity) {
    qtyBooks.innerHTML = '';
    const iconCount = Math.min(quantity, QTY_ICON_MAX);

    for (let i = 0; i < iconCount; i += 1) {
      const icon = document.createElement('img');
      icon.className = 'qty-book-icon';
      icon.src = 'img/placeholder/reality-manual-edition-thumbnail.svg';
      icon.alt = '';
      icon.setAttribute('aria-hidden', 'true');
      qtyBooks.appendChild(icon);
    }

    if (quantity > QTY_ICON_MAX) {
      const more = document.createElement('span');
      more.className = 'qty-book-more';
      more.textContent = `+${quantity - QTY_ICON_MAX}`;
      qtyBooks.appendChild(more);
    }
  }

  function getQuantity() {
    const n = Math.round(Number(quantityInput.value));
    if (!Number.isFinite(n)) return QUANTITY_MIN;
    return Math.min(QUANTITY_MAX, Math.max(QUANTITY_MIN, n));
  }

  function setQuantity(n) {
    const clamped = Math.min(QUANTITY_MAX, Math.max(QUANTITY_MIN, Math.round(n) || QUANTITY_MIN));
    quantityInput.value = clamped;
    lastQuote = null;
    voucherDiscountRow.hidden = true;
    // Immediate client-side estimate - updateShipping() below then confirms
    // the real (server-authoritative) number once BookVault responds,
    // including whether this quantity triggers the upgraded-shipping
    // warning below.
    summaryBookPrice.textContent = formatCents(BOOK_PRICE_CENTS * clamped);
    quantityWarningBanner.hidden = true;
    renderQtyBooks(clamped);
    updateShipping();
  }

  function trackQuoteState(code) {
    RMAnalytics.track('checkout_quote_state', {
      country: /^[A-Z]{2}$/.test(countrySelect.value) ? countrySelect.value : '',
      error_code: code,
    });
  }

  async function updateShipping() {
    const requestId = ++shippingRequestSeq;
    lastQuote = null;
    lastShippingError = false;
    shippingOriginNote.hidden = true;
    voucherDiscountRow.hidden = true;
    const countryCode = countrySelect.value;
    const postalCode = postalInput.value.trim();
    const quantity = getQuantity();
    const email = form.email.value.trim();
    const voucherCode = voucherInput.value.trim().toUpperCase();
    const inputsChanged = () => countryCode !== countrySelect.value ||
      postalCode !== postalInput.value.trim() || quantity !== getQuantity() ||
      (voucherCode && email !== form.email.value.trim()) ||
      voucherCode !== voucherInput.value.trim().toUpperCase();
    const retryChangedQuote = () => {
      // Mobile autofill may change fields without dispatching `input`.
      trackQuoteState('stale_retry');
      summaryShipping.textContent = 'Updating…';
      clearTimeout(postalDebounceTimer);
      postalDebounceTimer = setTimeout(updateShipping, 300);
    };
    if (!countryCode || !postalCode) {
      summaryShipping.textContent = 'Enter address';
      summaryTotal.textContent = '-';
      trackQuoteState('needs_postcode');
      return;
    }
    summaryShipping.textContent = 'Calculating…';
    summaryTotal.textContent = '-';
    trackQuoteState('requested');

    let quoteStatus = null;
    try {
      const res = await fetch(`${API_BASE_URL}/api/shipping/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ country_code: countryCode, postal_code: postalCode, quantity,
          email, voucher_code: voucherCode }),
      });
      quoteStatus = res.status;
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'We could not calculate shipping for that address.');

      // A slower request that resolves after a newer one has already
      // landed would otherwise clobber it with stale numbers.
      if (requestId !== shippingRequestSeq) return;
      if (inputsChanged()) return retryChangedQuote();
      applyQuote(data, { countryCode, postalCode, quantity, email, voucherCode });
      trackQuoteState('applied');
      clearFormError();
    } catch (err) {
      if (requestId !== shippingRequestSeq) return;
      if (inputsChanged()) return retryChangedQuote();
      lastShippingError = true;
      trackQuoteState('failed');
      summaryShipping.textContent = 'Unavailable';
      summaryTotal.textContent = '-';
      quantityWarningBanner.hidden = true;
      voucherDiscountRow.hidden = true;
      showFormError(err.message || 'We could not calculate shipping for that address. Please check the country and postal code.',
        quoteStatus && quoteStatus < 500 ? 'shipping_quote_rejected' : 'shipping_quote_failed');
    }
  }

  function applyQuote(data, address) {
    currentTotalCents = data.total_price_cents;
    lastQuote = { ...address, totalPriceCents: data.total_price_cents, voucherInvalid: Boolean(data.voucher_invalid) };
    const voucherField = form.querySelector('[data-field="voucher_code"]');
    if (voucherField) {
      voucherField.classList.remove('has-error');
      voucherField.querySelector('.field-error').textContent = '';
    }
    if (data.voucher_invalid) {
      setFieldError('voucher_code', 'This code was not applied. You can correct it or continue at the full price shown below.');
    }
    summaryBookPrice.textContent = formatCents(data.book_subtotal_cents);
    voucherDiscountRow.hidden = !data.voucher_discount_cents;
    summaryVoucherDiscount.textContent = '−' + formatCents(data.voucher_discount_cents || 0);
    summaryShipping.textContent = formatCents(data.shipping_price_cents);
    shippingOriginNote.hidden = data.shipping_price_cents <= SHIPPING_ORIGIN_NOTE_THRESHOLD_CENTS;
    summaryTotal.textContent = formatCents(data.total_price_cents);
    summaryHint.style.display = 'none';
    if (data.shipping_upgraded) {
      quantityWarningBanner.textContent = `Ordering ${address.quantity} copies no longer qualifies for the cheapest shipping service. A pricier, faster courier is used instead, which is why shipping costs more per copy than a smaller order.`;
      quantityWarningBanner.hidden = false;
    } else {
      quantityWarningBanner.hidden = true;
    }
    submitButton.textContent = `Pay ${formatCents(data.total_price_cents)}`;
    if (elements) elements.update({ amount: currentTotalCents });
  }

  function quoteMatches(values) {
    return lastQuote && lastQuote.countryCode === values.country_code &&
      lastQuote.postalCode === values.postal_code.trim() &&
      lastQuote.quantity === values.quantity &&
      (!values.voucher_code || lastQuote.email === values.email.trim()) &&
      lastQuote.voucherCode === values.voucher_code;
  }

  function formatCents(cents) {
    return `$${(cents / 100).toFixed(2)}`;
  }

  function showFormError(message, code, orderId = null) {
    errorBanner.textContent = message;
    errorBanner.classList.add('visible');
    // Never send names, emails, phone numbers, addresses, postcodes, voucher
    // codes, or provider-supplied error text to form telemetry.
    if (code) {
      const event = {
        country: /^[A-Z]{2}$/.test(countrySelect.value) ? countrySelect.value : '',
        error_code: code,
      };
      if (code.startsWith('payment_uncertain:') && orderId) event.order_id = orderId;
      RMAnalytics.track('checkout_form_error', event);
    }
  }

  function showPaymentUncertain(confirmationUrl, orderId, reason) {
    showFormError('We cannot confirm your payment yet. Please do not pay again. Check your order status here, and watch your email for an update.', `payment_uncertain:${reason}`, orderId);
    const link = document.createElement('a');
    link.href = confirmationUrl;
    link.textContent = 'Check order status';
    link.style.cssText = 'display:block;margin-top:0.5rem;text-decoration:underline';
    errorBanner.appendChild(link);
    submitButton.disabled = true;
    submitButton.textContent = 'Check order status above';
  }

  function withTimeout(promise, milliseconds) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('payment_step_timeout')), milliseconds); }),
    ]).finally(() => clearTimeout(timer));
  }

  function clearFormError() {
    errorBanner.textContent = '';
    errorBanner.classList.remove('visible');
  }

  function clearFieldErrors() {
    document.querySelectorAll('.field').forEach((el) => {
      el.classList.remove('has-error');
      const errEl = el.querySelector('.field-error');
      if (errEl) errEl.textContent = '';
    });
  }

  function setFieldError(fieldName, message) {
    const el = form.querySelector(`[data-field="${fieldName}"]`);
    if (!el) return;
    el.classList.add('has-error');
    el.querySelector('.field-error').textContent = message;
  }

  function validateClientSide(values) {
    const errors = {};

    if (!values.customer_name.trim()) errors.customer_name = 'Full name is required.';
    else if (values.customer_name.length > NAME_MAX) errors.customer_name = `Must be ${NAME_MAX} characters or fewer.`;

    if (!EMAIL_REGEX.test(values.email.trim())) errors.email = 'A valid email address is required.';

    if (!PHONE_REGEX.test(values.phone.trim()) || values.phone.trim().length > PHONE_MAX) {
      errors.phone = 'A valid phone number is required.';
    }

    if (!values.country_code) errors.country_code = 'Please select a country.';

    if (!values.street1.trim()) errors.street1 = 'Street address is required.';
    else if (values.street1.length > STREET1_MAX) errors.street1 = `Must be ${STREET1_MAX} characters or fewer.`;

    if (values.street2 && values.street2.length > STREET2_MAX) errors.street2 = `Must be ${STREET2_MAX} characters or fewer.`;

    if (!values.city.trim()) errors.city = 'City is required.';
    else if (values.city.length > CITY_MAX) errors.city = `Must be ${CITY_MAX} characters or fewer.`;

    if (values.state && values.state.length > STATE_MAX) errors.state = `Must be ${STATE_MAX} characters or fewer.`;

    if (!values.postal_code.trim()) errors.postal_code = 'Postal/ZIP code is required.';
    else if (values.postal_code.length > POSTAL_MAX) errors.postal_code = `Must be ${POSTAL_MAX} characters or fewer.`;
    else if (values.country_code === 'CA' && !canadianPostalCode(values.postal_code)) {
      errors.postal_code = 'Enter a Canadian postal code in the format A1A 1A1.';
    }

    return errors;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (checkoutPaused) return;
    clearFormError();
    clearFieldErrors();

    if (countrySelect.value === 'CA') {
      const formatted = canadianPostalCode(postalInput.value);
      if (formatted) postalInput.value = formatted;
    }

    const values = {
      customer_name: form.customer_name.value,
      email: form.email.value,
      phone: form.phone.value,
      country_code: form.country_code.value,
      street1: form.street1.value,
      street2: form.street2.value,
      city: form.city.value,
      state: form.state.value,
      postal_code: form.postal_code.value,
      quantity: getQuantity(),
      voucher_code: voucherInput.value.trim().toUpperCase(),
    };

    const clientErrors = validateClientSide(values);
    if (Object.keys(clientErrors).length > 0) {
      Object.entries(clientErrors).forEach(([field, message]) => setFieldError(field, message));
      showFormError('Please correct the highlighted fields.', 'field_validation');
      return;
    }

    if (!quoteMatches(values)) await updateShipping();
    if (!quoteMatches(values)) {
      if (!lastShippingError) showFormError('We could not confirm the current shipping price. Please try again.', 'shipping_quote_missing');
      return;
    }
    if (lastQuote.voucherInvalid) {
      setFieldError('voucher_code', 'This code was not applied. You can correct it or continue at the full price shown below.');
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Processing…';

    let submitError;
    try {
      ({ error: submitError } = await withTimeout(elements.submit(), 30000));
    } catch {
      showFormError('Secure payment did not respond. No payment has been started. Please refresh this page and try again.', 'payment_element_timeout');
      submitButton.disabled = false;
      submitButton.textContent = `Pay ${formatCents(currentTotalCents)}`;
      return;
    }
    if (submitError) {
      showFormError(submitError.message || 'Please check your payment details.', 'payment_element_error');
      submitButton.disabled = false;
      submitButton.textContent = `Pay ${formatCents(currentTotalCents)}`;
      return;
    }

    let orderResponse;
    try {
      const res = await fetch(`${API_BASE_URL}/api/checkout/create-payment-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ ...values, voucher_code: lastQuote.voucherInvalid ? '' : values.voucher_code,
          quoted_total_price_cents: lastQuote.totalPriceCents,
          attribution: RMAnalytics.getCheckoutAttribution() }),
      });
      orderResponse = await res.json();

      if (!res.ok) {
        if (res.status === 409 && orderResponse.error === 'shipping_quote_changed') {
          if (values.country_code === countrySelect.value &&
              values.postal_code.trim() === postalInput.value.trim() &&
              values.quantity === getQuantity()) {
            applyQuote({ ...orderResponse, voucher_invalid: lastQuote.voucherInvalid }, {
              countryCode: values.country_code,
              postalCode: values.postal_code.trim(),
              quantity: values.quantity,
              email: values.email.trim(), voucherCode: values.voucher_code,
            });
          } else {
            await updateShipping();
          }
        }
        if (orderResponse.fields) {
          Object.entries(orderResponse.fields).forEach(([field, message]) => setFieldError(field, message));
        }
        showFormError(orderResponse.message || 'We could not process your order. Please review your details.',
          res.status === 409 ? 'checkout_quote_changed' : res.status >= 500 ? 'checkout_server_error' : 'checkout_rejected');
        submitButton.disabled = false;
        submitButton.textContent = `Pay ${formatCents(currentTotalCents)}`;
        return;
      }
      if (orderResponse.total_price_cents !== currentTotalCents || !quoteMatches(values)) {
        showFormError('Your shipping details changed during checkout. Please review the total and try again.', 'checkout_quote_changed');
        submitButton.disabled = false;
        submitButton.textContent = `Pay ${formatCents(currentTotalCents)}`;
        return;
      }
    } catch (err) {
      showFormError('We could not reach the server. Please check your connection and try again.', 'checkout_server_error');
      submitButton.disabled = false;
      submitButton.textContent = `Pay ${formatCents(currentTotalCents)}`;
      return;
    }

    const confirmationUrl = new URL(
      `confirmation.html?order=${orderResponse.order_id}`,
      window.location.href
    ).toString();

    RMAnalytics.track('payment_submitted', { order_id: orderResponse.order_id });

    let confirmError;
    try {
      ({ error: confirmError } = await withTimeout(stripe.confirmPayment({
        elements,
        clientSecret: orderResponse.client_secret,
        confirmParams: { return_url: confirmationUrl },
      }), 35000));
    } catch (error) {
      showPaymentUncertain(confirmationUrl, orderResponse.order_id,
        error?.message === 'payment_step_timeout' ? 'confirm_timeout' : 'confirm_exception');
      return;
    }

    if (confirmError) {
      if (!['card_error', 'validation_error'].includes(confirmError.type)) {
        showPaymentUncertain(confirmationUrl, orderResponse.order_id, 'confirm_non_card_error');
        return;
      }
      showFormError(confirmError.message || 'Your payment could not be completed. Please try again.', 'payment_declined');
      submitButton.disabled = false;
      submitButton.textContent = `Pay ${formatCents(currentTotalCents)}`;
    }
    // On success, Stripe redirects the browser to confirmationUrl itself.
  });
})();
