'use strict';

const { Plan } = require('../models');
const { getStripe, toCents } = require('./stripe.client');

/**
 * Ensure a local Plan has a Stripe Product + monthly/yearly Prices.
 * Idempotent: reuses existing stripe.* ids when present.
 */
async function ensurePlanPricesOnStripe(plan) {
  const stripe = getStripe();
  const currency = String(plan.pricing?.currency || 'usd').toLowerCase();

  let productId = plan.stripe?.productId || '';
  if (!productId) {
    const product = await stripe.products.create({
      name: plan.name,
      description: plan.description || undefined,
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

  if (!monthlyPriceId) {
    const monthly = await stripe.prices.create({
      product: productId,
      currency,
      unit_amount: toCents(plan.pricing?.monthlyAmount),
      recurring: { interval: 'month' },
      metadata: {
        planId: String(plan._id),
        slug: plan.slug,
        interval: 'monthly',
      },
    });
    monthlyPriceId = monthly.id;
  }

  if (!yearlyPriceId) {
    const yearly = await stripe.prices.create({
      product: productId,
      currency,
      unit_amount: toCents(plan.pricing?.yearlyAmount),
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
  syncAllPublicPlansToStripe,
  findPlanByStripePriceId,
  priceIdForInterval,
};
