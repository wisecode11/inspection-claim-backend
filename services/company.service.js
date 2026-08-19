'use strict';

const { Tenant } = require('../models');
const { USER_STATUSES, TENANT_STATUSES } = require('../models/enums');
const HttpError = require('../utils/httpError');
const { toSlug } = require('../utils/slug');
const { issueSession, toCompanySummary } = require('./auth.service');

async function uniqueSlug(name) {
  const base = toSlug(name);
  let n = 1;
  let slug = base;
  while (await Tenant.findOne({ slug })) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

async function listCompanies(user) {
  if (!user.companyId) return [];
  const company = await Tenant.findById(user.companyId);
  return company ? [toCompanySummary(company)] : [];
}

async function getMyCompany(user) {
  if (!user.companyId) {
    throw new HttpError(404, 'No company yet');
  }
  const company = await Tenant.findById(user.companyId);
  if (!company) {
    throw new HttpError(404, 'Company not found');
  }
  return toCompanySummary(company);
}

async function createCompany(owner, payload, meta = {}) {
  if (owner.companyId) {
    throw new HttpError(409, 'Company already created for this user');
  }
  if (!payload || !payload.name) {
    throw new HttpError(400, 'Company name is required');
  }

  const company = await Tenant.create({
    name: payload.name,
    slug: await uniqueSlug(payload.name),
    legalName: payload.legalName || payload.name,
    status: TENANT_STATUSES.PENDING_SUBSCRIPTION,
    subscriptionRequired: true,
    ownerId: owner._id,
    contact: {
      email: payload.email || owner.email,
      phone: payload.phone || owner.profile?.phone || '',
      website: payload.website || '',
      address: payload.address || {},
    },
    createdBy: owner._id,
  });

  owner.companyId = company._id;
  owner.status = USER_STATUSES.ACTIVE;
  await owner.save();

  return issueSession(owner, meta);
}

module.exports = { createCompany, listCompanies, getMyCompany };
