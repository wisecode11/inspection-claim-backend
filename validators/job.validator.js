'use strict';

const HttpError = require('../utils/httpError');

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `${field} is required`);
  }
  return value.trim();
}

function optionalString(value) {
  if (value == null || value === '') return '';
  return String(value).trim();
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

  if (!customer.name || !String(customer.name).trim()) {
    throw new HttpError(400, 'Customer name is required');
  }
  if (!(address.line1 || address.street)) {
    throw new HttpError(400, 'Job address is required');
  }

  return {
    customer: {
      name: requiredString(customer.name, 'Customer name'),
      email: optionalString(customer.email),
      phone: optionalString(customer.phone),
    },
    address: {
      line1: optionalString(address.line1 || address.street),
      line2: optionalString(address.line2),
      city: optionalString(address.city),
      state: optionalString(address.state),
      postalCode: optionalString(address.postalCode || address.zip),
      country: optionalString(address.country),
      formatted: optionalString(address.formatted),
    },
    notes: optionalString(body.notes),
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
