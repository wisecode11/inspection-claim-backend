'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { constructEvent, handleStripeEvent } = require('../services/stripe-webhook.service');

const stripeController = {
  webhook: asyncHandler(async (req, res) => {
    const signature = req.headers['stripe-signature'];
    const event = constructEvent(req.body, signature);
    const result = await handleStripeEvent(event);
    res.status(200).json({ received: true, ...result });
  }),
};

module.exports = stripeController;
