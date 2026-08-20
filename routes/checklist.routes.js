'use strict';

const { Router } = require('express');
const {
  authenticate,
  requireCompany,
  requireOfficeAccess,
  requireRoles,
} = require('../middlewares/auth.middleware');
const { USER_ROLES } = require('../models/enums');
const { PERMISSIONS } = require('../utils/permissions');
const checklistController = require('../controllers/checklist.controller');

const router = Router();

router.use(authenticate, requireCompany);

router.get(
  '/citations',
  requireOfficeAccess(PERMISSIONS.COMPANY_VIEW),
  checklistController.listCitations
);
router.post(
  '/citations',
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  checklistController.createCitation
);
router.patch(
  '/citations/:id',
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  checklistController.updateCitation
);
router.delete(
  '/citations/:id',
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  checklistController.deleteCitation
);

router.get(
  '/',
  requireOfficeAccess(PERMISSIONS.COMPANY_VIEW),
  checklistController.listChecklists
);
router.get(
  '/default',
  requireOfficeAccess(PERMISSIONS.COMPANY_VIEW),
  checklistController.ensureDefaultChecklist
);
router.post('/', requireRoles(USER_ROLES.COMPANY_ADMIN), checklistController.createChecklist);
router.patch(
  '/:id',
  requireRoles(USER_ROLES.COMPANY_ADMIN),
  checklistController.updateChecklist
);

module.exports = router;
