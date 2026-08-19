'use strict';

const { User, Tenant, RefreshToken } = require('../models');
const { USER_ROLES, USER_STATUSES, DEVICE_PLATFORMS } = require('../models/enums');
const HttpError = require('../utils/httpError');
const { hashPassword, comparePassword } = require('../utils/password');
const {
  signToken,
  hashRefreshToken,
  createRefreshTokenValue,
  refreshExpiresInSeconds,
  toTokenResponse,
} = require('../utils/token');

function toUserResponse(user) {
  return {
    id: String(user._id),
    email: user.email,
    role: user.role,
    status: user.status,
    companyId: user.companyId ? String(user.companyId) : null,
    profile: {
      firstName: user.profile?.firstName || '',
      lastName: user.profile?.lastName || '',
      phone: user.profile?.phone || '',
      avatarUrl: user.profile?.avatarUrl || '',
    },
  };
}

function toCompanySummary(company) {
  if (!company) return null;
  return {
    id: String(company._id),
    name: company.name,
    slug: company.slug,
    legalName: company.legalName || '',
    status: company.status,
    hasAccess: Boolean(company.hasAccess),
    subscriptionRequired: Boolean(company.subscriptionRequired),
    planId: company.planId ? String(company.planId) : null,
  };
}

function normalizePlatform(platform) {
  const value = String(platform || DEVICE_PLATFORMS.WEB).toLowerCase();
  return Object.values(DEVICE_PLATFORMS).includes(value) ? value : DEVICE_PLATFORMS.WEB;
}

async function loadCompany(user) {
  if (!user.companyId) return null;
  return Tenant.findById(user.companyId);
}

async function issueSession(user, { platform, userAgent, ip } = {}) {
  const accessToken = signToken(user);
  const refresh = createRefreshTokenValue();
  const expiresAt = new Date(Date.now() + refreshExpiresInSeconds() * 1000);

  await RefreshToken.create({
    userId: user._id,
    tokenHash: refresh.hash,
    platform: normalizePlatform(platform),
    userAgent: userAgent || '',
    ip: ip || '',
    expiresAt,
    companyId: user.companyId || null,
  });

  return {
    user: toUserResponse(user),
    tokens: toTokenResponse(accessToken, refresh.raw),
    company: toCompanySummary(await loadCompany(user)),
  };
}

async function registerOwner({ firstName, lastName, email, password, phone, platform }, meta = {}) {
  if (!email || !password) {
    throw new HttpError(400, 'Email and password are required');
  }
  if (String(password).length < 6) {
    throw new HttpError(400, 'Password must be at least 6 characters');
  }

  const existing = await User.findOne({ email: email.toLowerCase().trim() });
  if (existing) {
    throw new HttpError(409, 'Email already registered');
  }

  const user = await User.create({
    email,
    passwordHash: await hashPassword(password),
    role: USER_ROLES.COMPANY_ADMIN,
    status: USER_STATUSES.PENDING_SETUP,
    profile: {
      firstName: firstName || '',
      lastName: lastName || '',
      phone: phone || '',
    },
  });

  return issueSession(user, { ...meta, platform });
}

async function login({ email, password, platform }, meta = {}) {
  if (!email || !password) {
    throw new HttpError(400, 'Email and password are required');
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+passwordHash');
  if (!user || !user.passwordHash) {
    throw new HttpError(401, 'Invalid email or password');
  }

  const matched = await comparePassword(password, user.passwordHash);
  if (!matched) {
    throw new HttpError(401, 'Invalid email or password');
  }

  if (user.status === USER_STATUSES.SUSPENDED || user.status === USER_STATUSES.DEACTIVATED) {
    throw new HttpError(403, 'Account is not active');
  }

  user.lastLoginAt = new Date();
  if (meta.ip) user.lastLoginIp = meta.ip;
  await user.save();

  return issueSession(user, { ...meta, platform });
}

async function refresh({ refreshToken, platform }, meta = {}) {
  if (!refreshToken) {
    throw new HttpError(400, 'Refresh token is required');
  }

  const record = await RefreshToken.findOne({
    tokenHash: hashRefreshToken(refreshToken),
    revokedAt: null,
  });
  if (!record || record.expiresAt <= new Date()) {
    throw new HttpError(401, 'Invalid refresh token');
  }

  const user = await User.findById(record.userId);
  if (!user) {
    throw new HttpError(401, 'User not found');
  }
  if (user.status === USER_STATUSES.SUSPENDED || user.status === USER_STATUSES.DEACTIVATED) {
    throw new HttpError(403, 'Account is not active');
  }

  record.revokedAt = new Date();
  await record.save();

  return issueSession(user, { ...meta, platform: platform || record.platform });
}

async function logout({ refreshToken }) {
  if (!refreshToken) return { loggedOut: true };
  await RefreshToken.updateOne(
    { tokenHash: hashRefreshToken(refreshToken), revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
  return { loggedOut: true };
}

async function me(user) {
  return {
    user: toUserResponse(user),
    company: toCompanySummary(await loadCompany(user)),
  };
}

module.exports = {
  registerOwner,
  login,
  refresh,
  logout,
  me,
  issueSession,
  toUserResponse,
  toCompanySummary,
};
