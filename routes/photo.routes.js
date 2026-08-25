'use strict';

const { Router } = require('express');
const { USER_ROLES } = require('../models/enums');
const {
  authenticate,
  requireCompany,
  requireRoles,
} = require('../middlewares/auth.middleware');
const photoController = require('../controllers/photo.controller');

const router = Router();

router.get('/:id/file', photoController.downloadFile);

router.use(authenticate, requireCompany);

router.post(
  '/jobs/:jobId',
  requireRoles(USER_ROLES.INSPECTOR, USER_ROLES.COMPANY_ADMIN, USER_ROLES.OFFICE_STAFF),
  photoController.uploadForJob
);

module.exports = router;
