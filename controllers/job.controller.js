'use strict';

const asyncHandler = require('../utils/asyncHandler');
const jobService = require('../services/job.service');
const reportService = require('../services/report.service');

const jobController = {
  create: asyncHandler(async (req, res) => {
    const job = await jobService.createJob(req.user, req.body);
    res.status(201).json({
      success: true,
      message: 'Job created',
      data: { job },
    });
  }),

  update: asyncHandler(async (req, res) => {
    const job = await jobService.updateJob(req.user, req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Job updated',
      data: { job },
    });
  }),

  getById: asyncHandler(async (req, res) => {
    const job = await jobService.getJob(req.user, req.params.id);
    res.status(200).json({
      success: true,
      message: 'Job fetched',
      data: { job },
    });
  }),

  list: asyncHandler(async (req, res) => {
    const jobs = await jobService.listJobs(req.user, req.query);
    res.status(200).json({
      success: true,
      message: 'Jobs fetched',
      data: { jobs },
    });
  }),

  assign: asyncHandler(async (req, res) => {
    const job = await jobService.assignJob(req.user, req.params.id, req.body.inspectorId, {
      dueDate: req.body.dueDate,
      priority: req.body.priority,
    });
    res.status(200).json({
      success: true,
      message: 'Job assigned to inspector',
      data: { job },
    });
  }),

  bulkAssign: asyncHandler(async (req, res) => {
    const jobs = await jobService.bulkAssignJobs(req.user, req.body);
    res.status(200).json({
      success: true,
      message: 'Jobs assigned',
      data: { jobs },
    });
  }),

  unassign: asyncHandler(async (req, res) => {
    const job = await jobService.unassignJob(req.user, req.params.id);
    res.status(200).json({
      success: true,
      message: 'Inspector unassigned',
      data: { job },
    });
  }),

  setStatus: asyncHandler(async (req, res) => {
    const job = await jobService.updateJobStatus(req.user, req.params.id, req.body.status);
    res.status(200).json({
      success: true,
      message: 'Job status updated',
      data: { job },
    });
  }),

  cancel: asyncHandler(async (req, res) => {
    const job = await jobService.cancelJob(req.user, req.params.id, req.body.reason);
    res.status(200).json({
      success: true,
      message: 'Job cancelled and unassigned — you can reassign another inspector',
      data: { job },
    });
  }),

  remove: asyncHandler(async (req, res) => {
    const data = await jobService.deleteJob(req.user, req.params.id);
    res.status(200).json({
      success: true,
      message: 'Job deleted',
      data,
    });
  }),

  accept: asyncHandler(async (req, res) => {
    const job = await jobService.acceptJob(req.user, req.params.id);
    res.status(200).json({
      success: true,
      message: 'Job accepted',
      data: { job },
    });
  }),

  confirmLocation: asyncHandler(async (req, res) => {
    const job = await jobService.confirmJobLocation(req.user, req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Inspection location confirmed',
      data: { job },
    });
  }),

  submit: asyncHandler(async (req, res) => {
    const data = await reportService.submitInspectorEvidencePackage(
      req.user,
      req.params.id,
      req.body
    );
    res.status(200).json({
      success: true,
      message: data.alreadySubmitted
        ? 'Evidence package updated for admin review'
        : 'Evidence package submitted to admin',
      data,
    });
  }),
};

module.exports = jobController;
