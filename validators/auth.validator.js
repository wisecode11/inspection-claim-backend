'use strict';

const { DEVICE_PLATFORMS } = require('../models/enums');
const HttpError = require('../utils/httpError');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLATFORMS = new Set(Object.values(DEVICE_PLATFORMS));

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

function optionalString(value, field, maxLength = 200) {
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

function parseEmail(value) {
  const email = requiredString(value, 'Email').toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new HttpError(400, 'Enter a valid email');
  }
  return email;
}

function parsePassword(value) {
  return requiredString(value, 'Password', 6);
}

function parsePlatform(value) {
  if (!value) return DEVICE_PLATFORMS.WEB;
  if (!PLATFORMS.has(value)) {
    throw new HttpError(400, 'Invalid platform');
  }
  return value;
}

function registerBody(body) {
  return {
    firstName: requiredString(body.firstName, 'First name'),
    lastName: requiredString(body.lastName, 'Last name'),
    email: parseEmail(body.email),
    password: parsePassword(body.password),
    phone: optionalString(body.phone, 'Phone', 30),
  };
}

function loginBody(body) {
  return {
    email: parseEmail(body.email),
    password: parsePassword(body.password),
    deviceId: optionalString(body.deviceId, 'Device id', 120),
    platform: parsePlatform(body.platform),
  };
}

function googleAuthBody(body) {
  const mode = optionalString(body.mode, 'Mode', 20) || 'login';
  if (mode !== 'login' && mode !== 'signup') {
    throw new HttpError(400, 'Mode must be login or signup');
  }
  return {
    idToken: requiredString(body.idToken, 'Google token'),
    mode,
    deviceId: optionalString(body.deviceId, 'Device id', 120),
    platform: parsePlatform(body.platform),
  };
}

function refreshBody(body) {
  return {
    refreshToken: requiredString(body.refreshToken, 'Refresh token'),
    deviceId: optionalString(body.deviceId, 'Device id', 120),
    platform: parsePlatform(body.platform),
  };
}

function logoutBody(body) {
  return {
    refreshToken: optionalString(body.refreshToken, 'Refresh token', 200),
  };
}

module.exports = {
  registerBody,
  loginBody,
  googleAuthBody,
  refreshBody,
  logoutBody,
};
