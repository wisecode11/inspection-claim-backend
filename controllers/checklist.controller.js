'use strict';

const asyncHandler = require('../utils/asyncHandler');
const checklistService = require('../services/checklist.service');

const checklistController = {
  listCitations: asyncHandler(async (req, res) => {
    const citations = await checklistService.listCitations(req.user, req.query);
    res.status(200).json({
      success: true,
      message: 'Codes & standards fetched',
      data: { citations },
    });
  }),

  createCitation: asyncHandler(async (req, res) => {
    const citation = await checklistService.createCitation(req.user, req.body);
    res.status(201).json({
      success: true,
      message: 'Code citation created',
      data: { citation },
    });
  }),

  updateCitation: asyncHandler(async (req, res) => {
    const citation = await checklistService.updateCitation(req.user, req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Code citation updated',
      data: { citation },
    });
  }),

  deleteCitation: asyncHandler(async (req, res) => {
    const data = await checklistService.deleteCitation(req.user, req.params.id);
    res.status(200).json({
      success: true,
      message: 'Code citation deleted',
      data,
    });
  }),

  listChecklists: asyncHandler(async (req, res) => {
    const checklists = await checklistService.listChecklists(req.user);
    res.status(200).json({
      success: true,
      message: 'Checklists fetched',
      data: { checklists },
    });
  }),

  ensureDefaultChecklist: asyncHandler(async (req, res) => {
    const checklist = await checklistService.ensureDefaultChecklist(req.user);
    res.status(200).json({
      success: true,
      message: 'Default checklist ready',
      data: { checklist },
    });
  }),

  createChecklist: asyncHandler(async (req, res) => {
    const checklist = await checklistService.createChecklist(req.user, req.body);
    res.status(201).json({
      success: true,
      message: 'Checklist created',
      data: { checklist },
    });
  }),

  updateChecklist: asyncHandler(async (req, res) => {
    const checklist = await checklistService.updateChecklist(req.user, req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Checklist updated',
      data: { checklist },
    });
  }),
};

module.exports = checklistController;
