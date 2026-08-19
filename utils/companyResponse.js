'use strict';

function toCompanyResponse(company) {
  if (!company) return null;
  return {
    id: String(company._id),
    name: company.name,
    slug: company.slug,
    legalName: company.legalName || company.name,
    status: company.status,
    hasAccess: Boolean(company.hasAccess),
    subscriptionRequired: Boolean(company.subscriptionRequired),
    planId: company.planId ? String(company.planId) : null,
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
