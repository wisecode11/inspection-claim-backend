'use strict';

const HttpError = require('../utils/httpError');
const { BILLING_INTERVALS } = require('../models/enums');

const MODES = new Set(['trial', 'monthly', 'yearly']);

function subscribeBody(body) {
  if (!body.planId || typeof body.planId !== 'string' || !body.planId.trim()) {
    throw new HttpError(400, 'Plan is required');
  }

  const mode = body.mode || 'trial';
  if (!MODES.has(mode)) {
    throw new HttpError(400, 'Invalid billing mode');
  }

  const interval =
    body.interval ||
    (mode === 'yearly' ? BILLING_INTERVALS.YEARLY : BILLING_INTERVALS.MONTHLY);
  if (!Object.values(BILLING_INTERVALS).includes(interval)) {
    throw new HttpError(400, 'Invalid billing interval');
  }

  return {
    planId: body.planId.trim(),
    mode,
    interval,
  };
}

function changePlanBody(body) {
  if (!body.planId || typeof body.planId !== 'string' || !body.planId.trim()) {
    throw new HttpError(400, 'Plan is required');
  }
  const interval = body.interval || BILLING_INTERVALS.MONTHLY;
  if (!Object.values(BILLING_INTERVALS).includes(interval)) {
    throw new HttpError(400, 'Invalid billing interval');
  }
  return {
    planId: body.planId.trim(),
    interval,
  };
}

function cancelBody(body = {}) {
  return {
    immediate: Boolean(body.immediate),
  };
}

function paymentMethodBody(body = {}) {
  const last4 = String(body.last4 || '').replace(/\D/g, '');
  if (last4.length !== 4) {
    throw new HttpError(400, 'Card last 4 digits are required');
  }
  const expMonth = Number(body.expMonth);
  const expYear = Number(body.expYear);
  if (!expMonth || expMonth < 1 || expMonth > 12) {
    throw new HttpError(400, 'Valid expiry month is required');
  }
  if (!expYear || expYear < 2000) {
    throw new HttpError(400, 'Valid expiry year is required');
  }
  return {
    brand: String(body.brand || 'visa').trim().toLowerCase() || 'visa',
    last4,
    expMonth,
    expYear,
  };
}

module.exports = { subscribeBody, changePlanBody, cancelBody, paymentMethodBody };
