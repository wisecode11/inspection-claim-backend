'use strict';

const { Router } = require('express');
const { USER_ROLES } = require('../models/enums');
const { authenticate, requireRoles, requireCompany } = require('../middlewares/auth.middleware');
const { validateBody } = require('../middlewares/validate.middleware');
const { createInspectorBody, inspectorStatusBody } = require('../validators/user.validator');
const userController = require('../controllers/user.controller');

const router = Router();

router.use(authenticate, requireRoles(USER_ROLES.COMPANY_ADMIN), requireCompany);

router.get('/inspectors', userController.listInspectors);
router.post('/inspectors', validateBody(createInspectorBody), userController.createInspector);
router.patch(
  '/inspectors/:id/status',
  validateBody(inspectorStatusBody),
  userController.setInspectorStatus
);
router.delete('/inspectors/:id', userController.deleteInspector);

module.exports = router;
