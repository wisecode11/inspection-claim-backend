'use strict';

const mongoose = require('mongoose');
const { DEVICE_PLATFORMS } = require('../enums');
const tenantScopedPlugin = require('../plugins/tenantScoped.plugin');

const { Schema } = mongoose;

const refreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    deviceId: { type: String, trim: true, default: '' },
    platform: {
      type: String,
      enum: Object.values(DEVICE_PLATFORMS),
      default: DEVICE_PLATFORMS.WEB,
    },
    userAgent: { type: String, trim: true, maxlength: 400, default: '' },
    ip: { type: String, trim: true, default: '' },
    impersonatedCompanyId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null },
    impersonatedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'refresh_tokens' }
);

refreshTokenSchema.plugin(tenantScopedPlugin, { optional: true });

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
refreshTokenSchema.index({ userId: 1, revokedAt: 1 });

module.exports = mongoose.models.RefreshToken || mongoose.model('RefreshToken', refreshTokenSchema);
