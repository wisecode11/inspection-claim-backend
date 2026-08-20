'use strict';

const asyncHandler = require('../utils/asyncHandler');
const userService = require('../services/user.service');

const userController = {
  createInspector: asyncHandler(async (req, res) => {
    const data = await userService.createInspector(req.user, req.body);
    res.status(201).json({
      success: true,
      message: data.emailSent
        ? 'Inspector created and login details emailed'
        : 'Inspector created. Email was not sent — share the password you set.',
      data,
    });
  }),

  listInspectors: asyncHandler(async (req, res) => {
    const inspectors = await userService.listInspectors(req.user);
    res.status(200).json({
      success: true,
      message: 'Inspectors fetched',
      data: { inspectors },
    });
  }),

  setInspectorStatus: asyncHandler(async (req, res) => {
    const inspector = await userService.setInspectorStatus(req.user, req.params.id, req.body.status);
    res.status(200).json({
      success: true,
      message: inspector.status === 'active' ? 'Inspector activated' : 'Inspector deactivated',
      data: { inspector },
    });
  }),

  deleteInspector: asyncHandler(async (req, res) => {
    const data = await userService.deleteInspector(req.user, req.params.id);
    res.status(200).json({
      success: true,
      message: 'Inspector deleted',
      data,
    });
  }),
};

module.exports = userController;
