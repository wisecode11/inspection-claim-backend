'use strict';

const mongoose = require('mongoose');
const { planFeaturesSchema } = require('../common/planLimits.schema');
const auditFieldsPlugin = require('../plugins/auditFields.plugin');

const { Schema } = mongoose;

/**
 * Singleton platform configuration (key = "global").
 * Weather/map provider credentials stay in env vars — never in this document.
 */
const platformSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    maintenanceMode: { type: Boolean, default: false },
    maintenanceMessage: { type: String, trim: true, maxlength: 300, default: '' },
    featureFlags: { type: planFeaturesSchema, default: () => ({}) },
    defaultTrialDays: { type: Number, min: 0, default: 14 },
    weather: {
      provider: { type: String, trim: true, default: 'hail_trace' },
      cacheTtlHours: { type: Number, min: 1, default: 24 },
    },
    maps: {
      provider: { type: String, trim: true, default: 'google' },
    },
    reports: {
      generator: { type: String, trim: true, default: 'pdfkit' },
      defaultTimezone: { type: String, trim: true, default: 'America/Chicago' },
    },
    dunning: {
      maxRetryAttempts: { type: Number, min: 1, default: 4 },
      retryIntervalDays: { type: Number, min: 1, default: 3 },
    },
  },
  { timestamps: true, collection: 'platform_settings' }
);

platformSettingsSchema.plugin(auditFieldsPlugin);

module.exports =
  mongoose.models.PlatformSettings || mongoose.model('PlatformSettings', platformSettingsSchema);
