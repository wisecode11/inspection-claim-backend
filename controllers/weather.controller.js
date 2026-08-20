'use strict';

const asyncHandler = require('../utils/asyncHandler');
const weatherService = require('../services/weather.service');

const weatherController = {
  verify: asyncHandler(async (req, res) => {
    const weather = await weatherService.verifyForJob(req.user, req.body.jobId, {
      force: Boolean(req.body.force),
    });
    res.status(200).json({
      success: true,
      message: 'Weather verification complete',
      data: { weather },
    });
  }),

  getForJob: asyncHandler(async (req, res) => {
    const weather = await weatherService.getForJob(req.user, req.params.jobId);
    res.status(200).json({
      success: true,
      message: 'Weather verification',
      data: { weather },
    });
  }),
};

module.exports = weatherController;
