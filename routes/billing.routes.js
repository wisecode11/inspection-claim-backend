'use strict';

const { Router } = require('express');
const { USER_ROLES, SUBSCRIPTION_STATUSES } = require('../models/enums');
const { authenticate, requireRoles } = require('../middlewares/auth.middleware');
const { validateBody } = require('../middlewares/validate.middleware');
const asyncHandler = require('../utils/asyncHandler');
const { Plan, Tenant, Subscription, Invoice } = require('../models');
const subscriptionService = require('../services/subscription.service');
const { ensurePlanPricesOnStripe, setPlanActiveOnStripe, archivePlanOnStripe } = require('../services/stripe-plan.service');
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

  function optionCopy(raw = {}) {
    const bullets = Array.isArray(raw.bullets)
      ? raw.bullets.map((item) => String(item || '').trim()).filter(Boolean)
      : String(raw.bulletsText || '')
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean);
    return {
      priceLabel: String(raw.priceLabel || '').trim(),
      description: String(raw.description || '').trim(),
      bullets,
    };
  }

  const billingOptions = {
    trial: optionCopy(body.billingOptions?.trial || body.trial || {}),
    monthly: optionCopy(body.billingOptions?.monthly || body.monthly || {}),
    annual: optionCopy(body.billingOptions?.annual || body.annual || {}),
  };

  const description =
    String(body.description || '').trim() ||
    billingOptions.monthly.description ||
    billingOptions.trial.description ||
    billingOptions.annual.description ||
    '';

  return {
    name,
    slug,
    description,
    pricing: {
      monthlyAmount,
      yearlyAmount,
      currency: String(body.currency || body.pricing?.currency || 'USD').toUpperCase(),
      perSeat: true,
    },
    billingOptions,
    trialDays: Number(body.trialDays) || 14,
    limits: {
      // High seat cap = effectively unlimited team size (no seats field in admin UI)
      seats: 9999,
      // 0 = unlimited (no inspection / storage caps on plans)
      inspectionsPerMonth: 0,
      storageGb: 0,
      photosPerInspection: Number(body.limits?.photosPerInspection) || 80,
      reportsPerMonth: 0,
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

router.patch(
  '/plans/:id',
  validateBody(planBody),
  asyncHandler(async (req, res) => {
    const plan = await Plan.findById(req.params.id);
    if (!plan) throw new HttpError(404, 'Plan not found');

    const slugTaken = await Plan.findOne({
      slug: req.body.slug,
      _id: { $ne: plan._id },
    });
    if (slugTaken) {
      throw new HttpError(409, 'Plan slug already exists');
    }

    plan.name = req.body.name;
    plan.slug = req.body.slug;
    plan.description = req.body.description;
    plan.pricing = {
      ...(plan.pricing?.toObject?.() || plan.pricing || {}),
      ...req.body.pricing,
    };
    plan.billingOptions = req.body.billingOptions;
    plan.trialDays = req.body.trialDays;
    await plan.save();

    const synced = await ensurePlanPricesOnStripe(plan);
    res.status(200).json({
      success: true,
      message: 'Plan updated and synced to Stripe',
      data: subscriptionService.toPlanResponse(synced),
    });
  })
);

router.patch(
  '/plans/:id/status',
  validateBody((body = {}) => {
    if (typeof body.isActive !== 'boolean') {
      throw new HttpError(400, 'isActive boolean is required');
    }
    return { isActive: body.isActive };
  }),
  asyncHandler(async (req, res) => {
    const plan = await Plan.findById(req.params.id);
    if (!plan) throw new HttpError(404, 'Plan not found');

    plan.isActive = req.body.isActive;
    await plan.save();
    await setPlanActiveOnStripe(plan, plan.isActive);
    if (plan.isActive) {
      await ensurePlanPricesOnStripe(plan);
    }

    res.status(200).json({
      success: true,
      message: plan.isActive ? 'Plan activated' : 'Plan deactivated',
      data: subscriptionService.toPlanResponse(plan),
    });
  })
);

router.delete(
  '/plans/:id',
  asyncHandler(async (req, res) => {
    const plan = await Plan.findById(req.params.id);
    if (!plan) throw new HttpError(404, 'Plan not found');

    const activeSubscribers = await Subscription.countDocuments({
      planId: plan._id,
      status: {
        $in: [
          SUBSCRIPTION_STATUSES.TRIALING,
          SUBSCRIPTION_STATUSES.ACTIVE,
          SUBSCRIPTION_STATUSES.PAST_DUE,
          SUBSCRIPTION_STATUSES.UNPAID,
        ],
      },
    });
    if (activeSubscribers > 0) {
      throw new HttpError(
        400,
        'Cannot delete a plan with active subscribers. Deactivate it instead.',
      );
    }

    await archivePlanOnStripe(plan);
    await Plan.deleteOne({ _id: plan._id });

    res.status(200).json({
      success: true,
      message: 'Plan deleted',
      data: { id: String(plan._id) },
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
