'use strict';

const { Router } = require('express');
const authController = require('../controllers/auth.controller');
const { authenticate, optionalAuthenticate } = require('../middlewares/auth.middleware');
const { validateBody } = require('../middlewares/validate.middleware');
const {
  registerBody,
  loginBody,
  refreshBody,
  logoutBody,
} = require('../validators/auth.validator');

const router = Router();

router.post('/register', validateBody(registerBody), authController.register);
router.post('/login', validateBody(loginBody), authController.login);
router.post('/refresh', validateBody(refreshBody), authController.refresh);
router.post('/logout', optionalAuthenticate, validateBody(logoutBody), authController.logout);
router.get('/me', authenticate, authController.me);

module.exports = router;
