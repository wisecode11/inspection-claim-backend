'use strict';

const { Device } = require('../models');
const { DEVICE_PLATFORMS } = require('../models/enums');
const HttpError = require('../utils/httpError');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_TOKEN_RE = /^ExponentPushToken\[.+\]$/;

function isExpoPushToken(token) {
  return typeof token === 'string' && EXPO_TOKEN_RE.test(token.trim());
}

function assertMobilePlatform(platform) {
  if (platform !== DEVICE_PLATFORMS.IOS && platform !== DEVICE_PLATFORMS.ANDROID) {
    throw new HttpError(400, 'Platform must be ios or android');
  }
  return platform;
}

async function registerPushToken(user, payload = {}) {
  if (!user?.companyId) {
    throw new HttpError(400, 'Create a company first');
  }

  const deviceId = String(payload.deviceId || '').trim();
  if (!deviceId) {
    throw new HttpError(400, 'Device id is required');
  }

  const platform = assertMobilePlatform(payload.platform);
  const pushToken = String(payload.pushToken || '').trim();
  if (!isExpoPushToken(pushToken)) {
    throw new HttpError(400, 'Valid Expo push token is required');
  }

  const pushEnabled = payload.pushEnabled === undefined ? true : Boolean(payload.pushEnabled);

  const device = await Device.findOneAndUpdate(
    {
      companyId: user.companyId,
      userId: user._id,
      deviceId,
    },
    {
      $set: {
        platform,
        pushToken,
        pushEnabled,
        appVersion: String(payload.appVersion || '').trim().slice(0, 40),
        osVersion: String(payload.osVersion || '').trim().slice(0, 40),
        name: String(payload.name || '').trim().slice(0, 120),
        lastSeenAt: new Date(),
        isActive: true,
      },
      $setOnInsert: {
        companyId: user.companyId,
        userId: user._id,
        deviceId,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).select('+pushToken');

  return {
    deviceId: device.deviceId,
    platform: device.platform,
    pushEnabled: device.pushEnabled,
    isActive: device.isActive,
  };
}

async function updatePushPreference(user, payload = {}) {
  if (!user?.companyId) {
    throw new HttpError(400, 'Create a company first');
  }

  const deviceId = String(payload.deviceId || '').trim();
  if (!deviceId) {
    throw new HttpError(400, 'Device id is required');
  }

  if (typeof payload.pushEnabled !== 'boolean') {
    throw new HttpError(400, 'pushEnabled must be a boolean');
  }

  const device = await Device.findOneAndUpdate(
    {
      companyId: user.companyId,
      userId: user._id,
      deviceId,
    },
    {
      $set: {
        pushEnabled: payload.pushEnabled,
        lastSeenAt: new Date(),
      },
    },
    { new: true }
  );

  if (!device) {
    throw new HttpError(404, 'Device not registered yet');
  }

  return {
    deviceId: device.deviceId,
    pushEnabled: device.pushEnabled,
  };
}

async function clearPushToken(user, payload = {}) {
  if (!user?.companyId) {
    return { cleared: false };
  }

  const deviceId = String(payload.deviceId || '').trim();
  if (!deviceId) {
    return { cleared: false };
  }

  await Device.updateOne(
    {
      companyId: user.companyId,
      userId: user._id,
      deviceId,
    },
    {
      $set: {
        pushToken: '',
        isActive: false,
        lastSeenAt: new Date(),
      },
    }
  );

  return { cleared: true };
}

async function listActiveTokensForUser(userId) {
  const devices = await Device.find({
    userId,
    isActive: true,
    pushEnabled: { $ne: false },
    pushToken: { $nin: ['', null] },
  }).select('+pushToken');

  return devices
    .map((device) => String(device.pushToken || '').trim())
    .filter((token) => isExpoPushToken(token));
}

async function clearInvalidTokens(tokens = []) {
  const invalid = tokens.filter(Boolean);
  if (!invalid.length) return;
  await Device.updateMany(
    { pushToken: { $in: invalid } },
    { $set: { pushToken: '', isActive: false } }
  );
}

async function sendExpoPush(messages = []) {
  if (!messages.length) {
    return { sent: 0, tickets: [] };
  }

  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messages),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.errors?.[0]?.message || payload?.message || response.statusText;
    throw new Error(`Expo push failed: ${detail}`);
  }

  const tickets = Array.isArray(payload.data) ? payload.data : [];
  const invalidTokens = [];

  tickets.forEach((ticket, index) => {
    if (ticket?.status !== 'error') return;
    const details = ticket.details?.error;
    if (details === 'DeviceNotRegistered' || details === 'InvalidCredentials') {
      invalidTokens.push(messages[index]?.to);
    }
  });

  if (invalidTokens.length) {
    await clearInvalidTokens(invalidTokens);
  }

  return { sent: messages.length, tickets };
}

async function notifyUser(userId, { title, body, data = {}, sound = 'default' } = {}) {
  if (!userId || !title) {
    return { sent: 0 };
  }

  const tokens = [...new Set(await listActiveTokensForUser(userId))];
  if (!tokens.length) {
    return { sent: 0 };
  }

  const messages = tokens.map((to) => ({
    to,
    title,
    body: body || '',
    data,
    sound,
  }));

  return sendExpoPush(messages);
}

function notifyUserSafe(userId, message) {
  notifyUser(userId, message).catch((error) => {
    console.error('[push] notifyUser failed:', error?.message || error);
  });
}

module.exports = {
  registerPushToken,
  updatePushPreference,
  clearPushToken,
  notifyUser,
  notifyUserSafe,
  isExpoPushToken,
};