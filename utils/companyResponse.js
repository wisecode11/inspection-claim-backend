'use strict';

function toCompanyResponse(company) {
  if (!company) return null;
  const contact = company.contact || {};
  const address = contact.address || {};

  return {
    id: String(company._id),
    name: company.name,
    slug: company.slug,
    legalName: company.legalName || company.name,
    status: company.status,
    hasAccess: Boolean(company.hasAccess),
    subscriptionRequired: Boolean(company.subscriptionRequired),
    planId: company.planId ? String(company.planId) : null,
    contact: {
      email: contact.email || '',
      phone: contact.phone || '',
      website: contact.website || '',
      address: {
        line1: address.line1 || '',
        line2: address.line2 || '',
        city: address.city || '',
        state: address.state || '',
        postalCode: address.postalCode || '',
        country: address.country || '',
      },
    },
    branding: {
      logoUrl: (company.branding && company.branding.logoUrl) || '',
      logoStorageKey: (company.branding && company.branding.logoStorageKey) || '',
      primaryColor: (company.branding && company.branding.primaryColor) || '#1B4F72',
      secondaryColor: (company.branding && company.branding.secondaryColor) || '#F4D03F',
      accentColor: (company.branding && company.branding.accentColor) || '#FFFFFF',
      companyDisplayName: (company.branding && company.branding.companyDisplayName) || company.name || '',
      tagline: (company.branding && company.branding.tagline) || '',
      footerText:
        (company.branding && (company.branding.footerText || company.branding.letterheadNote)) || '',
    },
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
  };
}

function companyNeedsSubscription(company) {
  if (!company) return false;
  if (company.status === 'pending_subscription') return true;
  if (company.subscriptionRequired && company.status !== 'trial' && company.status !== 'active') {
    return true;
  }
  return false;
}

module.exports = { toCompanyResponse, companyNeedsSubscription };
