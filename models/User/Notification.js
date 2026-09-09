'use strict';

const mongoose = require('mongoose');
const tenantScopedPlugin = require('../plugins/tenantScoped.plugin');

const { Schema } = mongoose;

const NOTIFICATION_TYPES = Object.freeze({
  JOB_ASSIGNED: 'job_assigned',
});

/** In-app inbox for inspectors (push delivery is separate via Device). */
const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    body: { type: String, trim: true, maxlength: 500, default: '' },
    type: {
      type: String,
      required: true,
      enum: Object.values(NOTIFICATION_TYPES),
      index: true,
    },
    data: {
      jobId: { type: String, trim: true, default: '' },
      jobNumber: { type: String, trim: true, default: '' },
    },
    readAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, collection: 'notifications' }
);

notificationSchema.plugin(tenantScopedPlugin);

notificationSchema.index({ companyId: 1, userId: 1, createdAt: -1 });
notificationSchema.index({ companyId: 1, userId: 1, readAt: 1, createdAt: -1 });

module.exports =
  mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
