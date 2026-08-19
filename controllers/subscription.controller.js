'use strict';

const asyncHandler = require('../utils/asyncHandler');
const subscriptionService = require('../services/subscription.service');

function requestMeta(req) {
  return {
    userAgent: req.get('user-agent') || '',
    ip: req.ip || req.connection?.remoteAddress || '',
  };
}

const subscriptionController = {
  listPlans: asyncHandler(async (_req, res) => {
    const data = await subscriptionService.listPlans();
    res.status(200).json({
      success: true,
      message: 'Plans',
      data,
    });
  }),

  start: asyncHandler(async (req, res) => {
    const data = await subscriptionService.startSubscription(req.user, req.body || {}, requestMeta(req));
    res.status(201).json({
      success: true,
      message: 'Trial started',
      data,
    });
  }),
};

module.exports = subscriptionController;
