'use strict';

const mongoose = require('mongoose');
const { WEATHER_MATCH_STATUSES, WEATHER_EVENT_TYPES } = require('../enums');
const addressSchema = require('../common/address.schema');
const geoPointSchema = require('../common/geoPoint.schema');
const tenantScopedPlugin = require('../plugins/tenantScoped.plugin');
const auditFieldsPlugin = require('../plugins/auditFields.plugin');

const { Schema } = mongoose;

const weatherEventSchema = new Schema(
  {
    occurredAt: { type: Date, required: true },
    type: { type: String, enum: Object.values(WEATHER_EVENT_TYPES), required: true },
    magnitude: { type: String, trim: true, maxlength: 80, default: '' },
    distanceMiles: { type: Number, min: 0, default: null },
    sourceEventId: { type: String, trim: true, default: '' },
    raw: { type: Schema.Types.Mixed, default: undefined },
  },
  { _id: false }
);

/**
 * Immutable-enough snapshot of weather lookup for a claim date + address.
 * Provider accounts are platform-owned; tenants consume this without their own keys.
 */
const weatherVerificationSchema = new Schema(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', default: null },
    inspectionId: { type: Schema.Types.ObjectId, ref: 'Inspection', default: null },
    lookedUpAt: { type: Date, required: true, default: Date.now },
    dateOfLoss: { type: Date, required: true },
    address: { type: addressSchema, required: true },
    location: { type: geoPointSchema, default: undefined },
    provider: { type: String, trim: true, default: 'hail_trace' },
    providerRequestId: { type: String, trim: true, default: '' },
    matchStatus: {
      type: String,
      enum: Object.values(WEATHER_MATCH_STATUSES),
      default: WEATHER_MATCH_STATUSES.NO_DATA,
      index: true,
    },
    mismatchNote: { type: String, trim: true, maxlength: 1000, default: '' },
    events: { type: [weatherEventSchema], default: [] },
    snapshot: { type: Schema.Types.Mixed, default: undefined },
  },
  { timestamps: true, collection: 'weather_verifications' }
);

weatherVerificationSchema.plugin(tenantScopedPlugin);
weatherVerificationSchema.plugin(auditFieldsPlugin);

weatherVerificationSchema.index({ companyId: 1, jobId: 1 });
weatherVerificationSchema.index({ companyId: 1, dateOfLoss: -1 });

module.exports =
  mongoose.models.WeatherVerification ||
  mongoose.model('WeatherVerification', weatherVerificationSchema);
