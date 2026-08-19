'use strict';

const mongoose = require('mongoose');
const { Plan, Subscription, Tenant } = require('../models');
const {
  USER_STATUSES,
  TENANT_STATUSES,
  SUBSCRIPTION_STATUSES,
  BILLING_INTERVALS,
} = require('../models/enums');
const HttpError = require('../utils/httpError');
const { toUserResponse } = require('../utils/userResponse');
const { toCompanyResponse } = require('../utils/companyResponse');
const tokenService = require('./token.service');

function toPlanResponse(plan) {
  return {
    id: String(plan._id),
    name: plan.name,
    slug: plan.slug,
    description: plan.description || '',
    price: plan.pricing?.monthlyAmount || 0,
    yearlyPrice: plan.pricing?.yearlyAmount || 0,
    currency: plan.pricing?.currency || 'USD',
    trialDays: plan.trialDays || 0,
    limits: plan.limits,
    features: plan.features,
    highlight: plan.slug === 'pro',
  };
}

async function listPublicPlans() {
  const plans = await Plan.find({ isActive: true, isPublic: true }).sort({ sortOrder: 1, name: 1 });
  return plans.map(toPlanResponse);
}

async function startSubscription(owner, payload, meta = {}) {
  if (!owner.companyId) {
    throw new HttpError(400, 'Create an organization first');
  }

  const company = await Tenant.findById(owner.companyId);
  if (!company) {
    throw new HttpError(404, 'Organization not found');
  }
  if (company.status === TENANT_STATUSES.TRIAL || company.status === TENANT_STATUSES.ACTIVE) {
    throw new HttpError(409, 'Subscription already active');
  }

  const plan = await Plan.findOne({ _id: payload.planId, isActive: true, isPublic: true });
  if (!plan) {
    throw new HttpError(404, 'Plan not found');
  }

  const now = new Date();
  const trialDays = Number(plan.trialDays) || 0;
  const periodDays = payload.interval === BILLING_INTERVALS.YEARLY ? 365 : 30;
  const periodEnd = new Date(now.getTime() + (trialDays || periodDays) * 24 * 60 * 60 * 1000);
  const isTrial = trialDays > 0;

  const subscription = await Subscription.create({
    companyId: company._id,
    planId: plan._id,
    stripeCustomerId: `local_cus_${company._id}`,
    stripeSubscriptionId: `local_sub_${new mongoose.Types.ObjectId()}`,
    status: isTrial ? SUBSCRIPTION_STATUSES.TRIALING : SUBSCRIPTION_STATUSES.ACTIVE,
    interval: payload.interval || BILLING_INTERVALS.MONTHLY,
    seats: plan.limits?.seats || 1,
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    trialStart: isTrial ? now : null,
    trialEnd: isTrial ? periodEnd : null,
    createdBy: owner._id,
  });

  company.planId = plan._id;
  company.subscriptionId = subscription._id;
  company.status = isTrial ? TENANT_STATUSES.TRIAL : TENANT_STATUSES.ACTIVE;
  company.trialEndsAt = isTrial ? periodEnd : null;
  company.billing.email = owner.email;
  await company.save();

  owner.status = USER_STATUSES.ACTIVE;
  await owner.save();

  return {
    user: toUserResponse(owner),
    company: toCompanyResponse(company),
    tokens: await tokenService.issueTokenPair(owner, meta),
  };
}

module.exports = { listPublicPlans, startSubscription };
