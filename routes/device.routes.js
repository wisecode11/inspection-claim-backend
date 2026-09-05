'use strict';

const { Router } = require('express');
const { USER_ROLES } = require('../models/enums');
const { authenticate, requireRoles, requireCompany } = require('../middlewares/auth.middleware');
const { validateBody } = require('../middlewares/validate.middleware');
const {
  registerPushTokenBody,
  updatePushPreferenceBody,
  clearPushTokenBody,
} = require('../validators/device.validator');
const deviceController = require('../controllers/device.controller');

const router = Router();

router.post(
  '/push-token',
  authenticate,
  requireRoles(USER_ROLES.INSPECTOR),
  requireCompany,
  validateBody(registerPushTokenBody),
  deviceController.registerPushToken
);

router.patch(
  '/push-preference',
  authenticate,
  requireRoles(USER_ROLES.INSPECTOR),
  requireCompany,
  validateBody(updatePushPreferenceBody),
  deviceController.updatePushPreference
);

router.post(
  '/push-token/clear',
  authenticate,
  requireRoles(USER_ROLES.INSPECTOR),
  requireCompany,
  validateBody(clearPushTokenBody),
  deviceController.clearPushToken
);

module.exports = router;