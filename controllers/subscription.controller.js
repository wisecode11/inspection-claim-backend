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

  overview: asyncHandler(async (req, res) => {
    const data = await subscriptionService.getBillingOverview(req.user);
    res.status(200).json({
      success: true,
      message: 'Billing loaded',
      data,
    });
  }),

  changePlan: asyncHandler(async (req, res) => {
    const data = await subscriptionService.changePlan(req.user, req.body);
    res.status(200).json({
      success: true,
      message: 'Subscription updated',
      data,
    });
  }),

  cancel: asyncHandler(async (req, res) => {
    const data = await subscriptionService.cancelSubscription(req.user, req.body);
    res.status(200).json({
      success: true,
      message: 'Subscription cancelled',
      data,
    });
  }),

  invoices: asyncHandler(async (req, res) => {
    const invoices = await subscriptionService.listInvoices(req.user);
    res.status(200).json({
      success: true,
      message: 'Invoices fetched',
      data: { invoices },
    });
  }),

  paymentMethod: asyncHandler(async (req, res) => {
    const data = await subscriptionService.updatePaymentMethod(req.user, req.body);
    res.status(200).json({
      success: true,
      message: 'Payment method updated',
      data,
    });
  }),
};

module.exports = subscriptionController;
