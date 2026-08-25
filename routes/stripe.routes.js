'use strict';

const { Router } = require('express');
const stripeController = require('../controllers/stripe.controller');

const router = Router();

// Raw body is attached in server.js for this path only.
router.post('/webhook', stripeController.webhook);

module.exports = router;
