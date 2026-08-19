'use strict';

const mongoose = require('mongoose');
const { STORM_TYPES } = require('../enums');
const geoPointSchema = require('../common/geoPoint.schema');
const auditFieldsPlugin = require('../plugins/auditFields.plugin');

const { Schema } = mongoose;

/**
 * Platform-level storm events (Hail Trace / weather provider).
 * Shared across tenants so each roofing company does not need its own weather account.
 */
const stormEventSchema = new Schema(
  {
    provider: { type: String, required: true, trim: true, default: 'hail_trace' },
    providerEventId: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: Object.values(STORM_TYPES),
      required: true,
      index: true,
    },
    occurredAt: { type: Date, required: true, index: true },
    magnitude: { type: String, trim: true, maxlength: 80, default: '' },
    summary: { type: String, trim: true, maxlength: 500, default: '' },
    center: { type: geoPointSchema, default: undefined },
    geometry: {
      type: { type: String, enum: ['Polygon', 'MultiPolygon'], default: undefined },
      coordinates: { type: Schema.Types.Mixed, default: undefined },
    },
    radiusMiles: { type: Number, min: 0, default: null },
    expiresAt: { type: Date, default: null },
    raw: { type: Schema.Types.Mixed, default: undefined },
  },
  { timestamps: true, collection: 'storm_events' }
);

stormEventSchema.plugin(auditFieldsPlugin);

stormEventSchema.index({ provider: 1, providerEventId: 1 }, { unique: true });
stormEventSchema.index({ center: '2dsphere' });
stormEventSchema.index({ type: 1, occurredAt: -1 });

module.exports = mongoose.models.StormEvent || mongoose.model('StormEvent', stormEventSchema);
