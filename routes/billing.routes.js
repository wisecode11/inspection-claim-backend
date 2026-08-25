'use strict';

const { Router } = require('express');
const { USER_ROLES } = require('../models/enums');
const { authenticate, requireRoles } = require('../middlewares/auth.middleware');
const { validateBody } = require('../middlewares/validate.middleware');
const asyncHandler = require('../utils/asyncHandler');
const { Plan, Tenant, Subscription, Invoice } = require('../models');
const subscriptionService = require('../services/subscription.service');
const { ensurePlanPricesOnStripe } = require('../services/stripe-plan.service');
const HttpError = require('../utils/httpError');

const router = Router();

router.use(authenticate, requireRoles(USER_ROLES.PLATFORM_ADMIN));

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const tenants = await Tenant.find().sort({ createdAt: -1 }).limit(200);
    const rows = [];
    for (const tenant of tenants) {
      const subscription = tenant.subscriptionId
        ? await Subscription.findById(tenant.subscriptionId)
        : await Subscription.findOne({ companyId: tenant._id }).sort({ createdAt: -1 });
      const plan = subscription?.planId
        ? await Plan.findById(subscription.planId)
        : tenant.planId
          ? await Plan.findById(tenant.planId)
          : null;
      const latestInvoice = await Invoice.findOne({ companyId: tenant._id }).sort({ createdAt: -1 });
      const hasRealSub =
        Boolean(subscription?.stripeSubscriptionId) &&
        !String(subscription.stripeSubscriptionId).startsWith('local_') &&
        ['trialing', 'active', 'past_due', 'unpaid'].includes(subscription.status);

      rows.push({
        id: String(tenant._id),
        name: tenant.name,
        status: tenant.status,
        plan: hasRealSub && plan ? plan.name : '—',
        mrr:
          hasRealSub && subscription.status === 'active'
            ? plan?.pricing?.monthlyAmount || 0
            : 0,
        subscriptionStatus: hasRealSub ? subscription.status : 'none',
        interval: hasRealSub ? subscription.interval : null,
        currentPeriodEnd: hasRealSub ? subscription.currentPeriodEnd : null,
        stripeCustomerId: tenant.billing?.stripeCustomerId || '',
        stripeSubscriptionId: hasRealSub ? subscription.stripeSubscriptionId : '',
        lastInvoiceStatus: latestInvoice?.status || null,
        lastInvoiceTotal: latestInvoice?.total || 0,
        created: tenant.createdAt,
      });
    }
    res.status(200).json({ success: true, message: 'Billing loaded', data: rows });
  })
);

router.get(
  '/plans',
  asyncHandler(async (_req, res) => {
    const plans = await Plan.find().sort({ sortOrder: 1, name: 1 });
    res.status(200).json({
      success: true,
      message: 'Plans loaded',
      data: plans.map(subscriptionService.toPlanResponse),
    });
  })
);

function planBody(body = {}) {
  if (!body.name || !String(body.name).trim()) {
    throw new HttpError(400, 'Plan name is required');
  }
  const name = String(body.name).trim();
  const slug = String(body.slug || name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!slug) {
    throw new HttpError(400, 'Plan slug is required');
  }

  const monthlyAmount = Number(body.monthlyAmount ?? body.pricing?.monthlyAmount) || 0;
  const yearlyAmount =
    Number(body.yearlyAmount ?? body.pricing?.yearlyAmount) || Math.round(monthlyAmount * 10);

  return {
    name,
    slug,
    description: String(body.description || '').trim(),
    pricing: {
      monthlyAmount,
      yearlyAmount,
      currency: String(body.currency || body.pricing?.currency || 'USD').toUpperCase(),
      perSeat: true,
    },
    trialDays: Number(body.trialDays) || 14,
    limits: {
      seats: Number(body.seats ?? body.limits?.seats) || 5,
      inspectionsPerMonth:
        Number(body.inspectionsPerMonth ?? body.limits?.inspectionsPerMonth) || 500,
      storageGb: Number(body.storageGb ?? body.limits?.storageGb) || 20,
      photosPerInspection: Number(body.limits?.photosPerInspection) || 80,
      reportsPerMonth:
        Number(body.reportsPerMonth ?? body.limits?.reportsPerMonth) ||
        Number(body.inspectionsPerMonth ?? body.limits?.inspectionsPerMonth) ||
        500,
    },
    features: body.features || {
      weatherVerification: true,
      stormMap: false,
      customTemplates: true,
      customChecklists: true,
      analytics: true,
      whatsappShare: true,
      prioritySupport: false,
    },
    isPublic: body.isPublic !== false,
    isActive: body.isActive !== false,
    sortOrder: Number(body.sortOrder) || 0,
  };
}

router.post(
  '/plans',
  validateBody(planBody),
  asyncHandler(async (req, res) => {
    const existing = await Plan.findOne({ slug: req.body.slug });
    if (existing) {
      throw new HttpError(409, 'Plan slug already exists');
    }
    let plan = await Plan.create(req.body);
    plan = await ensurePlanPricesOnStripe(plan);
    res.status(201).json({
      success: true,
      message: 'Plan created and synced to Stripe',
      data: subscriptionService.toPlanResponse(plan),
    });
  })
);

router.post(
  '/plans/sync-stripe',
  asyncHandler(async (_req, res) => {
    const plans = await subscriptionService.syncAllPublicPlansToStripe();
    res.status(200).json({
      success: true,
      message: 'Plans synced to Stripe',
      data: plans.map(subscriptionService.toPlanResponse),
    });
  })
);

router.post(
  '/:id/retry',
  asyncHandler(async (req, res) => {
    // Platform "retry" → open latest open invoice pay link if present
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) throw new HttpError(404, 'Tenant not found');
    const invoice = await Invoice.findOne({
      companyId: tenant._id,
      status: { $in: ['open', 'draft'] },
    }).sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      message: invoice ? 'Open invoice found' : 'No open invoice',
      data: {
        id: String(tenant._id),
        hostedInvoiceUrl: invoice?.hostedInvoiceUrl || '',
      },
    });
  })
);

module.exports = router;
