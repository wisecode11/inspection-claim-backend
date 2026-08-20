'use strict';

const { Router } = require('express');
const { USER_ROLES } = require('../models/enums');
const { authenticate, requireRoles, requireCompany } = require('../middlewares/auth.middleware');
const { validateBody } = require('../middlewares/validate.middleware');
const { verifyWeatherBody } = require('../validators/job.validator');
const weatherController = require('../controllers/weather.controller');

const router = Router();

router.post(
  '/verify',
  authenticate,
  requireRoles(USER_ROLES.COMPANY_ADMIN, USER_ROLES.INSPECTOR),
  requireCompany,
  validateBody(verifyWeatherBody),
  weatherController.verify
);

router.get(
  '/jobs/:jobId',
  authenticate,
  requireRoles(USER_ROLES.COMPANY_ADMIN, USER_ROLES.INSPECTOR),
  requireCompany,
  weatherController.getForJob
);

module.exports = router;
