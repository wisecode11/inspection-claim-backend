'use strict';

const asyncHandler = require('../utils/asyncHandler');
const companyService = require('../services/company.service');

const companyController = {
  create: asyncHandler(async (req, res) => {
    const company = await companyService.createCompany(req.user, req.body);
    res.status(201).json({
      success: true,
      message: 'Company created',
      data: { company },
    });
  }),
};

module.exports = companyController;
