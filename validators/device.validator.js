'use strict';

const { DEVICE_PLATFORMS } = require('../models/enums');
const HttpError = require('../utils/httpError');

const MOBILE_PLATFORMS = new Set([DEVICE_PLATFORMS.IOS, DEVICE_PLATFORMS.ANDROID]);
const EXPO_TOKEN_RE = /^ExponentPushToken\[.+\]$/;

function requiredString(value, field, maxLength = 200) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpError(400, `${field} is too long`);
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

function registerPushTokenBody(body = {}) {
  const platform = requiredString(body.platform, 'Platform', 20);
  if (!MOBILE_PLATFORMS.has(platform)) {
    throw new HttpError(400, 'Platform must be ios or android');
  }

  const pushToken = requiredString(body.pushToken, 'Push token', 200);
  if (!EXPO_TOKEN_RE.test(pushToken)) {
    throw new HttpError(400, 'Valid Expo push token is required');
  }

  return {
    deviceId: requiredString(body.deviceId, 'Device id', 120),
    platform,
    pushToken,
    pushEnabled: body.pushEnabled === undefined ? true : Boolean(body.pushEnabled),
    appVersion: optionalString(body.appVersion, 'App version', 40),
    osVersion: optionalString(body.osVersion, 'OS version', 40),
    name: optionalString(body.name, 'Device name', 120),
  };
}

function updatePushPreferenceBody(body = {}) {
  if (typeof body.pushEnabled !== 'boolean') {
    throw new HttpError(400, 'pushEnabled must be a boolean');
  }

  return {
    deviceId: requiredString(body.deviceId, 'Device id', 120),
    pushEnabled: body.pushEnabled,
  };
}

function clearPushTokenBody(body = {}) {
  return {
    deviceId: requiredString(body.deviceId, 'Device id', 120),
  };
}

module.exports = {
  registerPushTokenBody,
  updatePushPreferenceBody,
  clearPushTokenBody,
};