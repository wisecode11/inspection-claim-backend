'use strict';

const { User } = require('../models');
const { USER_ROLES, USER_STATUSES } = require('../models/enums');
const HttpError = require('../utils/httpError');
const { hashPassword, comparePassword } = require('../utils/password');
const { signToken } = require('../utils/token');

function toUserResponse(user) {
  return {
    id: user._id,
    email: user.email,
    role: user.role,
    status: user.status,
    companyId: user.companyId || null,
    profile: user.profile,
  };
}

async function registerOwner({ firstName, lastName, email, password, phone }) {
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

  return {
    user: toUserResponse(user),
    token: signToken(user),
  };
}

async function login({ email, password }) {
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
  await user.save();

  return {
    user: toUserResponse(user),
    token: signToken(user),
  };
}

module.exports = {
  registerOwner,
  login,
  toUserResponse,
};
