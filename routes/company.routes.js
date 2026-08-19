'use strict';

const { Router } = require('express');
const { USER_ROLES } = require('../models/enums');
const { authenticate, requireRoles } = require('../middlewares/auth.middleware');
const { validateBody } = require('../middlewares/validate.middleware');
const { createCompanyBody } = require('../validators/company.validator');
const companyController = require('../controllers/company.controller');

const router = Router();

router.use(authenticate, requireRoles(USER_ROLES.COMPANY_ADMIN));

router.get('/', companyController.listMine);
router.get('/me', companyController.me);
router.post('/', validateBody(createCompanyBody), companyController.create);

module.exports = router;
