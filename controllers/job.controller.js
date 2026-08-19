'use strict';

const asyncHandler = require('../utils/asyncHandler');
const jobService = require('../services/job.service');

const jobController = {
  create: asyncHandler(async (req, res) => {
    const job = await jobService.createJob(req.user, req.body);
    res.status(201).json({
      success: true,
      message: 'Job created',
      data: { job },
    });
  }),

  assign: asyncHandler(async (req, res) => {
    const job = await jobService.assignJob(req.user, req.params.id, req.body.inspectorId);
    res.status(200).json({
      success: true,
      message: 'Job assigned to inspector',
      data: { job },
    });
  }),

  list: asyncHandler(async (req, res) => {
    const jobs = await jobService.listJobs(req.user);
    res.status(200).json({
      success: true,
      message: 'Jobs fetched',
      data: { jobs },
    });
  }),
};

module.exports = jobController;
