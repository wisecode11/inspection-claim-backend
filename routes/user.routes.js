'use strict';

const { Router } = require('express');
const { USER_ROLES } = require('../models/enums');
const { authenticate, requireRoles, requireCompany } = require('../middlewares/auth.middleware');
const userController = require('../controllers/user.controller');

const router = Router();

router.post(
  '/inspectors',
  authenticate,
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  requireCompany,
  userController.createInspector
);

module.exports = router;
