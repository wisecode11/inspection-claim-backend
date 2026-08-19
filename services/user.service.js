'use strict';

const { User } = require('../models');
const { USER_ROLES, USER_STATUSES } = require('../models/enums');
const HttpError = require('../utils/httpError');
const { hashPassword } = require('../utils/password');
const { toUserResponse } = require('../utils/userResponse');

async function createInspector(owner, payload) {
  if (!owner.companyId) {
    throw new HttpError(400, 'Create a company first');
  }
  if (!payload || !payload.email || !payload.password) {
    throw new HttpError(400, 'Inspector email and password are required');
  }
  if (String(payload.password).length < 6) {
    throw new HttpError(400, 'Password must be at least 6 characters');
  }

  const existing = await User.findOne({ email: payload.email.toLowerCase().trim() });
  if (existing) {
    throw new HttpError(409, 'Email already registered');
  }

  const inspector = await User.create({
    email: payload.email,
    passwordHash: await hashPassword(payload.password),
    role: USER_ROLES.INSPECTOR,
    status: USER_STATUSES.ACTIVE,
    companyId: owner.companyId,
    profile: {
      firstName: payload.firstName || '',
      lastName: payload.lastName || '',
      phone: payload.phone || '',
    },
    createdBy: owner._id,
  });

  return toUserResponse(inspector);
}

module.exports = { createInspector };
