'use strict';

const asyncHandler = require('../utils/asyncHandler');
const authService = require('../services/auth.service');

const authController = {
  register: asyncHandler(async (req, res) => {
    const data = await authService.registerOwner(req.body);
    res.status(201).json({ success: true, message: 'User created', data });
  }),

  login: asyncHandler(async (req, res) => {
    const data = await authService.login(req.body);
    res.status(200).json({ success: true, message: 'Login successful', data });
  }),
};

module.exports = authController;
