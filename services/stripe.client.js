'use strict';

const Stripe = require('stripe');
const env = require('../config/env');
const HttpError = require('../utils/httpError');

let stripeClient = null;

function getStripe() {
  if (!env.stripeSecretKey) {
    throw new HttpError(500, 'Stripe secret key is not configured');
  }
  if (!stripeClient) {
    stripeClient = new Stripe(env.stripeSecretKey);
  }
  return stripeClient;
}

function assertStripeConfigured() {
  if (!env.stripeSecretKey) {
    throw new HttpError(500, 'Stripe secret key is not configured');
  }
}

function toCents(amountDollars) {
  return Math.round(Number(amountDollars || 0) * 100);
}

function fromCents(amountCents) {
  return Math.round(Number(amountCents || 0)) / 100;
}

function unixToDate(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000);
}

/**
 * Stripe Basil+ moved billing periods onto SubscriptionItem.
 * SDK default API (2026-07-29.dahlia) no longer returns top-level
 * current_period_start / current_period_end on Subscription.
 */
function extractBillingPeriod(stripeSub) {
  const items = stripeSub?.items?.data || [];
  let startUnix = null;
  let endUnix = null;

  for (const item of items) {
    if (item?.current_period_start != null) {
      startUnix = startUnix == null ? item.current_period_start : Math.min(startUnix, item.current_period_start);
    }
    if (item?.current_period_end != null) {
      endUnix = endUnix == null ? item.current_period_end : Math.max(endUnix, item.current_period_end);
    }
  }

  // Legacy webhook payloads / older API versions
  if (startUnix == null && stripeSub?.current_period_start != null) {
    startUnix = stripeSub.current_period_start;
  }
  if (endUnix == null && stripeSub?.current_period_end != null) {
    endUnix = stripeSub.current_period_end;
  }

  return {
    currentPeriodStart: unixToDate(startUnix),
    currentPeriodEnd: unixToDate(endUnix),
  };
}

module.exports = {
  getStripe,
  assertStripeConfigured,
  toCents,
  fromCents,
  unixToDate,
  extractBillingPeriod,
};
