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
const templateController = require('../controllers/template.controller');

const router = Router();

router.use(authenticate, requireCompany);

router.get('/', requireOfficeAccess(PERMISSIONS.COMPANY_VIEW), templateController.list);
router.get(
  '/default',
  requireOfficeAccess(PERMISSIONS.COMPANY_VIEW),
  templateController.ensureDefault
);
router.get('/:id', requireOfficeAccess(PERMISSIONS.COMPANY_VIEW), templateController.get);
router.post('/', requireRoles(USER_ROLES.COMPANY_ADMIN), templateController.create);
router.patch('/:id', requireRoles(USER_ROLES.COMPANY_ADMIN), templateController.update);

module.exports = router;
