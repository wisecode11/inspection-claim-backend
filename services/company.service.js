'use strict';

const { Tenant } = require('../models');
const { TENANT_STATUSES } = require('../models/enums');
const HttpError = require('../utils/httpError');
const { toSlug } = require('../utils/slug');
const { toUserResponse } = require('../utils/userResponse');
const { toCompanyResponse } = require('../utils/companyResponse');
const tokenService = require('./token.service');

async function uniqueSlug(name) {
  const base = toSlug(name);
  let slug = base;
  let n = 1;
  while (await Tenant.findOne({ slug })) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

async function createCompany(owner, payload, meta = {}) {
  if (owner.companyId) {
    throw new HttpError(409, 'Organization already created for this user');
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
      email: owner.email,
      phone: payload.phone || owner.profile?.phone || '',
      website: payload.website || '',
    },
    createdBy: owner._id,
  });

  owner.companyId = company._id;
  await owner.save();

  return {
    user: toUserResponse(owner),
    company: toCompanyResponse(company),
    tokens: await tokenService.issueTokenPair(owner, meta),
  };
}

async function listMyCompanies(user) {
  if (!user.companyId) return [];
  const companies = await Tenant.find({
    $or: [{ _id: user.companyId }, { ownerId: user._id }],
  }).sort({ name: 1 });
  return companies.map(toCompanyResponse);
}

async function getMyCompany(user) {
  if (!user.companyId) return null;
  const company = await Tenant.findById(user.companyId);
  return toCompanyResponse(company);
}

module.exports = { createCompany, listMyCompanies, getMyCompany };
