'use strict';

const asyncHandler = require('../utils/asyncHandler');
const authService = require('../services/auth.service');

function requestMeta(req) {
  return {
    ip: req.ip || '',
    userAgent: req.get('user-agent') || '',
  };
}

const authController = {
  register: asyncHandler(async (req, res) => {
    const data = await authService.registerOwner(req.body, {
      ...requestMeta(req),
      platform: 'web',
    });
    res.status(201).json({ success: true, message: 'Account created', data });
  }),

  login: asyncHandler(async (req, res) => {
    const data = await authService.login(req.body, requestMeta(req));
    res.status(200).json({ success: true, message: 'Login successful', data });
  }),

  refresh: asyncHandler(async (req, res) => {
    const data = await authService.refresh(req.body, requestMeta(req));
    res.status(200).json({ success: true, message: 'Token refreshed', data });
  }),

  logout: asyncHandler(async (req, res) => {
    await authService.logout(req.body, req.user);
    res.status(200).json({ success: true, message: 'Logged out', data: null });
  }),

  me: asyncHandler(async (req, res) => {
    const data = await authService.me(req.user);
    res.status(200).json({ success: true, message: 'Session loaded', data });
  }),
};

module.exports = authController;
