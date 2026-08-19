'use strict';

const { Tenant } = require('../models');
const { USER_STATUSES, TENANT_STATUSES } = require('../models/enums');
const HttpError = require('../utils/httpError');
const { toSlug } = require('../utils/slug');

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

async function createCompany(owner, payload) {
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
    status: TENANT_STATUSES.ACTIVE,
    subscriptionRequired: false,
    ownerId: owner._id,
    contact: {
      email: payload.email || owner.email,
      phone: payload.phone || owner.profile.phone || '',
      website: payload.website || '',
      address: payload.address || {},
    },
    createdBy: owner._id,
  });

  owner.companyId = company._id;
  owner.status = USER_STATUSES.ACTIVE;
  await owner.save();

  return company;
}

module.exports = { createCompany };
