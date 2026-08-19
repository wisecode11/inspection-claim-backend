'use strict';

const { Router } = require('express');
const { USER_ROLES } = require('../models/enums');
const { authenticate, requireRoles, requireCompany } = require('../middlewares/auth.middleware');
const subscriptionController = require('../controllers/subscription.controller');

const router = Router();

router.get('/plans', authenticate, subscriptionController.listPlans);
router.post(
  '/',
  authenticate,
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  requireCompany,
  subscriptionController.start
);

module.exports = router;
