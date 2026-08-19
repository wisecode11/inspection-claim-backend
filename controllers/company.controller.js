'use strict';

const asyncHandler = require('../utils/asyncHandler');
const companyService = require('../services/company.service');

function requestMeta(req) {
  return {
    ip: req.ip || '',
    userAgent: req.get('user-agent') || '',
    platform: 'web',
  };
}

const companyController = {
  create: asyncHandler(async (req, res) => {
    const data = await companyService.createCompany(req.user, req.body, requestMeta(req));
    res.status(201).json({
      success: true,
      message: 'Organization created',
      data,
    });
  }),

  listMine: asyncHandler(async (req, res) => {
    const companies = await companyService.listMyCompanies(req.user);
    res.status(200).json({
      success: true,
      message: 'Organizations fetched',
      data: { companies },
    });
  }),

  me: asyncHandler(async (req, res) => {
    const company = await companyService.getMyCompany(req.user);
    res.status(200).json({
      success: true,
      message: 'Organization loaded',
      data: { company },
    });
  }),
};

module.exports = companyController;
