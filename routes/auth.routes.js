'use strict';

const { Router } = require('express');
const authController = require('../controllers/auth.controller');
const profileController = require('../controllers/profile.controller');
const { authenticate, optionalAuthenticate } = require('../middlewares/auth.middleware');
const { validateBody } = require('../middlewares/validate.middleware');
const {
  registerBody,
  loginBody,
  googleAuthBody,
  refreshBody,
  logoutBody,
  updateProfileBody,
  avatarUploadBody,
} = require('../validators/auth.validator');

const router = Router();

router.post('/register', validateBody(registerBody), authController.register);
router.post('/login', validateBody(loginBody), authController.login);
router.post('/google', validateBody(googleAuthBody), authController.googleAuth);
router.post('/refresh', validateBody(refreshBody), authController.refresh);
router.post('/logout', optionalAuthenticate, validateBody(logoutBody), authController.logout);
router.get('/me', authenticate, authController.me);
router.patch('/me', authenticate, validateBody(updateProfileBody), profileController.updateMe);
router.put('/me/avatar', authenticate, validateBody(avatarUploadBody), profileController.uploadAvatar);
router.delete('/me/avatar', authenticate, profileController.removeAvatar);

module.exports = router;
