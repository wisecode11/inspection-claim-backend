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

function createCompanyBody(body) {
  return {
    name: requiredString(body.name, 'Company name', 2),
  };
}

module.exports = { createCompanyBody };
