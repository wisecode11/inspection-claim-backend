'use strict';

const mongoose = require('mongoose');
const { Notification } = require('../models');
const { NOTIFICATION_TYPES } = require('../models/User/Notification');
const HttpError = require('../utils/httpError');
const pushService = require('./push.service');

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;

function toNotificationResponse(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    title: doc.title || '',
    body: doc.body || '',
    type: doc.type,
    data: {
      jobId: doc.data?.jobId || '',
      jobNumber: doc.data?.jobNumber || '',
    },
    readAt: doc.readAt ? new Date(doc.readAt).toISOString() : null,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
  };
}

async function createForUser({
  userId,
  companyId,
  title,
  body = '',
  type,
  data = {},
} = {}) {
  if (!userId || !companyId) {
    throw new HttpError(400, 'userId and companyId are required');
  }
  if (!title || !type) {
    throw new HttpError(400, 'title and type are required');
  }

  const doc = await Notification.create({
    userId,
    companyId,
    title: String(title).trim().slice(0, 160),
    body: String(body || '').trim().slice(0, 500),
    type,
    data: {
      jobId: String(data.jobId || '').trim().slice(0, 64),
      jobNumber: String(data.jobNumber || '').trim().slice(0, 64),
    },
  });

  return toNotificationResponse(doc);
}

/**
 * Persist inbox row, then fire Expo push (best-effort).
 */
async function notifyJobAssigned(inspector, jobResponse = {}) {
  if (!inspector?._id || !inspector?.companyId) {
    return null;
  }

  const jobNumber = jobResponse.jobNumber || '';
  const jobId = String(jobResponse.id || jobResponse._id || '');
  const title = 'New job assigned';
  const body = (`Job ${jobNumber} is ready for inspection.`).replace(/\s+/g, ' ').trim();

  const notification = await createForUser({
    userId: inspector._id,
    companyId: inspector.companyId,
    title,
    body,
    type: NOTIFICATION_TYPES.JOB_ASSIGNED,
    data: { jobId, jobNumber },
  });

  pushService.notifyUserSafe(inspector._id, {
    title,
    body,
    data: {
      type: NOTIFICATION_TYPES.JOB_ASSIGNED,
      jobId,
      jobNumber,
      notificationId: notification.id,
    },
  });

  return notification;
}

function notifyJobAssignedSafe(inspector, jobResponse) {
  notifyJobAssigned(inspector, jobResponse).catch((error) => {
    console.error('[notification] notifyJobAssigned failed:', error?.message || error);
  });
}

async function listForUser(user, query = {}) {
  if (!user?.companyId) {
    throw new HttpError(400, 'Create a company first');
  }

  const limit = Math.min(
    Math.max(Number.parseInt(String(query.limit || DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );
  const unreadOnly = query.unreadOnly === true || query.unreadOnly === 'true' || query.unreadOnly === '1';

  const filter = {
    companyId: user.companyId,
    userId: user._id,
  };
  if (unreadOnly) {
    filter.readAt = null;
  }

  const [items, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
    Notification.countDocuments({
      companyId: user.companyId,
      userId: user._id,
      readAt: null,
    }),
  ]);

  return {
    items: items.map(toNotificationResponse),
    unreadCount,
  };
}

async function unreadCountForUser(user) {
  if (!user?.companyId) {
    throw new HttpError(400, 'Create a company first');
  }

  const unreadCount = await Notification.countDocuments({
    companyId: user.companyId,
    userId: user._id,
    readAt: null,
  });

  return { unreadCount };
}

async function markRead(user, notificationId) {
  if (!user?.companyId) {
    throw new HttpError(400, 'Create a company first');
  }
  if (!mongoose.isValidObjectId(notificationId)) {
    throw new HttpError(400, 'Valid notification id is required');
  }

  const doc = await Notification.findOne({
    _id: notificationId,
    companyId: user.companyId,
    userId: user._id,
  });

  if (!doc) {
    throw new HttpError(404, 'Notification not found');
  }

  if (!doc.readAt) {
    doc.readAt = new Date();
    await doc.save();
  }

  return toNotificationResponse(doc);
}

async function markAllRead(user) {
  if (!user?.companyId) {
    throw new HttpError(400, 'Create a company first');
  }

  const result = await Notification.updateMany(
    {
      companyId: user.companyId,
      userId: user._id,
      readAt: null,
    },
    { $set: { readAt: new Date() } }
  );

  return { updated: result.modifiedCount || 0 };
}

module.exports = {
  NOTIFICATION_TYPES,
  createForUser,
  notifyJobAssigned,
  notifyJobAssignedSafe,
  listForUser,
  unreadCountForUser,
  markRead,
  markAllRead,
  toNotificationResponse,
};
