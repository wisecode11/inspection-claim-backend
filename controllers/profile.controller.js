'use strict';

const asyncHandler = require('../utils/asyncHandler');
const profileService = require('../services/profile.service');

const profileController = {
  updateMe: asyncHandler(async (req, res) => {
    const data = await profileService.updateMyProfile(req.user, req.body);
    res.status(200).json({ success: true, message: 'Profile updated', data });
  }),

  uploadAvatar: asyncHandler(async (req, res) => {
    const data = await profileService.setMyAvatar(req.user, req.body);
    res.status(200).json({ success: true, message: 'Profile photo updated', data });
  }),

  removeAvatar: asyncHandler(async (req, res) => {
    const data = await profileService.removeMyAvatar(req.user);
    res.status(200).json({ success: true, message: 'Profile photo removed', data });
  }),

  getAvatar: asyncHandler(async (req, res) => {
    const { buffer, mimeType } = await profileService.getAvatarByKey(req.params.key);
    res.setHeader('Content-Type', mimeType);
    // The key changes on every upload, so a given URL's bytes never change.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buffer);
  }),
};

module.exports = profileController;
