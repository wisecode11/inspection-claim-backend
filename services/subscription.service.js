'use strict';

const mongoose = require('mongoose');
const { Plan, Subscription, Tenant, Invoice, User } = require('../models');
const {
  USER_ROLES,
  USER_STATUSES,
  TENANT_STATUSES,
  SUBSCRIPTION_STATUSES,
  BILLING_INTERVALS,
  INVOICE_STATUSES,
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

function toSubscriptionResponse(subscription, plan) {
  if (!subscription) return null;
  return {
    id: String(subscription._id),
    status: subscription.status,
    interval: subscription.interval,
    seats: subscription.seats,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    trialStart: subscription.trialStart,
    trialEnd: subscription.trialEnd,
    cancelAtPeriodEnd: Boolean(subscription.cancelAtPeriodEnd),
    cancelledAt: subscription.cancelledAt,
    plan: plan ? toPlanResponse(plan) : null,
  };
}

function toInvoiceResponse(invoice) {
  return {
    id: String(invoice._id),
    number: invoice.number || '',
    status: invoice.status,
    currency: invoice.currency || 'USD',
    total: invoice.total || 0,
    amountPaid: invoice.amountPaid || 0,
    amountDue: invoice.amountDue || 0,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    paidAt: invoice.paidAt,
    dueDate: invoice.dueDate,
    hostedInvoiceUrl: invoice.hostedInvoiceUrl || '',
    pdfUrl: invoice.pdfUrl || '',
    createdAt: invoice.createdAt,
  };
}

function periodDaysForInterval(interval) {
  return interval === BILLING_INTERVALS.YEARLY ? 365 : 30;
}

function amountForPlan(plan, interval) {
  if (interval === BILLING_INTERVALS.YEARLY) {
    return Number(plan.pricing?.yearlyAmount) || 0;
  }
  return Number(plan.pricing?.monthlyAmount) || 0;
}

async function requireCompany(owner) {
  if (!owner.companyId) {
    throw new HttpError(400, 'Create an organization first');
  }
  const company = await Tenant.findById(owner.companyId);
  if (!company) {
    throw new HttpError(404, 'Organization not found');
  }
  return company;
}

async function createInvoice({ company, subscription, plan, amount, status, now }) {
  const invoice = await Invoice.create({
    companyId: company._id,
    stripeInvoiceId: `local_inv_${new mongoose.Types.ObjectId()}`,
    stripeSubscriptionId: subscription.stripeSubscriptionId,
    number: `INV-${Date.now().toString().slice(-8)}`,
    status,
    currency: plan.pricing?.currency || 'USD',
    subtotal: amount,
    tax: 0,
    total: amount,
    amountPaid: status === INVOICE_STATUSES.PAID ? amount : 0,
    amountDue: status === INVOICE_STATUSES.PAID ? 0 : amount,
    periodStart: subscription.currentPeriodStart,
    periodEnd: subscription.currentPeriodEnd,
    paidAt: status === INVOICE_STATUSES.PAID ? now : null,
    dueDate: subscription.currentPeriodEnd,
    attemptCount: status === INVOICE_STATUSES.PAID ? 1 : 0,
  });
  return invoice;
}

async function listPublicPlans() {
  const plans = await Plan.find({ isActive: true, isPublic: true }).sort({ sortOrder: 1, name: 1 });
  return plans.map(toPlanResponse);
}

/**
 * mode: trial | monthly | yearly
 * Local Stripe billing (no live Stripe keys required yet).
 */
async function startSubscription(owner, payload, meta = {}) {
  const company = await requireCompany(owner);

  if (company.status === TENANT_STATUSES.TRIAL || company.status === TENANT_STATUSES.ACTIVE) {
    throw new HttpError(409, 'Subscription already active');
  }

  const existingSubscription = await Subscription.findOne({
    companyId: company._id,
    status: { $in: [SUBSCRIPTION_STATUSES.TRIALING, SUBSCRIPTION_STATUSES.ACTIVE] },
  });
  if (existingSubscription) {
    throw new HttpError(409, 'Subscription already active for this company');
  }

  const plan = await Plan.findOne({ _id: payload.planId, isActive: true, isPublic: true });
  if (!plan) {
    throw new HttpError(404, 'Plan not found');
  }

  const mode = payload.mode || 'trial';
  const interval =
    mode === 'yearly' ? BILLING_INTERVALS.YEARLY : BILLING_INTERVALS.MONTHLY;
  const now = new Date();
  const trialDays = Number(plan.trialDays) || 0;
  const isTrial = mode === 'trial' && trialDays > 0;
  const days = isTrial ? trialDays : periodDaysForInterval(interval);
  const periodEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const amount = isTrial ? 0 : amountForPlan(plan, interval);

  const subscription = await Subscription.create({
    companyId: company._id,
    planId: plan._id,
    stripeCustomerId: company.billing?.stripeCustomerId || `local_cus_${company._id}`,
    stripeSubscriptionId: `local_sub_${new mongoose.Types.ObjectId()}`,
    status: isTrial ? SUBSCRIPTION_STATUSES.TRIALING : SUBSCRIPTION_STATUSES.ACTIVE,
    interval,
    seats: plan.limits?.seats || 1,
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    trialStart: isTrial ? now : null,
    trialEnd: isTrial ? periodEnd : null,
    defaultPaymentMethodId: company.billing?.stripeCustomerId ? 'local_pm_card' : '',
    createdBy: owner._id,
  });

  await createInvoice({
    company,
    subscription,
    plan,
    amount,
    status: INVOICE_STATUSES.PAID,
    now,
  });

  if (!company.billing) company.billing = {};
  company.billing.stripeCustomerId = subscription.stripeCustomerId;
  company.billing.email = owner.email;
  company.planId = plan._id;
  company.subscriptionId = subscription._id;
  company.status = isTrial ? TENANT_STATUSES.TRIAL : TENANT_STATUSES.ACTIVE;
  company.trialEndsAt = isTrial ? periodEnd : null;
  company.usage = {
    ...(company.usage?.toObject?.() || company.usage || {}),
    seatsUsed: company.usage?.seatsUsed || 1,
    periodStart: now,
    periodEnd,
  };
  await company.save();

  owner.status = USER_STATUSES.ACTIVE;
  await owner.save();

  return {
    user: toUserResponse(owner),
    company: toCompanyResponse(company),
    tokens: await tokenService.issueTokenPair(owner, meta),
  };
}

async function getBillingOverview(owner) {
  const company = await requireCompany(owner);
  const subscription = company.subscriptionId
    ? await Subscription.findById(company.subscriptionId)
    : await Subscription.findOne({ companyId: company._id }).sort({ createdAt: -1 });
  const plan = subscription?.planId
    ? await Plan.findById(subscription.planId)
    : company.planId
      ? await Plan.findById(company.planId)
      : null;

  const seatsUsed = await User.countDocuments({
    companyId: company._id,
    role: {
      $in: [USER_ROLES.INSPECTOR, USER_ROLES.OFFICE_STAFF, USER_ROLES.COMPANY_ADMIN],
    },
  });

  const limits = plan?.limits || {};
  const usage = company.usage || {};

  return {
    company: toCompanyResponse(company),
    subscription: toSubscriptionResponse(subscription, plan),
    paymentMethod: {
      brand: company.billing?.paymentMethod?.brand || '',
      last4: company.billing?.paymentMethod?.last4 || '',
      expMonth: company.billing?.paymentMethod?.expMonth || null,
      expYear: company.billing?.paymentMethod?.expYear || null,
      provider: 'stripe_local',
    },
    usage: {
      seatsUsed,
      seatsLimit: limits.seats || 0,
      inspectionsThisPeriod: usage.inspectionsThisPeriod || 0,
      inspectionsLimit: limits.inspectionsPerMonth || 0,
      reportsThisPeriod: usage.reportsThisPeriod || 0,
      reportsLimit: limits.reportsPerMonth || 0,
      storageBytes: usage.storageBytes || 0,
      storageGbLimit: limits.storageGb || 0,
      periodStart: usage.periodStart || subscription?.currentPeriodStart || null,
      periodEnd: usage.periodEnd || subscription?.currentPeriodEnd || null,
    },
  };
}

async function changePlan(owner, payload) {
  const company = await requireCompany(owner);
  const subscription = await Subscription.findById(company.subscriptionId);
  if (!subscription || ![SUBSCRIPTION_STATUSES.TRIALING, SUBSCRIPTION_STATUSES.ACTIVE].includes(subscription.status)) {
    throw new HttpError(400, 'No active subscription to change');
  }

  const plan = await Plan.findOne({ _id: payload.planId, isActive: true, isPublic: true });
  if (!plan) {
    throw new HttpError(404, 'Plan not found');
  }

  const interval = payload.interval || subscription.interval || BILLING_INTERVALS.MONTHLY;
  const now = new Date();
  const periodEnd = new Date(now.getTime() + periodDaysForInterval(interval) * 24 * 60 * 60 * 1000);
  const amount = amountForPlan(plan, interval);

  subscription.planId = plan._id;
  subscription.interval = interval;
  subscription.seats = plan.limits?.seats || subscription.seats;
  subscription.status = SUBSCRIPTION_STATUSES.ACTIVE;
  subscription.currentPeriodStart = now;
  subscription.currentPeriodEnd = periodEnd;
  subscription.trialStart = null;
  subscription.trialEnd = null;
  subscription.cancelAtPeriodEnd = false;
  subscription.cancelledAt = null;
  subscription.updatedBy = owner._id;
  await subscription.save();

  await createInvoice({
    company,
    subscription,
    plan,
    amount,
    status: INVOICE_STATUSES.PAID,
    now,
  });

  company.planId = plan._id;
  company.status = TENANT_STATUSES.ACTIVE;
  company.trialEndsAt = null;
  company.usage = {
    ...(company.usage?.toObject?.() || company.usage || {}),
    periodStart: now,
    periodEnd,
  };
  await company.save();

  return getBillingOverview(owner);
}

async function cancelSubscription(owner, payload = {}) {
  const company = await requireCompany(owner);
  const subscription = await Subscription.findById(company.subscriptionId);
  if (!subscription) {
    throw new HttpError(404, 'Subscription not found');
  }
  if (subscription.status === SUBSCRIPTION_STATUSES.CANCELLED) {
    throw new HttpError(409, 'Subscription already cancelled');
  }

  const immediate = Boolean(payload.immediate);
  const now = new Date();

  if (immediate) {
    subscription.status = SUBSCRIPTION_STATUSES.CANCELLED;
    subscription.cancelledAt = now;
    subscription.cancelAtPeriodEnd = false;
    company.status = TENANT_STATUSES.CANCELLED;
  } else {
    subscription.cancelAtPeriodEnd = true;
    subscription.cancelledAt = now;
  }
  subscription.updatedBy = owner._id;
  await subscription.save();
  await company.save();

  return getBillingOverview(owner);
}

async function listInvoices(owner) {
  const company = await requireCompany(owner);
  const invoices = await Invoice.find({ companyId: company._id }).sort({ createdAt: -1 }).limit(50);
  return invoices.map(toInvoiceResponse);
}

async function updatePaymentMethod(owner, payload) {
  const company = await requireCompany(owner);
  if (!company.billing) company.billing = {};
  company.billing.paymentMethod = {
    brand: String(payload.brand || 'visa').toLowerCase(),
    last4: String(payload.last4 || '').replace(/\D/g, '').slice(-4),
    expMonth: Number(payload.expMonth) || null,
    expYear: Number(payload.expYear) || null,
  };
  if (!company.billing.stripeCustomerId) {
    company.billing.stripeCustomerId = `local_cus_${company._id}`;
  }
  await company.save();

  if (company.subscriptionId) {
    await Subscription.findByIdAndUpdate(company.subscriptionId, {
      defaultPaymentMethodId: `local_pm_${company.billing.paymentMethod.last4 || 'card'}`,
    });
  }

  return getBillingOverview(owner);
}

module.exports = {
  listPublicPlans,
  startSubscription,
  getBillingOverview,
  changePlan,
  cancelSubscription,
  listInvoices,
  updatePaymentMethod,
};
