'use strict';

const mongoose = require('mongoose');
const tenantScopedPlugin = require('../plugins/tenantScoped.plugin');

const { Schema } = mongoose;

/**
 * Monthly usage snapshot per tenant — feeds plan limits and the platform health dashboard.
 * Written by a period-end job; Tenant.usage holds the live counters.
 */
const usageRecordSchema = new Schema(
  {
    period: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    seatsUsed: { type: Number, min: 0, default: 0 },
    inspectionsCount: { type: Number, min: 0, default: 0 },
    reportsCount: { type: Number, min: 0, default: 0 },
    photosCount: { type: Number, min: 0, default: 0 },
    storageBytes: { type: Number, min: 0, default: 0 },
    activeInspectors: { type: Number, min: 0, default: 0 },
    avgCycleTimeHours: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true, collection: 'usage_records' }
);

usageRecordSchema.plugin(tenantScopedPlugin);

usageRecordSchema.index({ companyId: 1, period: 1 }, { unique: true });
usageRecordSchema.index({ period: 1 });

module.exports = mongoose.models.UsageRecord || mongoose.model('UsageRecord', usageRecordSchema);
