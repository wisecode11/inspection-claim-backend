'use strict';

const asyncHandler = require('../utils/asyncHandler');
const tenantService = require('../services/tenant.service');

const tenantController = {
  list: asyncHandler(async (_req, res) => {
    const data = await tenantService.listTenants();
    res.status(200).json({
      success: true,
      message: 'Tenants loaded',
      data,
    });
  }),

  getById: asyncHandler(async (req, res) => {
    const data = await tenantService.getTenantById(req.params.id);
    res.status(200).json({
      success: true,
      message: 'Tenant loaded',
      data,
    });
  }),

  suspend: asyncHandler(async (req, res) => {
    const data = await tenantService.suspendTenant(req.params.id, req.user);
    res.status(200).json({
      success: true,
      message: 'Tenant suspended',
      data,
    });
  }),
};

module.exports = tenantController;
