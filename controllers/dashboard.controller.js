'use strict';

const asyncHandler = require('../utils/asyncHandler');
const dashboardService = require('../services/dashboard.service');

const dashboardController = {
  company: asyncHandler(async (req, res) => {
    const data = await dashboardService.getCompanyDashboard(req.user);
    res.status(200).json({
      success: true,
      message: 'Dashboard loaded',
      data,
    });
  }),
};

module.exports = dashboardController;
