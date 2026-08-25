'use strict';

const { Tenant, Subscription, Invoice, Plan, User } = require('../models');
const {
  TENANT_STATUSES,
  SUBSCRIPTION_STATUSES,
  BILLING_INTERVALS,
  INVOICE_STATUSES,
  USER_STATUSES,
} = require('../models/enums');
const { getStripe, fromCents, unixToDate, extractBillingPeriod } = require('./stripe.client');
const { findPlanByStripePriceId } = require('./stripe-plan.service');

function mapStripeSubscriptionStatus(status) {
  switch (status) {
    case 'trialing':
      return SUBSCRIPTION_STATUSES.TRIALING;
    case 'active':
      return SUBSCRIPTION_STATUSES.ACTIVE;
    case 'past_due':
      return SUBSCRIPTION_STATUSES.PAST_DUE;
    case 'unpaid':
      return SUBSCRIPTION_STATUSES.UNPAID;
    case 'incomplete':
    case 'incomplete_expired':
      return SUBSCRIPTION_STATUSES.INCOMPLETE;
    case 'canceled':
      return SUBSCRIPTION_STATUSES.CANCELLED;
    default:
      return SUBSCRIPTION_STATUSES.INCOMPLETE;
  }
}

function mapTenantStatusFromSubscription(status) {
  switch (status) {
    case SUBSCRIPTION_STATUSES.TRIALING:
      return TENANT_STATUSES.TRIAL;
    case SUBSCRIPTION_STATUSES.ACTIVE:
      return TENANT_STATUSES.ACTIVE;
    case SUBSCRIPTION_STATUSES.PAST_DUE:
    case SUBSCRIPTION_STATUSES.UNPAID:
      return TENANT_STATUSES.PAST_DUE;
    case SUBSCRIPTION_STATUSES.CANCELLED:
      return TENANT_STATUSES.CANCELLED;
    case SUBSCRIPTION_STATUSES.INCOMPLETE:
      return TENANT_STATUSES.PENDING_SUBSCRIPTION;
    default:
      return TENANT_STATUSES.PENDING_SUBSCRIPTION;
  }
}

function mapInvoiceStatus(status) {
  const allowed = new Set(Object.values(INVOICE_STATUSES));
  if (allowed.has(status)) return status;
  return INVOICE_STATUSES.OPEN;
}

function intervalFromStripe(stripeSub) {
  const recurring = stripeSub.items?.data?.[0]?.price?.recurring;
  if (recurring?.interval === 'year') return BILLING_INTERVALS.YEARLY;
  return BILLING_INTERVALS.MONTHLY;
}

async function findCompanyForStripeCustomer(customerId, metadata = {}) {
  if (metadata.companyId) {
    const byMeta = await Tenant.findById(metadata.companyId);
    if (byMeta) return byMeta;
  }
  if (customerId) {
    const byCustomer = await Tenant.findOne({ 'billing.stripeCustomerId': customerId });
    if (byCustomer) return byCustomer;
  }
  return null;
}

async function applyCardToCompany(company, paymentMethod) {
  if (!paymentMethod) return false;
  const stripe = getStripe();
  let pm = paymentMethod;
  if (typeof pm === 'string') {
    pm = await stripe.paymentMethods.retrieve(pm);
  }
  if (!pm?.card) return false;

  if (!company.billing) company.billing = {};
  company.billing.paymentMethod = {
    brand: pm.card.brand || '',
    last4: pm.card.last4 || '',
    expMonth: pm.card.exp_month || null,
    expYear: pm.card.exp_year || null,
  };
  return true;
}

/**
 * Resolve card on file from:
 * 1) subscription default_payment_method (Checkout usually sets this)
 * 2) customer invoice_settings.default_payment_method
 * 3) first attached card on the customer
 */
async function syncPaymentMethodFromCustomer(company, customerId, preferredPaymentMethod = null) {
  if (!customerId) return company;
  const stripe = getStripe();

  if (!company.billing) company.billing = {};
  company.billing.stripeCustomerId = customerId;

  if (await applyCardToCompany(company, preferredPaymentMethod)) {
    const pmId =
      typeof preferredPaymentMethod === 'string'
        ? preferredPaymentMethod
        : preferredPaymentMethod?.id;
    if (pmId) {
      try {
        await stripe.customers.update(customerId, {
          invoice_settings: { default_payment_method: pmId },
        });
      } catch {
        // non-fatal
      }
    }
    return company;
  }

  const customer = await stripe.customers.retrieve(customerId, {
    expand: ['invoice_settings.default_payment_method'],
  });
  if (!customer || customer.deleted) return company;
  if (customer.email) company.billing.email = customer.email;

  if (await applyCardToCompany(company, customer.invoice_settings?.default_payment_method)) {
    return company;
  }

  const attached = await stripe.paymentMethods.list({
    customer: customerId,
    type: 'card',
    limit: 1,
  });
  if (attached.data[0]) {
    await applyCardToCompany(company, attached.data[0]);
    try {
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: attached.data[0].id },
      });
    } catch {
      // non-fatal
    }
  }

  return company;
}

async function resolvePlanForSubscription(stripeSub, metadata = {}) {
  if (metadata.planId) {
    const byId = await Plan.findById(metadata.planId);
    if (byId) return byId;
  }
  const priceId = stripeSub.items?.data?.[0]?.price?.id;
  return findPlanByStripePriceId(priceId);
}

/**
 * Upsert local Subscription + Tenant from a Stripe Subscription object.
 * Idempotent on stripeSubscriptionId.
 */
async function syncSubscriptionFromStripe(stripeSub) {
  const customerId = typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer?.id;
  const metadata = stripeSub.metadata || {};
  const company = await findCompanyForStripeCustomer(customerId, metadata);
  if (!company) {
    return null;
  }

  const plan = await resolvePlanForSubscription(stripeSub, metadata);
  const status = mapStripeSubscriptionStatus(stripeSub.status);
  const interval = intervalFromStripe(stripeSub);
  const { currentPeriodStart, currentPeriodEnd } = extractBillingPeriod(stripeSub);

  let subscription = await Subscription.findOne({ stripeSubscriptionId: stripeSub.id });
  if (!subscription) {
    if (!currentPeriodStart || !currentPeriodEnd) {
      throw new Error(
        `Stripe subscription ${stripeSub.id} is missing billing period fields on items`
      );
    }
    subscription = new Subscription({
      companyId: company._id,
      planId: plan?._id || company.planId,
      stripeCustomerId: customerId || company.billing?.stripeCustomerId || `pending_${company._id}`,
      stripeSubscriptionId: stripeSub.id,
      status,
      interval,
      seats: plan?.limits?.seats || 1,
      currentPeriodStart,
      currentPeriodEnd,
    });
  }

  subscription.companyId = company._id;
  if (plan) subscription.planId = plan._id;
  subscription.stripeCustomerId = customerId || subscription.stripeCustomerId;
  subscription.status = status;
  subscription.interval = interval;
  if (plan?.limits?.seats) subscription.seats = plan.limits.seats;
  // Always overwrite from Stripe when present — never keep stale local period.
  if (currentPeriodStart) subscription.currentPeriodStart = currentPeriodStart;
  if (currentPeriodEnd) subscription.currentPeriodEnd = currentPeriodEnd;
  subscription.cancelAtPeriodEnd = Boolean(stripeSub.cancel_at_period_end);
  subscription.cancelledAt = unixToDate(stripeSub.canceled_at);
  subscription.trialStart = unixToDate(stripeSub.trial_start);
  subscription.trialEnd = unixToDate(stripeSub.trial_end);
  subscription.defaultPaymentMethodId =
    typeof stripeSub.default_payment_method === 'string'
      ? stripeSub.default_payment_method
      : stripeSub.default_payment_method?.id || subscription.defaultPaymentMethodId || '';
  await subscription.save();

  await syncPaymentMethodFromCustomer(company, customerId, stripeSub.default_payment_method);
  if (plan) company.planId = plan._id;
  company.subscriptionId = subscription._id;
  company.status = mapTenantStatusFromSubscription(status);
  company.trialEndsAt = subscription.trialEnd;
  if (status === SUBSCRIPTION_STATUSES.CANCELLED || status === SUBSCRIPTION_STATUSES.UNPAID) {
    company.suspendedAt = company.suspendedAt || new Date();
  } else if (status === SUBSCRIPTION_STATUSES.ACTIVE || status === SUBSCRIPTION_STATUSES.TRIALING) {
    company.suspendedAt = null;
    company.suspendedReason = '';
  }
  company.usage = {
    ...(company.usage?.toObject?.() || company.usage || {}),
    periodStart: subscription.currentPeriodStart,
    periodEnd: subscription.currentPeriodEnd,
  };
  if (!company.billing) company.billing = {};
  company.billing.stripeCustomerId = customerId || company.billing.stripeCustomerId;
  await company.save();

  if (company.ownerId && (status === SUBSCRIPTION_STATUSES.ACTIVE || status === SUBSCRIPTION_STATUSES.TRIALING)) {
    await User.findByIdAndUpdate(company.ownerId, { status: USER_STATUSES.ACTIVE });
  }

  return { company, subscription, plan };
}

function invoiceSubscriptionId(stripeInvoice) {
  if (!stripeInvoice) return '';
  if (typeof stripeInvoice.subscription === 'string') return stripeInvoice.subscription;
  if (stripeInvoice.subscription?.id) return stripeInvoice.subscription.id;
  const parentSub = stripeInvoice.parent?.subscription_details?.subscription;
  if (typeof parentSub === 'string') return parentSub;
  if (parentSub?.id) return parentSub.id;
  return '';
}

function invoiceNeedsBillingMetadata(stripeInvoice) {
  const meta = stripeInvoice?.metadata || {};
  return !meta.companyId || !meta.planId;
}

/**
 * Stripe does not copy subscription.metadata onto invoice.metadata (Dashboard
 * "Metadata"). Copy billing ids onto the invoice so Dashboard + webhooks see them.
 * Safe to call repeatedly; only updates when companyId/planId are missing.
 */
async function ensureInvoiceMetadata(stripeInvoice, companyHint = null) {
  if (!stripeInvoice?.id || !invoiceNeedsBillingMetadata(stripeInvoice)) {
    return stripeInvoice;
  }

  const stripe = getStripe();
  const customerId =
    typeof stripeInvoice.customer === 'string' ? stripeInvoice.customer : stripeInvoice.customer?.id;
  const stripeSubscriptionId = invoiceSubscriptionId(stripeInvoice);

  let sourceMeta = {
    ...(stripeInvoice.parent?.subscription_details?.metadata || {}),
  };

  if (stripeSubscriptionId) {
    try {
      const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
      sourceMeta = { ...sourceMeta, ...(stripeSub.metadata || {}) };
    } catch {
      // fall through to customer / company hint
    }
  }

  if ((!sourceMeta.companyId || !sourceMeta.ownerId) && customerId) {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (customer && !customer.deleted) {
        sourceMeta = { ...sourceMeta, ...(customer.metadata || {}) };
      }
    } catch {
      // ignore
    }
  }

  let company =
    companyHint ||
    (await findCompanyForStripeCustomer(customerId, sourceMeta));
  if (!company && stripeSubscriptionId) {
    const localSub = await Subscription.findOne({ stripeSubscriptionId });
    if (localSub) {
      company = await Tenant.findById(localSub.companyId);
      if (company && localSub.planId && !sourceMeta.planId) {
        sourceMeta.planId = String(localSub.planId);
      }
      if (company && localSub.interval && !sourceMeta.interval) {
        sourceMeta.interval = localSub.interval;
        sourceMeta.mode = sourceMeta.mode || localSub.interval;
      }
    }
  }

  const nextMeta = {
    ...(stripeInvoice.metadata || {}),
  };
  if (sourceMeta.companyId) nextMeta.companyId = String(sourceMeta.companyId);
  else if (company) nextMeta.companyId = String(company._id);

  if (sourceMeta.planId) nextMeta.planId = String(sourceMeta.planId);
  else if (company?.planId) nextMeta.planId = String(company.planId);

  if (sourceMeta.ownerId) nextMeta.ownerId = String(sourceMeta.ownerId);
  else if (company?.ownerId) nextMeta.ownerId = String(company.ownerId);

  if (sourceMeta.interval) nextMeta.interval = String(sourceMeta.interval);
  if (sourceMeta.mode) nextMeta.mode = String(sourceMeta.mode);

  if (!nextMeta.companyId) {
    return stripeInvoice;
  }

  try {
    return await stripe.invoices.update(stripeInvoice.id, { metadata: nextMeta });
  } catch {
    return stripeInvoice;
  }
}

/**
 * Upsert local Invoice from a Stripe Invoice object.
 * @param {object} stripeInvoice
 * @param {object} [companyHint] optional Tenant doc when customer lookup fails
 */
async function syncInvoiceFromStripe(stripeInvoice, companyHint = null) {
  const enriched = await ensureInvoiceMetadata(stripeInvoice, companyHint);
  const working = enriched || stripeInvoice;

  const customerId =
    typeof working.customer === 'string' ? working.customer : working.customer?.id;
  const stripeSubscriptionId = invoiceSubscriptionId(working);

  let company =
    companyHint ||
    (await findCompanyForStripeCustomer(customerId, working.metadata || {}));
  if (!company && stripeSubscriptionId) {
    const localSub = await Subscription.findOne({ stripeSubscriptionId });
    if (localSub) company = await Tenant.findById(localSub.companyId);
  }
  if (!company) return null;

  const payload = {
    companyId: company._id,
    stripeInvoiceId: working.id,
    stripeSubscriptionId: stripeSubscriptionId || '',
    number: working.number || '',
    status: mapInvoiceStatus(working.status),
    currency: String(working.currency || 'usd').toUpperCase(),
    subtotal: fromCents(working.subtotal),
    tax: fromCents(working.tax || 0),
    total: fromCents(working.total),
    amountPaid: fromCents(working.amount_paid),
    amountDue: fromCents(working.amount_due),
    periodStart: unixToDate(working.period_start),
    periodEnd: unixToDate(working.period_end),
    hostedInvoiceUrl: working.hosted_invoice_url || '',
    pdfUrl: working.invoice_pdf || '',
    paidAt: unixToDate(working.status_transitions?.paid_at),
    dueDate: unixToDate(working.due_date),
    attemptCount: working.attempt_count || 0,
    nextPaymentAttemptAt: unixToDate(working.next_payment_attempt),
    stripeCreatedAt: unixToDate(working.created),
  };

  const invoice = await Invoice.findOneAndUpdate(
    { stripeInvoiceId: working.id },
    { $set: payload },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return { company, invoice };
}

async function syncCustomerFromStripe(stripeCustomer) {
  if (!stripeCustomer?.id || stripeCustomer.deleted) return null;
  const company = await findCompanyForStripeCustomer(stripeCustomer.id, stripeCustomer.metadata || {});
  if (!company) return null;
  await syncPaymentMethodFromCustomer(company, stripeCustomer.id);
  await company.save();
  return company;
}

module.exports = {
  mapStripeSubscriptionStatus,
  mapTenantStatusFromSubscription,
  syncSubscriptionFromStripe,
  syncInvoiceFromStripe,
  ensureInvoiceMetadata,
  syncCustomerFromStripe,
  syncPaymentMethodFromCustomer,
  findCompanyForStripeCustomer,
};
