'use strict';

const { Tenant } = require('../models');
const { USER_ROLES, USER_STATUSES, TENANT_STATUSES } = require('../models/enums');
const { toUserResponse } = require('./userResponse');
const { toCompanyResponse } = require('./companyResponse');

/**
 * Resolve the company for a session user.
 * Prefer companyId; if missing/stale, fall back to tenant owned by this user and repair the link.
 */
async function resolveSessionCompany(user) {
  let company = user.companyId ? await Tenant.findById(user.companyId) : null;

  if (
    !company &&
    user.role === USER_ROLES.COMPANY_ADMIN
  ) {
    company = await Tenant.findOne({ ownerId: user._id }).sort({ createdAt: 1 });
    if (company && String(user.companyId || '') !== String(company._id)) {
      user.companyId = company._id;
      await user.save();
    }
  }

  return company;
}

/**
 * Owners who already completed org + subscription should not stay pending_setup.
 */
async function syncOwnerStatusFromCompany(user, company) {
  if (!company || user.role !== USER_ROLES.COMPANY_ADMIN) return user;
  if (user.status !== USER_STATUSES.PENDING_SETUP) return user;

  if (
    company.status === TENANT_STATUSES.ACTIVE ||
    company.status === TENANT_STATUSES.TRIAL
  ) {
    user.status = USER_STATUSES.ACTIVE;
    await user.save();
  }

  return user;
}

async function toSessionResponse(user, extra = {}) {
  const company = await resolveSessionCompany(user);
  await syncOwnerStatusFromCompany(user, company);

  const payload = {
    user: toUserResponse(user),
    company: toCompanyResponse(company),
    ...extra,
  };

  if (payload.tokens && payload.tokens.accessToken) {
    payload.token = payload.tokens.accessToken;
  }

  return payload;
}

module.exports = { toSessionResponse };
