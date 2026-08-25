'use strict';

const { Tenant } = require('../models');
const { TENANT_STATUSES, BILLING_INTERVALS } = require('../models/enums');
const HttpError = require('../utils/httpError');

function ownerDisplayName(owner) {
  if (!owner) return '';
  const first = owner.profile?.firstName || '';
  const last = owner.profile?.lastName || '';
  return `${first} ${last}`.trim() || owner.email || '';
}

function formatRegion(tenant) {
  const address = tenant.contact?.address || {};
  const city = address.city || '';
  const state = address.state || '';
  if (city && state) return `${city}, ${state}`;
  return address.formatted || city || state || '';
}

function toUiStatus(status) {
  if (status === TENANT_STATUSES.TRIAL || status === TENANT_STATUSES.PENDING_SUBSCRIPTION) {
    return 'trial';
  }
  if (status === TENANT_STATUSES.SUSPENDED || status === TENANT_STATUSES.CANCELLED) {
    return 'suspended';
  }
  return 'active';
}

function toPlanLabel(plan) {
  const slug = String(plan?.slug || '').toLowerCase();
  const name = String(plan?.name || '').trim();
  if (slug.includes('enterprise') || /enterprise/i.test(name)) return 'Enterprise';
  if (slug === 'pro' || slug.includes('pro') || /^pro$/i.test(name)) return 'Pro';
  if (slug.includes('starter') || /starter/i.test(name)) return 'Starter';
  if (name) return name;
  return 'Starter';
}

function computeMrr(tenant, plan, subscription) {
  const uiStatus = toUiStatus(tenant.status);
  if (uiStatus === 'trial' || uiStatus === 'suspended') return 0;
  if (!plan?.pricing) return 0;

  const interval = subscription?.interval || BILLING_INTERVALS.MONTHLY;
  if (interval === BILLING_INTERVALS.YEARLY) {
    return Math.round((Number(plan.pricing.yearlyAmount) || 0) / 12);
  }
  return Number(plan.pricing.monthlyAmount) || 0;
}

function toTenantRow(tenant) {
  const owner = tenant.ownerId && typeof tenant.ownerId === 'object' ? tenant.ownerId : null;
  const plan = tenant.planId && typeof tenant.planId === 'object' ? tenant.planId : null;
  const subscription =
    tenant.subscriptionId && typeof tenant.subscriptionId === 'object' ? tenant.subscriptionId : null;

  const seatsTotal =
    tenant.limitOverrides?.seats ||
    plan?.limits?.seats ||
    subscription?.seats ||
    0;

  const storageBytes = Number(tenant.usage?.storageBytes) || 0;

  return {
    id: String(tenant._id),
    name: tenant.name,
    plan: toPlanLabel(plan),
    seatsUsed: Number(tenant.usage?.seatsUsed) || 0,
    seatsTotal,
    status: toUiStatus(tenant.status),
    created: tenant.createdAt ? new Date(tenant.createdAt).toISOString().slice(0, 10) : '',
    mrr: computeMrr(tenant, plan, subscription),
    inspections: Number(tenant.usage?.inspectionsThisPeriod) || 0,
    storageGb: Math.round((storageBytes / (1024 * 1024 * 1024)) * 100) / 100,
    owner: ownerDisplayName(owner),
    ownerEmail: owner?.email || tenant.contact?.email || '',
    region: formatRegion(tenant),
  };
}

async function loadTenantOrThrow(id) {
  const tenant = await Tenant.findById(id)
    .populate('ownerId', 'email profile.firstName profile.lastName')
    .populate('planId')
    .populate('subscriptionId');

  if (!tenant) {
    throw new HttpError(404, 'Tenant not found');
  }
  return tenant;
}

async function listTenants() {
  const tenants = await Tenant.find()
    .sort({ createdAt: -1 })
    .populate('ownerId', 'email profile.firstName profile.lastName')
    .populate('planId')
    .populate('subscriptionId');

  return tenants.map(toTenantRow);
}

async function getTenantById(id) {
  const tenant = await loadTenantOrThrow(id);
  return toTenantRow(tenant);
}

async function suspendTenant(id, actor) {
  const tenant = await loadTenantOrThrow(id);

  if (tenant.status === TENANT_STATUSES.SUSPENDED) {
    return toTenantRow(tenant);
  }

  tenant.status = TENANT_STATUSES.SUSPENDED;
  tenant.suspendedAt = new Date();
  tenant.suspendedReason = tenant.suspendedReason || 'Suspended by platform admin';
  if (actor?._id) {
    tenant.updatedBy = actor._id;
  }
  await tenant.save();

  return toTenantRow(tenant);
}

module.exports = {
  listTenants,
  getTenantById,
  suspendTenant,
};
