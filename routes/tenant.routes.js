'use strict';

const { Router } = require('express');
const { USER_ROLES } = require('../models/enums');
const { authenticate, requireRoles } = require('../middlewares/auth.middleware');
const tenantController = require('../controllers/tenant.controller');

const router = Router();

router.use(authenticate, requireRoles(USER_ROLES.PLATFORM_ADMIN));

router.get('/', tenantController.list);
router.get('/:id', tenantController.getById);
router.post('/:id/suspend', tenantController.suspend);

module.exports = router;
