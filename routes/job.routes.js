'use strict';

const { Router } = require('express');
const { USER_ROLES } = require('../models/enums');
const { authenticate, requireRoles, requireCompany } = require('../middlewares/auth.middleware');
const jobController = require('../controllers/job.controller');

const router = Router();

router.post(
  '/',
  authenticate,
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  requireCompany,
  jobController.create
);

router.patch(
  '/:id/assign',
  authenticate,
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  requireCompany,
  jobController.assign
);

router.patch(
  '/:id/location',
  authenticate,
  requireRoles(USER_ROLES.COMPANY_ADMIN, USER_ROLES.INSPECTOR),
  requireCompany,
  jobController.confirmLocation
);

router.get('/', authenticate, requireCompany, jobController.list);

module.exports = router;
