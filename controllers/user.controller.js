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

  getInspector: asyncHandler(async (req, res) => {
    const inspector = await userService.getInspector(req.user, req.params.id);
    res.status(200).json({
      success: true,
      message: 'Inspector fetched',
      data: { inspector },
    });
  }),

  updateInspector: asyncHandler(async (req, res) => {
    const inspector = await userService.updateInspector(req.user, req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Inspector updated',
      data: { inspector },
    });
  }),

  setInspectorStatus: asyncHandler(async (req, res) => {
    const inspector = await userService.setInspectorStatus(req.user, req.params.id, req.body.status);
    res.status(200).json({
      success: true,
      message: `Inspector ${inspector.status}`,
      data: { inspector },
    });
  }),

  resetInspectorPassword: asyncHandler(async (req, res) => {
    const data = await userService.resetInspectorPassword(req.user, req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: data.emailSent
        ? 'Password reset and emailed to inspector'
        : 'Password reset. Share the temporary password securely.',
      data,
    });
  }),

  reassignInspectorJobs: asyncHandler(async (req, res) => {
    const data = await userService.reassignInspectorJobs(req.user, req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: `${data.count} job(s) reassigned`,
      data,
    });
  }),

  deleteInspector: asyncHandler(async (req, res) => {
    const inspector = await userService.deleteInspector(req.user, req.params.id);
    res.status(200).json({
      success: true,
      message: 'Inspector deactivated',
      data: { inspector },
    });
  }),

  inspectorHistory: asyncHandler(async (req, res) => {
    const data = await userService.getInspectorHistory(req.user, req.params.id);
    res.status(200).json({
      success: true,
      message: 'Inspector history fetched',
      data,
    });
  }),

  createStaff: asyncHandler(async (req, res) => {
    const data = await userService.createStaff(req.user, req.body);
    res.status(201).json({
      success: true,
      message: 'Staff member created',
      data,
    });
  }),

  listStaff: asyncHandler(async (req, res) => {
    const staff = await userService.listStaff(req.user);
    res.status(200).json({
      success: true,
      message: 'Staff fetched',
      data: { staff },
    });
  }),

  updateStaff: asyncHandler(async (req, res) => {
    const staff = await userService.updateStaff(req.user, req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Staff member updated',
      data: { staff },
    });
  }),

  setStaffStatus: asyncHandler(async (req, res) => {
    const staff = await userService.setStaffStatus(req.user, req.params.id, req.body.status);
    res.status(200).json({
      success: true,
      message: staff.status === 'active' ? 'Staff activated' : 'Staff deactivated',
      data: { staff },
    });
  }),

  deleteStaff: asyncHandler(async (req, res) => {
    const data = await userService.deleteStaff(req.user, req.params.id);
    res.status(200).json({
      success: true,
      message: 'Staff member deleted',
      data,
    });
  }),

  listCompanyUsers: asyncHandler(async (req, res) => {
    const users = await userService.listCompanyUsers(req.user);
    res.status(200).json({
      success: true,
      message: 'Company users fetched',
      data: { users },
    });
  }),
};

module.exports = userController;
