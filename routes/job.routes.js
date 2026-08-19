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

router.get('/', authenticate, requireCompany, jobController.list);

module.exports = router;
