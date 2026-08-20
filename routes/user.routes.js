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
  createInspectorBody,
  updateInspectorBody,
  inspectorStatusBody,
  resetPasswordBody,
  reassignJobsBody,
  createStaffBody,
  updateStaffBody,
} = require('../validators/user.validator');
const { PERMISSIONS } = require('../utils/permissions');
const userController = require('../controllers/user.controller');

const router = Router();

router.use(authenticate, requireCompany);

router.get(
  '/inspectors',
  requireOfficeAccess(PERMISSIONS.INSPECTORS_VIEW),
  userController.listInspectors
);
router.post(
  '/inspectors',
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  validateBody(createInspectorBody),
  userController.createInspector
);
router.get(
  '/inspectors/:id',
  requireOfficeAccess(PERMISSIONS.INSPECTORS_VIEW),
  userController.getInspector
);
router.patch(
  '/inspectors/:id',
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  validateBody(updateInspectorBody),
  userController.updateInspector
);
router.patch(
  '/inspectors/:id/status',
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  validateBody(inspectorStatusBody),
  userController.setInspectorStatus
);
router.post(
  '/inspectors/:id/reset-password',
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  validateBody(resetPasswordBody),
  userController.resetInspectorPassword
);
router.post(
  '/inspectors/:id/reassign-jobs',
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  validateBody(reassignJobsBody),
  userController.reassignInspectorJobs
);
router.delete(
  '/inspectors/:id',
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  userController.deleteInspector
);
router.get(
  '/inspectors/:id/history',
  requireOfficeAccess(PERMISSIONS.INSPECTORS_VIEW),
  userController.inspectorHistory
);

router.get('/staff', requireRoles(USER_ROLES.COMPANY_ADMIN), userController.listStaff);
router.post(
  '/staff',
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  validateBody(createStaffBody),
  userController.createStaff
);
router.patch(
  '/staff/:id',
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  validateBody(updateStaffBody),
  userController.updateStaff
);
router.patch(
  '/staff/:id/status',
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  validateBody(inspectorStatusBody),
  userController.setStaffStatus
);
router.delete(
  '/staff/:id',
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  userController.deleteStaff
);

router.get('/company', requireRoles(USER_ROLES.COMPANY_ADMIN), userController.listCompanyUsers);

module.exports = router;
