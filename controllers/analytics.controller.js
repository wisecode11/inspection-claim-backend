'use strict';

const asyncHandler = require('../utils/asyncHandler');
const analyticsService = require('../services/analytics.service');

const analyticsController = {
  company: asyncHandler(async (req, res) => {
    const data = await analyticsService.getCompanyAnalytics(req.user);
    res.status(200).json({
      success: true,
      message: 'Company analytics loaded',
      data,
    });
  }),
};

module.exports = analyticsController;
