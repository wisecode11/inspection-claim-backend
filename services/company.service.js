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

  const existingOwned = await Tenant.findOne({ ownerId: owner._id });
  if (existingOwned) {
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

async function getMyCompany(user) {
  if (!user.companyId) return null;
  const company = await Tenant.findById(user.companyId);
  return toCompanyResponse(company);
}

async function updateCompany(user, payload = {}) {
  if (!user.companyId) {
    throw new HttpError(400, 'Create a company first');
  }

  const company = await Tenant.findById(user.companyId);
  if (!company) {
    throw new HttpError(404, 'Company not found');
  }

  if (payload.name) {
    company.name = payload.name;
    if (!payload.legalName && (!company.legalName || company.legalName === company.name)) {
      company.legalName = payload.name;
    }
  }
  if (payload.legalName !== undefined) {
    company.legalName = payload.legalName || company.name;
  }

  if (payload.contact) {
    if (payload.contact.email !== undefined) company.contact.email = payload.contact.email;
    if (payload.contact.phone !== undefined) company.contact.phone = payload.contact.phone;
    if (payload.contact.website !== undefined) company.contact.website = payload.contact.website;
    if (payload.contact.address) {
      company.contact.address = {
        ...(company.contact.address?.toObject?.() || company.contact.address || {}),
        ...payload.contact.address,
      };
    }
  }

  if (payload.branding) {
    if (!company.branding) company.branding = {};
    const branding = payload.branding;
    for (const key of [
      'logoUrl',
      'logoStorageKey',
      'primaryColor',
      'secondaryColor',
      'accentColor',
      'companyDisplayName',
      'tagline',
      'footerText',
      'letterheadNote',
    ]) {
      if (branding[key] !== undefined) {
        company.branding[key] = branding[key];
      }
    }
    if (branding.footerText !== undefined && branding.letterheadNote === undefined) {
      company.branding.letterheadNote = branding.footerText;
    }
  }

  company.updatedBy = user._id;
  await company.save();
  return toCompanyResponse(company);
}

module.exports = { createCompany, getMyCompany, updateCompany };
