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

function parseDateOfLoss(value) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) {
    throw new HttpError(400, 'Date of loss is required');
  }

  const isoDay = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = isoDay
    ? new Date(Date.UTC(Number(isoDay[1]), Number(isoDay[2]) - 1, Number(isoDay[3])))
    : new Date(raw);

  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'Date of loss must be a valid date (YYYY-MM-DD)');
  }

  const tomorrow = new Date();
  tomorrow.setUTCHours(23, 59, 59, 999);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (date > tomorrow) {
    throw new HttpError(400, 'Date of loss cannot be in the future');
  }

  return date;
}

function createJobBody(body = {}) {
  const customer = body.customer || {};
  const address = body.address || {};
  const claim = body.claim || {};
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
      formatted: optionalString(address.formatted, 'Formatted address', 300),
    },
    notes: optionalString(body.notes, 'Notes'),
    inspectorId,
    dateOfLoss: parseDateOfLoss(body.dateOfLoss || claim.dateOfLoss),
  };
}

function verifyWeatherBody(body = {}) {
  if (!body.jobId || typeof body.jobId !== 'string' || !body.jobId.trim()) {
    throw new HttpError(400, 'jobId is required');
  }
  return {
    jobId: body.jobId.trim(),
    force: Boolean(body.force),
  };
}

module.exports = { createJobBody, verifyWeatherBody, parseDateOfLoss };
