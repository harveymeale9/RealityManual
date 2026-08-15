(function () {
  const API_BASE_URL = window.RM_CONFIG.API_BASE_URL;
  const BOOK_PRICE_CENTS = 3900;

  const form = document.getElementById('checkout-form');
  const submitButton = document.getElementById('submit-button');
  const errorBanner = document.getElementById('form-error-banner');
  const countrySelect = document.getElementById('country_code');
  const summaryShipping = document.getElementById('summary-shipping');
  const summaryTotal = document.getElementById('summary-total');

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE_REGEX = /^\+?[\d\s\-.()/]{8,20}$/;
  const NAME_MAX = 30;
  const STREET_MAX = 30;

  let currentTotalCents = BOOK_PRICE_CENTS;

  populateCountrySelect();

  const stripe = Stripe(window.RM_CONFIG.STRIPE_PUBLISHABLE_KEY);
  const elements = stripe.elements({
    mode: 'payment',
    amount: BOOK_PRICE_CENTS,
    currency: 'usd',
    appearance: {
      variables: {
        colorPrimary: '#6b2e2e',
        colorBackground: '#ffffff',
        colorText: '#211d15',
        fontFamily: 'Georgia, serif',
        borderRadius: '0px',
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

    countrySelect.addEventListener('change', onCountryChange);
  }

  async function onCountryChange() {
    const countryCode = countrySelect.value;
    if (!countryCode) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/shipping/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country_code: countryCode }),
      });
      if (!res.ok) throw new Error('shipping_unavailable');
      const data = await res.json();

      currentTotalCents = data.total_price_cents;
      summaryShipping.textContent = formatCents(data.shipping_price_cents);
      summaryTotal.textContent = formatCents(data.total_price_cents);
      submitButton.textContent = `Pay ${formatCents(data.total_price_cents)}`;

      elements.update({ amount: currentTotalCents });
    } catch (err) {
      summaryShipping.textContent = 'Unavailable';
      summaryTotal.textContent = '—';
      showFormError('We could not calculate shipping for that country. Please try again.');
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

    if (!PHONE_REGEX.test(values.phone.trim())) errors.phone = 'A valid phone number is required.';

    if (!values.country_code) errors.country_code = 'Please select a country.';

    if (!values.street1.trim()) errors.street1 = 'Street address is required.';
    else if (values.street1.length > STREET_MAX) errors.street1 = `Must be ${STREET_MAX} characters or fewer.`;

    if (values.street2 && values.street2.length > STREET_MAX) errors.street2 = `Must be ${STREET_MAX} characters or fewer.`;

    if (!values.city.trim()) errors.city = 'City is required.';

    if (!values.postal_code.trim()) errors.postal_code = 'Postal/ZIP code is required.';

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

    const confirmationUrl = `${window.location.origin}/confirmation?order=${orderResponse.order_id}`;

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
