'use strict';

const asyncHandler = require('../utils/asyncHandler');
const notificationService = require('../services/notification.service');

const notificationController = {
  list: asyncHandler(async (req, res) => {
    const data = await notificationService.listForUser(req.user, req.query);
    res.status(200).json({
      success: true,
      message: 'Notifications loaded',
      data,
    });
  }),

  unreadCount: asyncHandler(async (req, res) => {
    const data = await notificationService.unreadCountForUser(req.user);
    res.status(200).json({
      success: true,
      message: 'Unread count loaded',
      data,
    });
  }),

  markRead: asyncHandler(async (req, res) => {
    const notification = await notificationService.markRead(req.user, req.params.id);
    res.status(200).json({
      success: true,
      message: 'Notification marked read',
      data: { notification },
    });
  }),

  markAllRead: asyncHandler(async (req, res) => {
    const data = await notificationService.markAllRead(req.user);
    res.status(200).json({
      success: true,
      message: 'All notifications marked read',
      data,
    });
  }),
};

module.exports = notificationController;
