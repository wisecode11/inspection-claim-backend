'use strict';

const { Router } = require('express');
const { USER_ROLES } = require('../models/enums');
const { authenticate, requireRoles, requireCompany } = require('../middlewares/auth.middleware');
const mapsController = require('../controllers/maps.controller');

const router = Router();

router.get(
  '/static',
  authenticate,
  requireRoles(USER_ROLES.COMPANY_ADMIN, USER_ROLES.INSPECTOR, USER_ROLES.OFFICE_STAFF),
  requireCompany,
  mapsController.staticMap
);

module.exports = router;
