'use strict';

const { Router } = require('express');
const { USER_ROLES } = require('../models/enums');
const { authenticate, requireRoles } = require('../middlewares/auth.middleware');
const companyController = require('../controllers/company.controller');

const router = Router();

router.post('/', authenticate, requireRoles(USER_ROLES.COMPANY_ADMIN), companyController.create);

module.exports = router;
