'use strict';

const { Router } = require('express');
const { USER_ROLES } = require('../models/enums');
const { authenticate, requireRoles, requireCompany } = require('../middlewares/auth.middleware');
const notificationController = require('../controllers/notification.controller');

const router = Router();

router.get(
  '/',
  authenticate,
  requireRoles(USER_ROLES.INSPECTOR),
  requireCompany,
  notificationController.list
);

router.get(
  '/unread-count',
  authenticate,
  requireRoles(USER_ROLES.INSPECTOR),
  requireCompany,
  notificationController.unreadCount
);

router.patch(
  '/read-all',
  authenticate,
  requireRoles(USER_ROLES.INSPECTOR),
  requireCompany,
  notificationController.markAllRead
);

router.patch(
  '/:id/read',
  authenticate,
  requireRoles(USER_ROLES.INSPECTOR),
  requireCompany,
  notificationController.markRead
);

module.exports = router;
