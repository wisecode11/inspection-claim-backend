'use strict';

const { User } = require('../models');
const { USER_ROLES, USER_STATUSES } = require('../models/enums');
const HttpError = require('../utils/httpError');
const { hashPassword, comparePassword } = require('../utils/password');
const { toSessionResponse } = require('../utils/sessionPayload');
const googleService = require('./google.service');
const tokenService = require('./token.service');

function assertAccountUsable(user) {
  if (user.status === USER_STATUSES.SUSPENDED || user.status === USER_STATUSES.DEACTIVATED) {
    throw new HttpError(403, 'Account is not active');
  }
}

function assertCompanyAdmin(user) {
  if (user.role !== USER_ROLES.COMPANY_ADMIN) {
    throw new HttpError(403, 'Google sign-in is only available for company admins');
  }
}

async function issueOwnerSession(user, meta, extras = {}) {
  user.lastLoginAt = new Date();
  user.lastLoginIp = meta.ip || '';
  await user.save();

  return toSessionResponse(user, {
    tokens: await tokenService.issueTokenPair(user, {
      ...meta,
      deviceId: extras.deviceId,
      platform: extras.platform || meta.platform || 'web',
    }),
  });
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

  return issueOwnerSession(user, meta, {
    deviceId: payload.deviceId,
    platform: payload.platform,
  });
}

/**
 * Company-admin Google continue (login + signup pages).
 * Missing account → create company_admin pending_setup, then session.
 * Existing company_admin → link googleId if needed, then session.
 */
async function googleAuth(payload, meta) {
  const identity = await googleService.verifyIdToken(payload.idToken);

  let user =
    (await User.findOne({ googleId: identity.googleId })) ||
    (await User.findOne({ email: identity.email }));

  let created = false;

  if (!user) {
    user = await User.create({
      email: identity.email,
      googleId: identity.googleId,
      role: USER_ROLES.COMPANY_ADMIN,
      status: USER_STATUSES.PENDING_SETUP,
      emailVerifiedAt: new Date(),
      profile: {
        firstName: identity.firstName || 'Admin',
        lastName: identity.lastName || '',
        avatarUrl: identity.avatarUrl || '',
      },
    });
    created = true;
  } else {
    assertCompanyAdmin(user);
    assertAccountUsable(user);

    if (!user.googleId) {
      user.googleId = identity.googleId;
    } else if (user.googleId !== identity.googleId) {
      throw new HttpError(401, 'Google account does not match this user');
    }

    if (!user.emailVerifiedAt) {
      user.emailVerifiedAt = new Date();
    }
    if (identity.avatarUrl && !user.profile?.avatarUrl) {
      user.profile = user.profile || {};
      user.profile.avatarUrl = identity.avatarUrl;
    }
  }

  const session = await issueOwnerSession(user, meta, {
    deviceId: payload.deviceId,
    platform: payload.platform || 'web',
  });

  return { ...session, created };
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
  googleAuth,
  refresh,
  logout,
  me,
};
