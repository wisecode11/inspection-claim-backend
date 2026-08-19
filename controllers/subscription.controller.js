'use strict';

const asyncHandler = require('../utils/asyncHandler');
const subscriptionService = require('../services/subscription.service');

function requestMeta(req) {
  return {
    ip: req.ip || '',
    userAgent: req.get('user-agent') || '',
    platform: 'web',
  };
}

const subscriptionController = {
  listPlans: asyncHandler(async (_req, res) => {
    const plans = await subscriptionService.listPublicPlans();
    res.status(200).json({
      success: true,
      message: 'Plans fetched',
      data: { plans },
    });
  }),

  start: asyncHandler(async (req, res) => {
    const data = await subscriptionService.startSubscription(req.user, req.body, requestMeta(req));
    res.status(201).json({
      success: true,
      message: 'Subscription started',
      data,
    });
  }),
};

module.exports = subscriptionController;
