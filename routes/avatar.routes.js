'use strict';

const { Router } = require('express');
const profileController = require('../controllers/profile.controller');

const router = Router();

// Public on purpose: the key is random per upload, so <img>/<Image> can load it without a token.
router.get('/:key', profileController.getAvatar);

module.exports = router;
