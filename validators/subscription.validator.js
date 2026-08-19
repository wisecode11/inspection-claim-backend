'use strict';

const HttpError = require('../utils/httpError');
const { BILLING_INTERVALS } = require('../models/enums');

function subscribeBody(body) {
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

module.exports = { subscribeBody };
