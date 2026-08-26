'use strict';

/**
 * Local Stripe billing replaced with live Stripe Checkout + webhook sync.
 * Stripe is source of truth; Mongo mirrors via stripe-sync / webhooks.
 */

const { Plan, Subscription, Tenant, Invoice, User } = require('../models');
const {
  USER_ROLES,
  USER_STATUSES,
  TENANT_STATUSES,
  SUBSCRIPTION_STATUSES,
  BILLING_INTERVALS,
} = require('../models/enums');
const env = require('../config/env');
const HttpError = require('../utils/httpError');
const { toUserResponse } = require('../utils/userResponse');
const { toCompanyResponse } = require('../utils/companyResponse');
const { getStripe, assertStripeConfigured } = require('./stripe.client');
const {
  ensurePlanPricesOnStripe,
  priceIdForInterval,
  syncAllPublicPlansToStripe,
} = require('./stripe-plan.service');
const { syncSubscriptionFromStripe, syncInvoiceFromStripe } = require('./stripe-sync.service');

function normalizeOptionCopy(option = {}, fallbackDescription = '') {
  const bullets = Array.isArray(option.bullets)
    ? option.bullets.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  return {
    priceLabel: String(option.priceLabel || '').trim(),
    description: String(option.description || fallbackDescription || '').trim(),
    bullets,
  };
}

function toPlanResponse(plan) {
  const description = plan.description || '';
  const monthlyAmount = plan.pricing?.monthlyAmount || 0;
  const billingOptions = plan.billingOptions || {};
  const trial = normalizeOptionCopy(billingOptions.trial, description);
  if (!trial.priceLabel) {
    trial.priceLabel = '$0';
  }

  return {
    id: String(plan._id),
    name: plan.name,
    slug: plan.slug,
    description,
    price: monthlyAmount,
    yearlyPrice: plan.pricing?.yearlyAmount || 0,
    currency: plan.pricing?.currency || 'USD',
    trialDays: plan.trialDays || 0,
    limits: plan.limits,
    features: plan.features,
    billingOptions: {
      trial,
      monthly: normalizeOptionCopy(billingOptions.monthly, description),
      annual: normalizeOptionCopy(billingOptions.annual, description),
    },
    highlight: plan.slug === 'pro',
    isActive: plan.isActive !== false,
    isPublic: plan.isPublic !== false,
    stripe: {
      productId: plan.stripe?.productId || '',
      monthlyPriceId: plan.stripe?.monthlyPriceId || '',
      yearlyPriceId: plan.stripe?.yearlyPriceId || '',
    },
  };
}

function toSubscriptionResponse(subscription, plan) {
  if (!subscription) return null;
  return {
    id: String(subscription._id),
    stripeSubscriptionId: subscription.stripeSubscriptionId || '',
    status: subscription.status,
    interval: subscription.interval,
    seats: subscription.seats,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    nextBillingDate: subscription.currentPeriodEnd,
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
    createdAt: invoice.stripeCreatedAt || invoice.createdAt,
  };
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function wantsTestClock() {
  return env.stripeAutoTestClock && String(env.stripeSecretKey || '').startsWith('sk_test');
}

async function ensureStripeCustomer(company, owner, { testClockId } = {}) {
  assertStripeConfigured();
  const stripe = getStripe();
  const needClock = wantsTestClock() || Boolean(testClockId);

  if (company.billing?.stripeCustomerId && !String(company.billing.stripeCustomerId).startsWith('local_')) {
    try {
      const existing = await stripe.customers.retrieve(company.billing.stripeCustomerId);
      if (existing && !existing.deleted) {
        const existingClockId =
          typeof existing.test_clock === 'string'
            ? existing.test_clock
            : existing.test_clock?.id || '';

        // Reuse customer when test-clock requirement is already satisfied.
        if (!needClock || existingClockId) {
          if (!company.billing) company.billing = {};
          if (existingClockId && company.billing.testClockId !== existingClockId) {
            company.billing.testClockId = existingClockId;
            await company.save();
          }
          return existing;
        }
        // Need a clock but this customer has none — create a new clocked customer below.
      }
    } catch {
      // recreate below
    }
  }

  let clockId = testClockId || company.billing?.testClockId || '';
  if (!clockId && needClock) {
    const clock = await stripe.testHelpers.testClocks.create({
      frozen_time: Math.floor(Date.now() / 1000),
      name: `company_${company._id}`,
    });
    clockId = clock.id;
  }

  const params = {
    email: owner.email,
    name: company.name,
    metadata: {
      companyId: String(company._id),
      ownerId: String(owner._id),
    },
  };
  if (clockId) {
    params.test_clock = clockId;
  }

  const customer = await stripe.customers.create(params);
  if (!company.billing) company.billing = {};
  company.billing.stripeCustomerId = customer.id;
  company.billing.email = owner.email;
  if (clockId) company.billing.testClockId = clockId;
  await company.save();
  return customer;
}

async function listPublicPlans() {
  const plans = await Plan.find({ isActive: true, isPublic: true }).sort({ sortOrder: 1, name: 1 });
  return plans.map(toPlanResponse);
}

/**
 * mode: trial | monthly | yearly
 * Creates Stripe Checkout Session; webhooks persist Subscription/Invoice.
 */
async function startSubscription(owner, payload) {
  assertStripeConfigured();
  const company = await requireCompany(owner);

  const activeLocal = await Subscription.findOne({
    companyId: company._id,
    status: { $in: [SUBSCRIPTION_STATUSES.TRIALING, SUBSCRIPTION_STATUSES.ACTIVE] },
  });
  if (activeLocal && !String(activeLocal.stripeSubscriptionId || '').startsWith('local_')) {
    throw new HttpError(409, 'Subscription already active');
  }
  if (company.status === TENANT_STATUSES.TRIAL || company.status === TENANT_STATUSES.ACTIVE) {
    if (company.subscriptionId) {
      const existing = await Subscription.findById(company.subscriptionId);
      if (existing && !String(existing.stripeSubscriptionId || '').startsWith('local_')) {
        throw new HttpError(409, 'Subscription already active');
      }
    }
  }

  let plan = await Plan.findOne({ _id: payload.planId, isActive: true, isPublic: true });
  if (!plan) {
    throw new HttpError(404, 'Plan not found');
  }
  plan = await ensurePlanPricesOnStripe(plan);

  const mode = payload.mode || 'trial';
  const interval =
    mode === 'yearly' || payload.interval === BILLING_INTERVALS.YEARLY
      ? BILLING_INTERVALS.YEARLY
      : BILLING_INTERVALS.MONTHLY;
  const priceId = priceIdForInterval(plan, interval);
  if (!priceId) {
    throw new HttpError(500, 'Stripe price is missing for this plan');
  }

  const trialDays = Number(plan.trialDays) || 0;
  const isTrial = mode === 'trial' && trialDays > 0;

  const customer = await ensureStripeCustomer(company, owner, {
    testClockId: payload.testClockId,
  });

  const stripe = getStripe();
  const metadata = {
    companyId: String(company._id),
    planId: String(plan._id),
    ownerId: String(owner._id),
    mode,
    interval,
  };

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customer.id,
    client_reference_id: String(company._id),
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${env.appUrl}/company/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.appUrl}/onboarding/subscription?checkout=cancelled`,
    metadata,
    subscription_data: {
      metadata,
      ...(isTrial ? { trial_period_days: trialDays } : {}),
    },
    payment_method_collection: 'always',
    allow_promotion_codes: true,
  });

  return {
    checkoutUrl: session.url,
    sessionId: session.id,
    publishableKey: env.stripePublishableKey,
    company: toCompanyResponse(company),
    user: toUserResponse(owner),
  };
}

async function syncInvoicesForCustomer(customerId, companyHint = null) {
  if (!customerId) return [];
  const stripe = getStripe();
  const synced = [];
  let startingAfter;

  // Paginate so renewals never get truncated.
  for (let page = 0; page < 10; page += 1) {
    const listed = await stripe.invoices.list({
      customer: customerId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    for (const invoice of listed.data) {
      let result = await syncInvoiceFromStripe(invoice);
      // If webhook/customer lookup failed, force-save under this company.
      if (!result && companyHint) {
        result = await syncInvoiceFromStripe(invoice, companyHint);
      }
      if (result?.invoice) synced.push(result.invoice);
    }

    if (!listed.has_more || !listed.data.length) break;
    startingAfter = listed.data[listed.data.length - 1].id;
  }

  return synced;
}

/**
 * Pull active Stripe subscriptions for this company's customer into Mongo.
 * Needed when webhooks were missed (common in local dev).
 */
async function syncCompanyFromStripe(company) {
  assertStripeConfigured();
  const customerId = company.billing?.stripeCustomerId;
  if (!customerId || String(customerId).startsWith('local_')) {
    return null;
  }

  const stripe = getStripe();
  const listed = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 10,
    expand: ['data.items.data.price', 'data.default_payment_method'],
  });

  if (!listed.data.length) {
    return null;
  }

  const preferred =
    listed.data.find((row) => ['active', 'trialing', 'past_due'].includes(row.status)) ||
    listed.data[0];

  if (!preferred.metadata?.companyId) {
    await stripe.subscriptions.update(preferred.id, {
      metadata: {
        ...(preferred.metadata || {}),
        companyId: String(company._id),
      },
    });
    const refreshed = await stripe.subscriptions.retrieve(preferred.id, {
      expand: ['items.data.price', 'default_payment_method'],
    });
    const synced = await syncSubscriptionFromStripe(refreshed);
    await syncInvoicesForCustomer(customerId, company);
    return synced;
  }

  const synced = await syncSubscriptionFromStripe(preferred);
  await syncInvoicesForCustomer(customerId, company);
  return synced;
}

async function syncCheckoutSession(owner, sessionId) {
  assertStripeConfigured();
  const company = await requireCompany(owner);
  if (!sessionId || typeof sessionId !== 'string') {
    throw new HttpError(400, 'Checkout session id is required');
  }

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['subscription', 'customer'],
  });

  const sessionCompanyId = session.client_reference_id || session.metadata?.companyId;
  if (sessionCompanyId && String(sessionCompanyId) !== String(company._id)) {
    throw new HttpError(403, 'Checkout session does not belong to this company');
  }

  const customerId =
    typeof session.customer === 'string' ? session.customer : session.customer?.id;
  if (customerId) {
    if (!company.billing) company.billing = {};
    company.billing.stripeCustomerId = customerId;
    await company.save();
  }

  let stripeSub = null;
  if (session.subscription) {
    const subId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
    stripeSub = await stripe.subscriptions.retrieve(subId, {
      expand: ['items.data.price', 'default_payment_method'],
    });
    if (!stripeSub.metadata?.companyId) {
      await stripe.subscriptions.update(subId, {
        metadata: {
          ...(stripeSub.metadata || {}),
          companyId: String(company._id),
          planId: session.metadata?.planId || '',
          ownerId: String(owner._id),
        },
      });
      stripeSub = await stripe.subscriptions.retrieve(subId, {
        expand: ['items.data.price', 'default_payment_method'],
      });
    }
    await syncSubscriptionFromStripe(stripeSub);
  } else {
    await syncCompanyFromStripe(company);
  }

  if (customerId) {
    await syncInvoicesForCustomer(customerId, company);
  }

  return getBillingOverview(owner);
}

async function getBillingOverview(owner) {
  const company = await requireCompany(owner);
  let subscription = company.subscriptionId
    ? await Subscription.findById(company.subscriptionId)
    : await Subscription.findOne({ companyId: company._id }).sort({ createdAt: -1 });

  const hasRealLocalSub =
    subscription?.stripeSubscriptionId &&
    !String(subscription.stripeSubscriptionId).startsWith('local_');

  // Prefer live Stripe status when we have a real subscription id
  if (hasRealLocalSub && env.stripeSecretKey) {
    try {
      const stripe = getStripe();
      const stripeSub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId, {
        expand: ['items.data.price', 'default_payment_method'],
      });
      const synced = await syncSubscriptionFromStripe(stripeSub);
      if (synced) {
        subscription = synced.subscription;
        Object.assign(company, synced.company.toObject?.() || synced.company);
      }
    } catch {
      // keep local mirror if Stripe retrieve fails
    }
  } else if (env.stripeSecretKey) {
    // Webhooks may have been missed — pull from Stripe customer
    try {
      const synced = await syncCompanyFromStripe(company);
      if (synced) {
        subscription = synced.subscription;
        Object.assign(company, synced.company.toObject?.() || synced.company);
      }
    } catch {
      // ignore pull failures; return local state
    }
  }

  // Always mirror ALL Stripe invoices for this customer (renewals included).
  if (env.stripeSecretKey && company.billing?.stripeCustomerId) {
    try {
      await syncInvoicesForCustomer(company.billing.stripeCustomerId, company);
    } catch {
      // non-fatal
    }
  }

  // Reload company after possible sync
  const freshCompany = await Tenant.findById(company._id);
  const workingCompany = freshCompany || company;
  subscription = workingCompany.subscriptionId
    ? await Subscription.findById(workingCompany.subscriptionId)
    : await Subscription.findOne({ companyId: workingCompany._id }).sort({ createdAt: -1 });

  const plan = subscription?.planId
    ? await Plan.findById(subscription.planId)
    : workingCompany.planId
      ? await Plan.findById(workingCompany.planId)
      : null;

  const seatsUsed = await User.countDocuments({
    companyId: workingCompany._id,
    role: {
      $in: [USER_ROLES.INSPECTOR, USER_ROLES.OFFICE_STAFF, USER_ROLES.COMPANY_ADMIN],
    },
  });

  const limits = plan?.limits || {};
  const usage = workingCompany.usage || {};

  return {
    company: toCompanyResponse(workingCompany),
    subscription: toSubscriptionResponse(subscription, plan),
    paymentMethod: {
      brand: workingCompany.billing?.paymentMethod?.brand || '',
      last4: workingCompany.billing?.paymentMethod?.last4 || '',
      expMonth: workingCompany.billing?.paymentMethod?.expMonth || null,
      expYear: workingCompany.billing?.paymentMethod?.expYear || null,
      provider: 'stripe',
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
  assertStripeConfigured();
  const company = await requireCompany(owner);
  const subscription = await Subscription.findById(company.subscriptionId);
  if (
    !subscription ||
    ![SUBSCRIPTION_STATUSES.TRIALING, SUBSCRIPTION_STATUSES.ACTIVE, SUBSCRIPTION_STATUSES.PAST_DUE].includes(
      subscription.status
    )
  ) {
    throw new HttpError(400, 'No active subscription to change');
  }
  if (String(subscription.stripeSubscriptionId || '').startsWith('local_')) {
    throw new HttpError(400, 'Legacy local subscription cannot be changed via Stripe. Start a new Checkout.');
  }

  let plan = await Plan.findOne({ _id: payload.planId, isActive: true, isPublic: true });
  if (!plan) {
    throw new HttpError(404, 'Plan not found');
  }
  plan = await ensurePlanPricesOnStripe(plan);

  const interval = payload.interval || subscription.interval || BILLING_INTERVALS.MONTHLY;
  const priceId = priceIdForInterval(plan, interval);
  if (!priceId) {
    throw new HttpError(500, 'Stripe price is missing for this plan');
  }

  const stripe = getStripe();
  const stripeSub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
  const itemId = stripeSub.items.data[0]?.id;
  if (!itemId) {
    throw new HttpError(500, 'Stripe subscription item missing');
  }

  const updated = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    items: [{ id: itemId, price: priceId }],
    proration_behavior: 'create_prorations',
    metadata: {
      ...(stripeSub.metadata || {}),
      companyId: String(company._id),
      planId: String(plan._id),
      ownerId: String(owner._id),
      interval,
    },
    cancel_at_period_end: false,
  });

  await syncSubscriptionFromStripe(updated);
  return getBillingOverview(owner);
}

async function cancelSubscription(owner, payload = {}) {
  assertStripeConfigured();
  const company = await requireCompany(owner);
  const subscription = await Subscription.findById(company.subscriptionId);
  if (!subscription) {
    throw new HttpError(404, 'Subscription not found');
  }
  if (subscription.status === SUBSCRIPTION_STATUSES.CANCELLED) {
    throw new HttpError(409, 'Subscription already cancelled');
  }

  const stripe = getStripe();
  const immediate = Boolean(payload.immediate);

  if (String(subscription.stripeSubscriptionId || '').startsWith('local_')) {
    subscription.status = SUBSCRIPTION_STATUSES.CANCELLED;
    subscription.cancelledAt = new Date();
    subscription.cancelAtPeriodEnd = false;
    await subscription.save();
    company.status = TENANT_STATUSES.CANCELLED;
    await company.save();
    return getBillingOverview(owner);
  }

  let updated;
  if (immediate) {
    updated = await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
  } else {
    updated = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  }
  await syncSubscriptionFromStripe(updated);
  return getBillingOverview(owner);
}

async function listInvoices(owner) {
  const company = await requireCompany(owner);

  // Stripe is source of truth: pull every invoice for this customer, then read DB.
  if (env.stripeSecretKey && company.billing?.stripeCustomerId) {
    try {
      await syncInvoicesForCustomer(company.billing.stripeCustomerId, company);
    } catch {
      // fall through to whatever is already cached
    }
  }

  const invoices = await Invoice.find({ companyId: company._id })
    .sort({ stripeCreatedAt: -1, paidAt: -1, createdAt: -1 })
    .limit(100);
  return invoices.map(toInvoiceResponse);
}

/**
 * Opens Stripe Customer Portal for payment method / invoices management.
 */
async function createBillingPortalSession(owner) {
  assertStripeConfigured();
  const company = await requireCompany(owner);
  const customer = await ensureStripeCustomer(company, owner);
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customer.id,
    return_url: `${env.appUrl}/company/billing`,
  });
  return { portalUrl: session.url };
}

/** @deprecated use createBillingPortalSession — kept for route compatibility */
async function updatePaymentMethod(owner) {
  return createBillingPortalSession(owner);
}

/**
 * Advance Stripe Test Clock past current period/trial end so Stripe runs
 * real renewal (or trial→paid conversion). Waits until clock is ready, then
 * syncs subscription + invoices from Stripe (webhook-compatible mirror).
 *
 * Note: Stripe renews the SAME subscription id and creates a NEW invoice.
 * It does not create a brand-new subscription object each period.
 */
async function advanceTestClock(owner, { seconds } = {}) {
  assertStripeConfigured();
  const company = await requireCompany(owner);
  let clockId = company.billing?.testClockId;

  // Recover clock id from Stripe customer if missing locally
  if (!clockId && company.billing?.stripeCustomerId) {
    try {
      const stripe = getStripe();
      const customer = await stripe.customers.retrieve(company.billing.stripeCustomerId);
      clockId =
        typeof customer.test_clock === 'string'
          ? customer.test_clock
          : customer.test_clock?.id || '';
      if (clockId) {
        if (!company.billing) company.billing = {};
        company.billing.testClockId = clockId;
        await company.save();
      }
    } catch {
      // ignore
    }
  }

  if (!clockId) {
    throw new HttpError(
      400,
      'No Stripe Test Clock on this company. Enable STRIPE_AUTO_TEST_CLOCK=true and complete a new Checkout so the customer is created on a test clock.'
    );
  }

  const stripe = getStripe();
  const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
  const frozen = clock.frozen_time || Math.floor(Date.now() / 1000);

  let advanceBy = Number(seconds) || 0;
  if (!advanceBy) {
    const subscription = company.subscriptionId
      ? await Subscription.findById(company.subscriptionId)
      : await Subscription.findOne({ companyId: company._id }).sort({ createdAt: -1 });

    const endDate = subscription?.trialEnd || subscription?.currentPeriodEnd;
    if (endDate) {
      // Jump to 1 day after period/trial end so Stripe generates the renewal invoice.
      const target = Math.floor(new Date(endDate).getTime() / 1000) + 60 * 60 * 24;
      advanceBy = Math.max(target - frozen, 60 * 60 * 36); // at least ~1.5 days
    } else {
      advanceBy =
        subscription?.interval === BILLING_INTERVALS.YEARLY
          ? 60 * 60 * 24 * 370
          : 60 * 60 * 24 * 32;
    }
  }

  await stripe.testHelpers.testClocks.advance(clockId, {
    frozen_time: frozen + advanceBy,
  });

  let ready = null;
  for (let attempt = 0; attempt < 45; attempt += 1) {
    ready = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (ready.status === 'ready') break;
    await sleep(1000);
  }

  if (!ready || ready.status !== 'ready') {
    throw new HttpError(504, 'Stripe test clock is still advancing. Wait a few seconds and refresh billing.');
  }

  // Give Stripe a moment to emit invoice/subscription events, then mirror into DB.
  await sleep(1500);
  const freshCompany = await Tenant.findById(company._id);
  await syncCompanyFromStripe(freshCompany || company);

  const overview = await getBillingOverview(owner);
  const invoices = await listInvoices(owner);

  return {
    testClockId: ready.id,
    frozenTime: ready.frozen_time,
    status: ready.status,
    advancedSeconds: advanceBy,
    subscriptionStatus: overview.subscription?.status || null,
    periodStart: overview.subscription?.currentPeriodStart || null,
    periodEnd: overview.subscription?.currentPeriodEnd || null,
    invoiceCount: invoices.length,
    overview,
  };
}

module.exports = {
  listPublicPlans,
  startSubscription,
  getBillingOverview,
  syncCheckoutSession,
  changePlan,
  cancelSubscription,
  listInvoices,
  updatePaymentMethod,
  createBillingPortalSession,
  advanceTestClock,
  syncAllPublicPlansToStripe,
  toPlanResponse,
};
