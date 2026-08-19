'use strict';

const mongoose = require('mongoose');
const { SHARE_CHANNELS } = require('../enums');
const tenantScopedPlugin = require('../plugins/tenantScoped.plugin');
const auditFieldsPlugin = require('../plugins/auditFields.plugin');

const { Schema } = mongoose;

const reportShareSchema = new Schema(
  {
    reportId: { type: Schema.Types.ObjectId, ref: 'Report', required: true, index: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    channel: {
      type: String,
      enum: Object.values(SHARE_CHANNELS),
      required: true,
    },
    recipient: { type: String, trim: true, maxlength: 254, default: '' },
    tokenHash: { type: String, required: true, unique: true },
    allowDownload: { type: Boolean, default: true },
    expiresAt: { type: Date, default: null, index: true },
    revokedAt: { type: Date, default: null },
    openedAt: { type: Date, default: null },
    openCount: { type: Number, min: 0, default: 0 },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: 'report_shares' }
);

reportShareSchema.plugin(tenantScopedPlugin);
reportShareSchema.plugin(auditFieldsPlugin);

reportShareSchema.index({ companyId: 1, reportId: 1, createdAt: -1 });

module.exports = mongoose.models.ReportShare || mongoose.model('ReportShare', reportShareSchema);
