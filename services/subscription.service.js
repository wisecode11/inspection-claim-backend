'use strict';

const crypto = require('crypto');
const { Plan, Subscription, Tenant } = require('../models');
const { USER_ROLES, SUBSCRIPTION_STATUSES, BILLING_INTERVALS, TENANT_STATUSES } = require('../models/enums');
const HttpError = require('../utils/httpError');
const { issueSession } = require('./auth.service');

const DEFAULT_PLANS = [
  {
    name: 'Starter',
    slug: 'starter',
    description: 'For small crews getting carrier-ready reports in place.',
    pricing: { monthlyAmount: 149, yearlyAmount: 1490, currency: 'USD', perSeat: true },
    trialDays: 14,
    sortOrder: 0,
    limits: {
      seats: 5,
      inspectionsPerMonth: 500,
      storageGb: 20,
      photosPerInspection: 80,
      reportsPerMonth: 500,
    },
    features: {
      weatherVerification: true,
      stormMap: false,
      customTemplates: false,
      customChecklists: false,
      analytics: false,
      whatsappShare: false,
      prioritySupport: false,
    },
  },
  {
    name: 'Pro',
    slug: 'pro',
    description: 'Most popular for growing restoration and roofing companies.',
    pricing: { monthlyAmount: 499, yearlyAmount: 4990, currency: 'USD', perSeat: true },
    trialDays: 14,
    sortOrder: 1,
    limits: {
      seats: 15,
      inspectionsPerMonth: 2500,
      storageGb: 100,
      photosPerInspection: 120,
      reportsPerMonth: 2500,
    },
    features: {
      weatherVerification: true,
      stormMap: true,
      customTemplates: true,
      customChecklists: true,
      analytics: true,
      whatsappShare: true,
      prioritySupport: true,
    },
  },
  {
    name: 'Enterprise',
    slug: 'enterprise',
    description: 'Unlimited volume, SSO-ready audit trail, and dedicated support.',
    pricing: { monthlyAmount: 1499, yearlyAmount: 14990, currency: 'USD', perSeat: true },
    trialDays: 14,
    sortOrder: 2,
    limits: {
      seats: 60,
      inspectionsPerMonth: 0,
      storageGb: 500,
      photosPerInspection: 200,
      reportsPerMonth: 0,
    },
    features: {
      weatherVerification: true,
      stormMap: true,
      customTemplates: true,
      customChecklists: true,
      analytics: true,
      whatsappShare: true,
      prioritySupport: true,
    },
  },
];

function toCatalogPlan(plan) {
  return {
    id: String(plan._id),
    name: plan.name,
    slug: plan.slug,
    description: plan.description || '',
    price: plan.pricing?.monthlyAmount || 0,
    yearlyPrice: plan.pricing?.yearlyAmount || 0,
    currency: plan.pricing?.currency || 'USD',
    trialDays: plan.trialDays || 14,
    highlight: plan.slug === 'pro' || plan.sortOrder === 1,
    limits: {
      seats: plan.limits?.seats ?? 3,
      inspectionsPerMonth: plan.limits?.inspectionsPerMonth ?? 50,
      storageGb: plan.limits?.storageGb ?? 10,
      photosPerInspection: plan.limits?.photosPerInspection ?? 80,
      reportsPerMonth: plan.limits?.reportsPerMonth ?? 50,
    },
    features: {
      weatherVerification: Boolean(plan.features?.weatherVerification),
      stormMap: Boolean(plan.features?.stormMap),
      customTemplates: Boolean(plan.features?.customTemplates),
      customChecklists: Boolean(plan.features?.customChecklists),
      analytics: Boolean(plan.features?.analytics),
      whatsappShare: Boolean(plan.features?.whatsappShare),
      prioritySupport: Boolean(plan.features?.prioritySupport),
    },
  };
}

async function ensureCatalog() {
  const count = await Plan.countDocuments({ isActive: true, isPublic: true });
  if (count > 0) return;
  await Plan.insertMany(
    DEFAULT_PLANS.map((plan) => ({
      ...plan,
      isPublic: true,
      isActive: true,
    }))
  );
}

async function listPlans() {
  await ensureCatalog();
  const plans = await Plan.find({ isActive: true, isPublic: true }).sort({ sortOrder: 1, name: 1 });
  return { plans: plans.map(toCatalogPlan) };
}

function normalizeInterval(interval) {
  const value = String(interval || BILLING_INTERVALS.MONTHLY).toLowerCase();
  return Object.values(BILLING_INTERVALS).includes(value) ? value : BILLING_INTERVALS.MONTHLY;
}

async function startSubscription(user, { planId, interval }, meta = {}) {
  if (user.role !== USER_ROLES.COMPANY_ADMIN) {
    throw new HttpError(403, 'Not allowed for this role');
  }
  if (!user.companyId) {
    throw new HttpError(400, 'Create a company first');
  }
  if (!planId) {
    throw new HttpError(400, 'Plan is required');
  }

  const plan = await Plan.findById(planId);
  if (!plan || !plan.isActive) {
    throw new HttpError(404, 'Plan not found');
  }

  const company = await Tenant.findById(user.companyId);
  if (!company) {
    throw new HttpError(404, 'Company not found');
  }

  const existing = await Subscription.findOne({
    companyId: company._id,
    status: { $in: [SUBSCRIPTION_STATUSES.TRIALING, SUBSCRIPTION_STATUSES.ACTIVE] },
  });
  if (existing) {
    return issueSession(user, meta);
  }

  const now = new Date();
  const trialDays = plan.trialDays || 14;
  const trialEnd = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
  const localCustomerId = `local_cus_${company._id}`;
  const localSubscriptionId = `local_sub_${crypto.randomUUID()}`;

  const subscription = await Subscription.create({
    companyId: company._id,
    planId: plan._id,
    stripeCustomerId: localCustomerId,
    stripeSubscriptionId: localSubscriptionId,
    status: SUBSCRIPTION_STATUSES.TRIALING,
    interval: normalizeInterval(interval),
    seats: plan.limits?.seats || 1,
    currentPeriodStart: now,
    currentPeriodEnd: trialEnd,
    trialStart: now,
    trialEnd,
    createdBy: user._id,
  });

  company.status = TENANT_STATUSES.TRIAL;
  company.subscriptionRequired = true;
  company.planId = plan._id;
  company.subscriptionId = subscription._id;
  company.trialEndsAt = trialEnd;
  company.billing = {
    ...(company.billing ? company.billing.toObject?.() || company.billing : {}),
    stripeCustomerId: localCustomerId,
    email: company.billing?.email || user.email,
  };
  await company.save();

  return issueSession(user, meta);
}

module.exports = {
  listPlans,
  startSubscription,
};
