'use strict';

const HttpError = require('../utils/httpError');

function requiredString(value, field, minLength = 1) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length < minLength) {
    throw new HttpError(400, `${field} must be at least ${minLength} characters`);
  }
  return trimmed;
}

function optionalString(value, field, maxLength = 4000) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') {
    throw new HttpError(400, `${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpError(400, `${field} is too long`);
  }
  return trimmed;
}

function createJobBody(body = {}) {
  const customer = body.customer || {};
  const address = body.address || {};
  const inspectorId = typeof body.inspectorId === 'string' ? body.inspectorId.trim() : '';

  return {
    customer: {
      name: requiredString(customer.name, 'Customer name'),
      email: optionalString(customer.email, 'Customer email', 254),
      phone: optionalString(customer.phone, 'Customer phone', 30),
    },
    address: {
      line1: requiredString(address.line1 || address.street, 'Street address'),
      line2: optionalString(address.line2, 'Address line 2', 120),
      city: requiredString(address.city, 'City'),
      state: optionalString(address.state, 'State', 80),
      postalCode: optionalString(address.postalCode || address.zip, 'Postal code', 20),
      country: optionalString(address.country, 'Country', 8) || 'US',
    },
    notes: optionalString(body.notes, 'Notes'),
    inspectorId,
  };
}

module.exports = { createJobBody };
