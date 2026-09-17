// Field limits sourced from BookVault's official API OpenAPI spec
// (https://api.bookvault.app/v3/swagger/docs/v3, the JSON backing their
// ReDoc page at https://api.bookvault.app/v3/docs), researched 2026-09-17 —
// see CLAUDE.md §64. These replace an earlier set of limits carried over
// from Lulu (abandoned as the fulfillment provider, see CLAUDE.md §26) that
// were considerably stricter than what BookVault actually accepts on its
// OrderAddress object. Do not loosen these without re-checking that spec.
const NAME_MAX = 200; // BookVault OrderAddress.Addressee maxLength 200
const STREET1_MAX = 200; // OrderAddress.Address1 maxLength 200
const STREET2_MAX = 250; // OrderAddress.Address2 maxLength 250
const CITY_MAX = 99; // OrderAddress.Town maxLength 99
const STATE_MAX = 200; // OrderAddress.County maxLength 200
const POSTAL_MAX = 99; // OrderAddress.Postcode maxLength 99
const PHONE_MAX = 35; // OrderAddress.TelNumber maxLength 35
const EMAIL_MAX = 120; // OrderAddress.Email maxLength 120
// Not a BookVault limit — just a sane cap so a typo/abuse can't request an
// absurd quantity. Revisit if bulk orders become a real use case.
const QUANTITY_MIN = 1;
const QUANTITY_MAX = 20;

const PHONE_REGEX = /^\+?[\d\s\-.()/]{6,35}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COUNTRY_CODE_REGEX = /^[A-Z]{2}$/; // ISO 3166-2, per BookVault's Country.ISO_Code field

function validateCheckoutInput(body = {}) {
  const errors = {};
  const {
    customer_name,
    email,
    phone,
    country_code,
    street1,
    street2,
    city,
    state,
    postal_code,
  } = body;

  if (!isNonEmptyString(customer_name)) {
    errors.customer_name = 'Full name is required.';
  } else if (customer_name.trim().length > NAME_MAX) {
    errors.customer_name = `Full name must be ${NAME_MAX} characters or fewer.`;
  }

  if (!isNonEmptyString(email) || !EMAIL_REGEX.test(email.trim())) {
    errors.email = 'A valid email address is required.';
  } else if (email.trim().length > EMAIL_MAX) {
    errors.email = `Email must be ${EMAIL_MAX} characters or fewer.`;
  }

  if (!isNonEmptyString(phone) || !PHONE_REGEX.test(phone.trim())) {
    errors.phone = 'A valid phone number is required.';
  } else if (phone.trim().length > PHONE_MAX) {
    errors.phone = `Phone number must be ${PHONE_MAX} characters or fewer.`;
  }

  if (!isNonEmptyString(country_code) || !COUNTRY_CODE_REGEX.test(country_code.trim())) {
    errors.country_code = 'Please select a valid country.';
  }

  if (!isNonEmptyString(street1)) {
    errors.street1 = 'Street address is required.';
  } else if (street1.trim().length > STREET1_MAX) {
    errors.street1 = `Street address must be ${STREET1_MAX} characters or fewer.`;
  }

  if (isNonEmptyString(street2) && street2.trim().length > STREET2_MAX) {
    errors.street2 = `Street address line 2 must be ${STREET2_MAX} characters or fewer.`;
  }

  if (!isNonEmptyString(city)) {
    errors.city = 'City is required.';
  } else if (city.trim().length > CITY_MAX) {
    errors.city = `City must be ${CITY_MAX} characters or fewer.`;
  }

  if (isNonEmptyString(state) && state.trim().length > STATE_MAX) {
    errors.state = `State/province must be ${STATE_MAX} characters or fewer.`;
  }

  if (!isNonEmptyString(postal_code)) {
    errors.postal_code = 'Postal/ZIP code is required.';
  } else if (postal_code.trim().length > POSTAL_MAX) {
    errors.postal_code = `Postal code must be ${POSTAL_MAX} characters or fewer.`;
  }

  if (body.quantity !== undefined && normalizeQuantity(body.quantity) === null) {
    errors.quantity = `Quantity must be a whole number between ${QUANTITY_MIN} and ${QUANTITY_MAX}.`;
  }

  return errors;
}

// Returns a valid integer quantity, or null if the input isn't one within
// [QUANTITY_MIN, QUANTITY_MAX]. Missing/undefined defaults to 1 (the
// pre-quantity-selector behavior) rather than failing validation.
function normalizeQuantity(value) {
  if (value === undefined || value === null || value === '') return 1;
  const n = Number(value);
  if (!Number.isInteger(n) || n < QUANTITY_MIN || n > QUANTITY_MAX) return null;
  return n;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

module.exports = {
  validateCheckoutInput,
  normalizeQuantity,
  NAME_MAX,
  STREET1_MAX,
  STREET2_MAX,
  POSTAL_MAX,
  PHONE_MAX,
  EMAIL_MAX,
  CITY_MAX,
  STATE_MAX,
  QUANTITY_MIN,
  QUANTITY_MAX,
};
