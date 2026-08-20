'use strict';

const HttpError = require('../utils/httpError');

function requiredString(value, field, minLength = 1) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length < minLength) {
    throw new HttpError(400, `${field} must be at least ${minLength} characters`);
  }
  return trimmed;
}

function optionalString(value, field, maxLength = 200) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') {
    throw new HttpError(400, `${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpError(400, `${field} is too long`);
  }
  return trimmed;
}

function createCompanyBody(body) {
  return {
    name: requiredString(body.name, 'Company name', 2),
    legalName: optionalString(body.legalName, 'Legal name', 200),
    phone: optionalString(body.phone, 'Phone', 30),
    website: optionalString(body.website, 'Website', 200),
  };
}

function updateCompanyBody(body = {}) {
  const result = {};

  if (body.name !== undefined) {
    result.name = requiredString(body.name, 'Company name', 2);
  }
  if (body.legalName !== undefined) {
    result.legalName = optionalString(body.legalName, 'Legal name', 200);
  }
  if (body.contact) {
    result.contact = {
      email: body.contact.email !== undefined
        ? optionalString(body.contact.email, 'Contact email', 254).toLowerCase()
        : undefined,
      phone: body.contact.phone !== undefined
        ? optionalString(body.contact.phone, 'Contact phone', 30)
        : undefined,
      website: body.contact.website !== undefined
        ? optionalString(body.contact.website, 'Website', 200)
        : undefined,
    };
    if (body.contact.address) {
      result.contact.address = {
        line1: optionalString(body.contact.address.line1, 'Address line 1', 200),
        line2: optionalString(body.contact.address.line2, 'Address line 2', 120),
        city: optionalString(body.contact.address.city, 'City', 80),
        state: optionalString(body.contact.address.state, 'State', 80),
        postalCode: optionalString(body.contact.address.postalCode, 'Postal code', 20),
        country: optionalString(body.contact.address.country, 'Country', 8),
      };
    }
  }

  if (body.branding) {
    const branding = body.branding;
    result.branding = {
      logoUrl: branding.logoUrl !== undefined
        ? optionalString(branding.logoUrl, 'Logo URL', 2_000_000)
        : undefined,
      logoStorageKey: branding.logoStorageKey !== undefined
        ? optionalString(branding.logoStorageKey, 'Logo storage key', 400)
        : undefined,
      primaryColor: branding.primaryColor !== undefined
        ? optionalString(branding.primaryColor, 'Primary color', 20)
        : undefined,
      secondaryColor: branding.secondaryColor !== undefined
        ? optionalString(branding.secondaryColor, 'Secondary color', 20)
        : undefined,
      accentColor: branding.accentColor !== undefined
        ? optionalString(branding.accentColor, 'Accent color', 20)
        : undefined,
      companyDisplayName: branding.companyDisplayName !== undefined
        ? optionalString(branding.companyDisplayName, 'Company display name', 160)
        : undefined,
      tagline: branding.tagline !== undefined
        ? optionalString(branding.tagline, 'Tagline', 200)
        : undefined,
      footerText: branding.footerText !== undefined
        ? optionalString(branding.footerText, 'Footer text', 500)
        : undefined,
      letterheadNote: branding.letterheadNote !== undefined
        ? optionalString(branding.letterheadNote, 'Letterhead note', 500)
        : undefined,
    };
  }

  return result;
}

module.exports = { createCompanyBody, updateCompanyBody };
