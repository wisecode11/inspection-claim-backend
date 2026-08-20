'use strict';

const { Router } = require('express');
const { USER_ROLES } = require('../models/enums');
const {
  authenticate,
  requireRoles,
  requireCompany,
  requireOfficeAccess,
} = require('../middlewares/auth.middleware');
const { PERMISSIONS } = require('../utils/permissions');
const dashboardController = require('../controllers/dashboard.controller');

const router = Router();

router.get(
  '/company',
  authenticate,
  requireCompany,
  requireRoles(USER_ROLES.COMPANY_ADMIN, USER_ROLES.OFFICE_STAFF),
  requireOfficeAccess(PERMISSIONS.COMPANY_VIEW),
  dashboardController.company
);

module.exports = router;
