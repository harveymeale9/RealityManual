// Field limits sourced from Lulu's Print API OpenAPI spec + Lulu Direct help
// docs (researched 2026-08). Do not loosen these without re-checking
// https://api.lulu.com/api-docs/openapi-specs/openapi_public.yml and
// https://help.luludirect.lulu.com — these values are what Lulu will accept
// on the shipping_address object of a print job.
const NAME_MAX = 30; // Lulu: name/organization/street1/street2 must be < 30 chars
const STREET_MAX = 30;
const POSTAL_MAX = 64; // Lulu: postcode maxLength 64
const PHONE_MAX = 20; // Lulu: phone_number maxLength 20
const PHONE_REGEX = /^\+?[\d\s\-.()/]{8,20}$/; // Lulu: phone_number pattern
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COUNTRY_CODE_REGEX = /^[A-Z]{2}$/; // ISO 3166-1 alpha-2, per Lulu country_code field
const STATE_MAX = 100;
const CITY_MAX = 100;

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
    errors.customer_name = `Full name must be ${NAME_MAX} characters or fewer (Lulu shipping label limit).`;
  }

  if (!isNonEmptyString(email) || !EMAIL_REGEX.test(email.trim())) {
    errors.email = 'A valid email address is required.';
  }

  if (!isNonEmptyString(phone) || !PHONE_REGEX.test(phone.trim()) || phone.trim().length > PHONE_MAX) {
    errors.phone = 'A valid phone number is required (8-20 digits).';
  }

  if (!isNonEmptyString(country_code) || !COUNTRY_CODE_REGEX.test(country_code.trim())) {
    errors.country_code = 'Please select a valid country.';
  }

  if (!isNonEmptyString(street1)) {
    errors.street1 = 'Street address is required.';
  } else if (street1.trim().length > STREET_MAX) {
    errors.street1 = `Street address must be ${STREET_MAX} characters or fewer (Lulu shipping label limit).`;
  }

  if (isNonEmptyString(street2) && street2.trim().length > STREET_MAX) {
    errors.street2 = `Street address line 2 must be ${STREET_MAX} characters or fewer (Lulu shipping label limit).`;
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

  return errors;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

module.exports = {
  validateCheckoutInput,
  NAME_MAX,
  STREET_MAX,
  POSTAL_MAX,
  PHONE_MAX,
  CITY_MAX,
  STATE_MAX,
};
