'use strict';

const HttpError = require('../utils/httpError');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function parseName(body) {
  if (body.firstName) {
    return {
      firstName: requiredString(body.firstName, 'First name'),
      lastName: typeof body.lastName === 'string' ? body.lastName.trim() : '',
    };
  }

  const name = requiredString(body.name, 'Name');
  const parts = name.split(/\s+/);
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

function createInspectorBody(body) {
  const email = requiredString(body.email, 'Email').toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new HttpError(400, 'Enter a valid email');
  }

  const password = requiredString(body.password, 'Password', 6);
  const { firstName, lastName } = parseName(body || {});

  return {
    name: `${firstName} ${lastName}`.trim(),
    firstName,
    lastName,
    email,
    password,
    phone: typeof body.phone === 'string' ? body.phone.trim() : '',
  };
}

function inspectorStatusBody(body) {
  const status = String(body.status || '').trim();
  if (status !== 'active' && status !== 'suspended') {
    throw new HttpError(400, 'Status must be active or suspended');
  }
  return { status };
}

module.exports = { createInspectorBody, inspectorStatusBody };
