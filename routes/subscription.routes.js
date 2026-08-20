'use strict';

const { Router } = require('express');
const { USER_ROLES } = require('../models/enums');
const { authenticate, requireRoles, requireCompany } = require('../middlewares/auth.middleware');
const { validateBody } = require('../middlewares/validate.middleware');
const {
  subscribeBody,
  changePlanBody,
  cancelBody,
  paymentMethodBody,
} = require('../validators/subscription.validator');
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

router.get(
  '/me',
  authenticate,
  requireCompany,
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  subscriptionController.overview
);

router.patch(
  '/me/plan',
  authenticate,
  requireCompany,
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  validateBody(changePlanBody),
  subscriptionController.changePlan
);

router.post(
  '/me/cancel',
  authenticate,
  requireCompany,
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  validateBody(cancelBody),
  subscriptionController.cancel
);

router.get(
  '/me/invoices',
  authenticate,
  requireCompany,
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  subscriptionController.invoices
);

router.put(
  '/me/payment-method',
  authenticate,
  requireCompany,
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  validateBody(paymentMethodBody),
  subscriptionController.paymentMethod
);

module.exports = router;
