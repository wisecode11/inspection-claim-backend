'use strict';

const { Router } = require('express');
const { USER_ROLES } = require('../models/enums');
const { authenticate, requireRoles } = require('../middlewares/auth.middleware');
const { validateBody } = require('../middlewares/validate.middleware');
const { subscribeBody } = require('../validators/subscription.validator');
const subscriptionController = require('../controllers/subscription.controller');

const router = Router();

router.get('/plans', authenticate, requireRoles(USER_ROLES.COMPANY_ADMIN), subscriptionController.listPlans);
router.post(
  '/',
  authenticate,
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  validateBody(subscribeBody),
  subscriptionController.start
);

module.exports = router;
