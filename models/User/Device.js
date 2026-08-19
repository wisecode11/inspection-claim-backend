'use strict';

const mongoose = require('mongoose');
const { DEVICE_PLATFORMS } = require('../enums');
const tenantScopedPlugin = require('../plugins/tenantScoped.plugin');

const { Schema } = mongoose;

/** Inspector devices — used for offline sync diagnostics and support. */
const deviceSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    deviceId: { type: String, required: true, trim: true },
    platform: {
      type: String,
      enum: [DEVICE_PLATFORMS.IOS, DEVICE_PLATFORMS.ANDROID],
      required: true,
    },
    name: { type: String, trim: true, maxlength: 120, default: '' },
    appVersion: { type: String, trim: true, maxlength: 40, default: '' },
    osVersion: { type: String, trim: true, maxlength: 40, default: '' },
    lastSyncAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null },
    pushToken: { type: String, trim: true, default: '', select: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'devices' }
);

deviceSchema.plugin(tenantScopedPlugin);

deviceSchema.index({ companyId: 1, userId: 1, deviceId: 1 }, { unique: true });

module.exports = mongoose.models.Device || mongoose.model('Device', deviceSchema);
