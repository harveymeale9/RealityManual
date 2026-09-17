(function () {
  const API_BASE_URL = window.RM_CONFIG.API_BASE_URL;
  const BOOK_PRICE_CENTS = 6500;

  const form = document.getElementById('checkout-form');
  const submitButton = document.getElementById('submit-button');
  const errorBanner = document.getElementById('form-error-banner');
  const countrySelect = document.getElementById('country_code');
  const postalInput = document.getElementById('postal_code');
  const quantityInput = document.getElementById('quantity');
  const qtyDecreaseButton = document.getElementById('qty-decrease');
  const qtyIncreaseButton = document.getElementById('qty-increase');
  const summaryBookPrice = document.getElementById('summary-book-price');
  const summaryShipping = document.getElementById('summary-shipping');
  const summaryTotal = document.getElementById('summary-total');
  const summaryHint = document.getElementById('summary-hint');
  const quantityWarningBanner = document.getElementById('quantity-warning-banner');
  const qtyBooks = document.getElementById('qty-books');
  const QTY_ICON_MAX = 5; // beyond this many copies, show a "+N" badge instead of one icon per copy

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE_REGEX = /^\+?[\d\s\-.()/]{6,35}$/;
  // Field limits mirror BookVault's OrderAddress schema — see
  // backend/src/lib/validation.js and CLAUDE.md §64 for the source.
  const NAME_MAX = 200;
  const STREET1_MAX = 200;
  const STREET2_MAX = 250;
  const CITY_MAX = 99;
  const STATE_MAX = 200;
  const POSTAL_MAX = 99;
  const PHONE_MAX = 35;
  // Not a BookVault limit — a sane cap, matching backend/src/lib/validation.js.
  const QUANTITY_MIN = 1;
  const QUANTITY_MAX = 20;

  let currentTotalCents = BOOK_PRICE_CENTS;
  let shippingRequestSeq = 0;
  let postalDebounceTimer = null;

  populateCountrySelect();

  const stripe = Stripe(window.RM_CONFIG.STRIPE_PUBLISHABLE_KEY);
  const elements = stripe.elements({
    mode: 'payment',
    amount: BOOK_PRICE_CENTS,
    currency: 'usd',
    // Matches the server's payment_method_types on the actual PaymentIntent
    // (stripeService.js) — card only, so the Payment Element never shows a
    // method (Link, etc.) that the backend would then refuse at confirm time.
    paymentMethodTypes: ['card'],
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
  paymentElement.mount('#payment-element');
  paymentElement.on('ready', () => {
    submitButton.disabled = false;
  });

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
    // postcode + quantity (see backend/src/services/bookvaultService.js —
    // quantity matters here because BookVault's quote is weight-based), so
    // a postcode edit needs to re-trigger it too, not just a country
    // change. Debounced so we're not firing a request per keystroke.
    postalInput.addEventListener('input', () => {
      clearTimeout(postalDebounceTimer);
      postalDebounceTimer = setTimeout(updateShipping, 500);
    });

    qtyDecreaseButton.addEventListener('click', () => setQuantity(getQuantity() - 1));
    qtyIncreaseButton.addEventListener('click', () => setQuantity(getQuantity() + 1));
    quantityInput.addEventListener('change', () => setQuantity(getQuantity()));

    renderQtyBooks(getQuantity());
  }

  // One small book icon per copy, up to QTY_ICON_MAX — beyond that a "+N"
  // badge instead of letting the row grow without bound.
  function renderQtyBooks(quantity) {
    qtyBooks.innerHTML = '';
    const iconCount = Math.min(quantity, QTY_ICON_MAX);

    for (let i = 0; i < iconCount; i += 1) {
      const icon = document.createElement('img');
      icon.className = 'qty-book-icon';
      icon.src = 'img/placeholder/edition-thumb.svg';
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
    // Immediate client-side estimate — updateShipping() below then confirms
    // the real (server-authoritative) number once BookVault responds,
    // including whether this quantity triggers the upgraded-shipping
    // warning below.
    summaryBookPrice.textContent = formatCents(BOOK_PRICE_CENTS * clamped);
    quantityWarningBanner.hidden = true;
    renderQtyBooks(clamped);
    updateShipping();
  }

  async function updateShipping() {
    const countryCode = countrySelect.value;
    const postalCode = postalInput.value.trim();
    const quantity = getQuantity();
    if (!countryCode || !postalCode) return;

    const requestId = ++shippingRequestSeq;
    summaryShipping.textContent = 'Calculating…';
    summaryTotal.textContent = '—';

    try {
      const res = await fetch(`${API_BASE_URL}/api/shipping/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country_code: countryCode, postal_code: postalCode, quantity }),
      });
      if (!res.ok) throw new Error('shipping_unavailable');
      const data = await res.json();

      // A slower request that resolves after a newer one has already
      // landed would otherwise clobber it with stale numbers.
      if (requestId !== shippingRequestSeq) return;

      currentTotalCents = data.total_price_cents;
      summaryBookPrice.textContent = formatCents(data.book_subtotal_cents);
      summaryShipping.textContent = formatCents(data.shipping_price_cents);
      summaryTotal.textContent = formatCents(data.total_price_cents);
      summaryHint.style.display = 'none';

      if (data.shipping_upgraded) {
        quantityWarningBanner.textContent = `Ordering ${quantity} copies no longer qualifies for the cheapest shipping service — a pricier, faster courier is used instead, which is why shipping costs more per copy than a smaller order.`;
        quantityWarningBanner.hidden = false;
      } else {
        quantityWarningBanner.hidden = true;
      }
      submitButton.textContent = `Pay ${formatCents(data.total_price_cents)}`;

      elements.update({ amount: currentTotalCents });
    } catch (err) {
      if (requestId !== shippingRequestSeq) return;
      summaryShipping.textContent = 'Unavailable';
      summaryTotal.textContent = '—';
      quantityWarningBanner.hidden = true;
      showFormError('We could not calculate shipping for that address. Please check the country and postal code.');
    }
  }

  function formatCents(cents) {
    return `$${(cents / 100).toFixed(2)}`;
  }

  function showFormError(message) {
    errorBanner.textContent = message;
    errorBanner.classList.add('visible');
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

    return errors;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError();
    clearFieldErrors();

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
    };

    const clientErrors = validateClientSide(values);
    if (Object.keys(clientErrors).length > 0) {
      Object.entries(clientErrors).forEach(([field, message]) => setFieldError(field, message));
      showFormError('Please correct the highlighted fields.');
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Processing…';

    const { error: submitError } = await elements.submit();
    if (submitError) {
      showFormError(submitError.message || 'Please check your payment details.');
      submitButton.disabled = false;
      return;
    }

    let orderResponse;
    try {
      const res = await fetch(`${API_BASE_URL}/api/checkout/create-payment-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      orderResponse = await res.json();

      if (!res.ok) {
        if (orderResponse.fields) {
          Object.entries(orderResponse.fields).forEach(([field, message]) => setFieldError(field, message));
        }
        showFormError(orderResponse.message || 'We could not process your order. Please review your details.');
        submitButton.disabled = false;
        submitButton.textContent = `Pay ${formatCents(currentTotalCents)}`;
        return;
      }
    } catch (err) {
      showFormError('We could not reach the server. Please check your connection and try again.');
      submitButton.disabled = false;
      submitButton.textContent = `Pay ${formatCents(currentTotalCents)}`;
      return;
    }

    const confirmationUrl = new URL(
      `confirmation.html?order=${orderResponse.order_id}`,
      window.location.href
    ).toString();

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      clientSecret: orderResponse.client_secret,
      confirmParams: {
        return_url: confirmationUrl,
        receipt_email: values.email,
      },
    });

    if (confirmError) {
      showFormError(confirmError.message || 'Your payment could not be completed. Please try again.');
      submitButton.disabled = false;
      submitButton.textContent = `Pay ${formatCents(currentTotalCents)}`;
    }
    // On success, Stripe redirects the browser to confirmationUrl itself.
  });
})();
