'use strict';

const { Router } = require('express');
const { USER_ROLES } = require('../models/enums');
const {
  authenticate,
  requireRoles,
  requireCompany,
  requireOfficeAccess,
} = require('../middlewares/auth.middleware');
const { validateBody } = require('../middlewares/validate.middleware');
const { createCompanyBody, updateCompanyBody } = require('../validators/company.validator');
const { PERMISSIONS } = require('../utils/permissions');
const companyController = require('../controllers/company.controller');

const router = Router();

router.post(
  '/',
  authenticate,
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  validateBody(createCompanyBody),
  companyController.create
);

router.get(
  '/me',
  authenticate,
  requireCompany,
  requireOfficeAccess(PERMISSIONS.COMPANY_VIEW),
  companyController.me
);

router.patch(
  '/me',
  authenticate,
  requireCompany,
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  validateBody(updateCompanyBody),
  companyController.update
);

module.exports = router;
