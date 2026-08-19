'use strict';

const { Router } = require('express');
const { USER_ROLES } = require('../models/enums');
const { authenticate, requireRoles } = require('../middlewares/auth.middleware');
const companyController = require('../controllers/company.controller');

const router = Router();

router.use(authenticate, requireRoles(USER_ROLES.COMPANY_ADMIN, USER_ROLES.PLATFORM_ADMIN));
router.get('/', companyController.list);
router.get('/me', companyController.me);
router.post('/', requireRoles(USER_ROLES.COMPANY_ADMIN), companyController.create);

module.exports = router;
