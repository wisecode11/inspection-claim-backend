'use strict';

const { User } = require('../models');
const { USER_ROLES, USER_STATUSES } = require('../models/enums');
const HttpError = require('../utils/httpError');
const { hashPassword, comparePassword } = require('../utils/password');
const { toSessionResponse } = require('../utils/sessionPayload');
const tokenService = require('./token.service');

function assertAccountUsable(user) {
  if (user.status === USER_STATUSES.SUSPENDED || user.status === USER_STATUSES.DEACTIVATED) {
    throw new HttpError(403, 'Account is not active');
  }
}

async function registerOwner(payload, meta) {
  const existing = await User.findOne({ email: payload.email });
  if (existing) {
    throw new HttpError(409, 'Email already registered');
  }

  const user = await User.create({
    email: payload.email,
    passwordHash: await hashPassword(payload.password),
    role: USER_ROLES.COMPANY_ADMIN,
    status: USER_STATUSES.PENDING_SETUP,
    profile: {
      firstName: payload.firstName,
      lastName: payload.lastName,
      phone: payload.phone || '',
    },
  });

  return toSessionResponse(user, {
    tokens: await tokenService.issueTokenPair(user, meta),
  });
}

async function login(payload, meta) {
  const user = await User.findOne({ email: payload.email }).select('+passwordHash');
  if (!user || !user.passwordHash) {
    throw new HttpError(401, 'Invalid email or password');
  }

  const matched = await comparePassword(payload.password, user.passwordHash);
  if (!matched) {
    throw new HttpError(401, 'Invalid email or password');
  }

  assertAccountUsable(user);

  user.lastLoginAt = new Date();
  user.lastLoginIp = meta.ip || '';
  await user.save();

  return toSessionResponse(user, {
    tokens: await tokenService.issueTokenPair(user, {
      ...meta,
      deviceId: payload.deviceId,
      platform: payload.platform,
    }),
  });
}

async function refresh(payload, meta) {
  const tokens = await tokenService.rotateRefreshToken(payload.refreshToken, {
    ...meta,
    deviceId: payload.deviceId,
    platform: payload.platform,
  });
  return { tokens };
}

async function logout(payload, currentUser) {
  if (payload.refreshToken) {
    await tokenService.revokeRefreshToken(payload.refreshToken);
    return;
  }
  if (currentUser) {
    await tokenService.revokeAllUserTokens(currentUser._id);
  }
}

async function me(currentUser) {
  return toSessionResponse(currentUser);
}

module.exports = {
  registerOwner,
  login,
  refresh,
  logout,
  me,
};
