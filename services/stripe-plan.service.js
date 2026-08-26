'use strict';

const { Plan } = require('../models');
const { getStripe, toCents } = require('./stripe.client');

/**
 * Ensure a local Plan has a Stripe Product + monthly/yearly Prices.
 * Idempotent: reuses existing stripe.* ids when present and amounts still match.
 * Creates replacement prices when amounts change (Stripe prices are immutable).
 */
async function ensurePlanPricesOnStripe(plan) {
  const stripe = getStripe();
  const currency = String(plan.pricing?.currency || 'usd').toLowerCase();
  const monthlyCents = toCents(plan.pricing?.monthlyAmount);
  const yearlyCents = toCents(plan.pricing?.yearlyAmount);

  let productId = plan.stripe?.productId || '';
  if (!productId) {
    const product = await stripe.products.create({
      name: plan.name,
      description: plan.description || undefined,
      active: plan.isActive !== false,
      metadata: {
        planId: String(plan._id),
        slug: plan.slug,
      },
    });
    productId = product.id;
  } else {
    await stripe.products.update(productId, {
      name: plan.name,
      description: plan.description || undefined,
      active: Boolean(plan.isActive),
      metadata: {
        planId: String(plan._id),
        slug: plan.slug,
      },
    });
  }

  let monthlyPriceId = plan.stripe?.monthlyPriceId || '';
  let yearlyPriceId = plan.stripe?.yearlyPriceId || '';

  async function priceStillValid(priceId, unitAmount, interval) {
    if (!priceId) return false;
    try {
      const price = await stripe.prices.retrieve(priceId);
      return (
        price.active !== false &&
        Number(price.unit_amount) === Number(unitAmount) &&
        price.recurring?.interval === interval &&
        price.product === productId
      );
    } catch {
      return false;
    }
  }

  if (!(await priceStillValid(monthlyPriceId, monthlyCents, 'month'))) {
    if (monthlyPriceId) {
      try {
        await stripe.prices.update(monthlyPriceId, { active: false });
      } catch {
        /* ignore archive failures */
      }
    }
    const monthly = await stripe.prices.create({
      product: productId,
      currency,
      unit_amount: monthlyCents,
      recurring: { interval: 'month' },
      metadata: {
        planId: String(plan._id),
        slug: plan.slug,
        interval: 'monthly',
      },
    });
    monthlyPriceId = monthly.id;
  }

  if (!(await priceStillValid(yearlyPriceId, yearlyCents, 'year'))) {
    if (yearlyPriceId) {
      try {
        await stripe.prices.update(yearlyPriceId, { active: false });
      } catch {
        /* ignore archive failures */
      }
    }
    const yearly = await stripe.prices.create({
      product: productId,
      currency,
      unit_amount: yearlyCents,
      recurring: { interval: 'year' },
      metadata: {
        planId: String(plan._id),
        slug: plan.slug,
        interval: 'yearly',
      },
    });
    yearlyPriceId = yearly.id;
  }

  plan.stripe = {
    ...(plan.stripe?.toObject?.() || plan.stripe || {}),
    productId,
    monthlyPriceId,
    yearlyPriceId,
  };
  await plan.save();
  return plan;
}

async function setPlanActiveOnStripe(plan, isActive) {
  const productId = plan.stripe?.productId;
  if (!productId) return plan;
  const stripe = getStripe();
  await stripe.products.update(productId, { active: Boolean(isActive) });
  return plan;
}

/**
 * Archive Stripe product + prices for a deleted plan.
 * Stripe prices/products with history cannot always be hard-deleted.
 */
async function archivePlanOnStripe(plan) {
  const stripe = getStripe();
  const productId = plan.stripe?.productId || '';
  const priceIds = [plan.stripe?.monthlyPriceId, plan.stripe?.yearlyPriceId].filter(Boolean);

  for (const priceId of priceIds) {
    try {
      await stripe.prices.update(priceId, { active: false });
    } catch {
      /* ignore */
    }
  }

  if (productId) {
    try {
      await stripe.products.update(productId, { active: false });
    } catch {
      /* ignore */
    }
  }
}

async function syncAllPublicPlansToStripe() {
  const plans = await Plan.find({ isActive: true });
  const synced = [];
  for (const plan of plans) {
    synced.push(await ensurePlanPricesOnStripe(plan));
  }
  return synced;
}

async function findPlanByStripePriceId(priceId) {
  if (!priceId) return null;
  return Plan.findOne({
    $or: [{ 'stripe.monthlyPriceId': priceId }, { 'stripe.yearlyPriceId': priceId }],
  });
}

function priceIdForInterval(plan, interval) {
  if (interval === 'yearly') return plan.stripe?.yearlyPriceId || '';
  return plan.stripe?.monthlyPriceId || '';
}

module.exports = {
  ensurePlanPricesOnStripe,
  setPlanActiveOnStripe,
  archivePlanOnStripe,
  syncAllPublicPlansToStripe,
  findPlanByStripePriceId,
  priceIdForInterval,
};
