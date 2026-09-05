'use strict';

const asyncHandler = require('../utils/asyncHandler');
const pushService = require('../services/push.service');

const deviceController = {
  registerPushToken: asyncHandler(async (req, res) => {
    const device = await pushService.registerPushToken(req.user, req.body);
    res.status(200).json({
      success: true,
      message: 'Push token registered',
      data: { device },
    });
  }),

  updatePushPreference: asyncHandler(async (req, res) => {
    const device = await pushService.updatePushPreference(req.user, req.body);
    res.status(200).json({
      success: true,
      message: 'Push preference updated',
      data: { device },
    });
  }),

  clearPushToken: asyncHandler(async (req, res) => {
    const result = await pushService.clearPushToken(req.user, req.body);
    res.status(200).json({
      success: true,
      message: 'Push token cleared',
      data: result,
    });
  }),
};

module.exports = deviceController;