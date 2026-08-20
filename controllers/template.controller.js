'use strict';

const asyncHandler = require('../utils/asyncHandler');
const templateService = require('../services/template.service');

const templateController = {
  list: asyncHandler(async (req, res) => {
    const templates = await templateService.listTemplates(req.user);
    res.status(200).json({
      success: true,
      message: 'Report templates fetched',
      data: { templates },
    });
  }),

  ensureDefault: asyncHandler(async (req, res) => {
    const template = await templateService.ensureDefaultTemplate(req.user);
    res.status(200).json({
      success: true,
      message: 'Default report template ready',
      data: { template },
    });
  }),

  get: asyncHandler(async (req, res) => {
    const template = await templateService.getTemplate(req.user, req.params.id);
    res.status(200).json({
      success: true,
      message: 'Report template loaded',
      data: { template },
    });
  }),

  create: asyncHandler(async (req, res) => {
    const template = await templateService.createTemplate(req.user, req.body);
    res.status(201).json({
      success: true,
      message: 'Report template created',
      data: { template },
    });
  }),

  update: asyncHandler(async (req, res) => {
    const template = await templateService.updateTemplate(req.user, req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Report template updated',
      data: { template },
    });
  }),
};

module.exports = templateController;
