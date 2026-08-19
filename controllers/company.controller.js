'use strict';

const asyncHandler = require('../utils/asyncHandler');
const companyService = require('../services/company.service');

function requestMeta(req) {
  return {
    userAgent: req.get('user-agent') || '',
    ip: req.ip || req.connection?.remoteAddress || '',
  };
}

const companyController = {
  list: asyncHandler(async (req, res) => {
    const companies = await companyService.listCompanies(req.user);
    res.status(200).json({
      success: true,
      message: 'Companies',
      data: { companies },
    });
  }),

  me: asyncHandler(async (req, res) => {
    const company = await companyService.getMyCompany(req.user);
    res.status(200).json({
      success: true,
      message: 'Company',
      data: { company },
    });
  }),

  create: asyncHandler(async (req, res) => {
    const data = await companyService.createCompany(req.user, req.body, requestMeta(req));
    res.status(201).json({
      success: true,
      message: 'Company created',
      data,
    });
  }),
};

module.exports = companyController;
