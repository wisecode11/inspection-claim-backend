'use strict';

const asyncHandler = require('../utils/asyncHandler');
const reportService = require('../services/report.service');

const reportController = {
  list: asyncHandler(async (req, res) => {
    const reports = await reportService.listReports(req.user, req.query);
    res.status(200).json({
      success: true,
      message: 'Reports fetched',
      data: { reports },
    });
  }),

  getById: asyncHandler(async (req, res) => {
    const report = await reportService.getReportById(req.user, req.params.id);
    res.status(200).json({
      success: true,
      message: 'Report loaded',
      data: { report },
    });
  }),

  review: asyncHandler(async (req, res) => {
    const data = await reportService.reviewPackage(req.user, req.params.jobId);
    res.status(200).json({
      success: true,
      message: 'Inspection review package loaded',
      data,
    });
  }),

  getForJob: asyncHandler(async (req, res) => {
    const report = await reportService.getReportForJob(req.user, req.params.jobId);
    res.status(200).json({
      success: true,
      message: 'Report loaded',
      data: { report },
    });
  }),

  updateNarrative: asyncHandler(async (req, res) => {
    const report = await reportService.updateNarrative(
      req.user,
      req.params.jobId,
      req.body.narrative || ''
    );
    res.status(200).json({
      success: true,
      message: 'Report narrative updated',
      data: { report },
    });
  }),

  generate: asyncHandler(async (req, res) => {
    const report = await reportService.generateReport(req.user, req.params.jobId, req.body);
    res.status(200).json({
      success: true,
      message: 'Report generated',
      data: { report },
    });
  }),

  share: asyncHandler(async (req, res) => {
    const data = await reportService.shareEvidencePackage(req.user, req.params.jobId, req.body);
    res.status(201).json({
      success: true,
      message: 'Evidence package share created',
      data,
    });
  }),

  shareById: asyncHandler(async (req, res) => {
    const data = await reportService.shareReport(req.user, req.params.id, req.body);
    res.status(201).json({
      success: true,
      message: 'Report share created',
      data,
    });
  }),

  submit: asyncHandler(async (req, res) => {
    const report = await reportService.submitReport(req.user, req.params.id);
    res.status(200).json({
      success: true,
      message: 'Report submitted',
      data: { report },
    });
  }),

  startReview: asyncHandler(async (req, res) => {
    const report = await reportService.startReview(req.user, req.params.id);
    res.status(200).json({
      success: true,
      message: 'Report under review',
      data: { report },
    });
  }),

  approve: asyncHandler(async (req, res) => {
    const report = await reportService.approveReport(req.user, req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Report approved',
      data: { report },
    });
  }),

  reject: asyncHandler(async (req, res) => {
    const report = await reportService.rejectReport(req.user, req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Report rejected',
      data: { report },
    });
  }),

  requestChanges: asyncHandler(async (req, res) => {
    const report = await reportService.requestChanges(req.user, req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Changes requested',
      data: { report },
    });
  }),

  downloadPdf: asyncHandler(async (req, res) => {
    const { buffer, fileName } = await reportService.getPdfBuffer(
      req.params.id,
      req.query.token
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }),
};

module.exports = reportController;
