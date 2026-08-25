'use strict';

const { Router } = require('express');
const { USER_ROLES } = require('../models/enums');
const {
  authenticate,
  requireRoles,
  requireCompany,
  requireOfficeAccess,
} = require('../middlewares/auth.middleware');
const { validateBody } = require('../middlewares/validate.middleware');
const {
  createJobBody,
  updateJobBody,
  assignJobBody,
  bulkAssignBody,
  statusBody,
  cancelJobBody,
} = require('../validators/job.validator');
const { PERMISSIONS } = require('../utils/permissions');
const jobController = require('../controllers/job.controller');

const router = Router();

router.use(authenticate, requireCompany);

router.get('/', jobController.list);
router.get('/:id', jobController.getById);

router.post(
  '/',
  requireOfficeAccess(PERMISSIONS.JOBS_CREATE),
  validateBody(createJobBody),
  jobController.create
);

router.patch(
  '/:id',
  requireOfficeAccess(PERMISSIONS.JOBS_EDIT),
  validateBody(updateJobBody),
  jobController.update
);

router.patch(
  '/:id/assign',
  requireOfficeAccess(PERMISSIONS.JOBS_ASSIGN),
  validateBody(assignJobBody),
  jobController.assign
);

router.post(
  '/bulk-assign',
  requireOfficeAccess(PERMISSIONS.JOBS_ASSIGN),
  validateBody(bulkAssignBody),
  jobController.bulkAssign
);

router.patch(
  '/:id/unassign',
  requireOfficeAccess(PERMISSIONS.JOBS_ASSIGN),
  jobController.unassign
);

router.patch(
  '/:id/status',
  requireOfficeAccess(PERMISSIONS.JOBS_STATUS),
  validateBody(statusBody),
  jobController.setStatus
);

router.post(
  '/:id/cancel',
  requireOfficeAccess(PERMISSIONS.JOBS_CANCEL),
  validateBody(cancelJobBody),
  jobController.cancel
);

router.delete(
  '/:id',
  requireOfficeAccess(PERMISSIONS.JOBS_EDIT),
  jobController.remove
);

router.post(
  '/:id/accept',
  requireRoles(USER_ROLES.INSPECTOR),
  jobController.accept
);

router.patch(
  '/:id/location',
  requireRoles(USER_ROLES.COMPANY_ADMIN, USER_ROLES.OFFICE_STAFF, USER_ROLES.INSPECTOR),
  jobController.confirmLocation
);

module.exports = router;
