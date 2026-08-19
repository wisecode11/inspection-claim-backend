'use strict';

const mongoose = require('mongoose');
const { ELEVATION_SIDES, ROOF_COVERING_TYPES } = require('../enums');
const tenantScopedPlugin = require('../plugins/tenantScoped.plugin');
const auditFieldsPlugin = require('../plugins/auditFields.plugin');
const softDeletePlugin = require('../plugins/softDelete.plugin');

const { Schema } = mongoose;

const elevationSchema = new Schema(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    inspectionId: { type: Schema.Types.ObjectId, ref: 'Inspection', required: true, index: true },
    side: {
      type: String,
      enum: Object.values(ELEVATION_SIDES),
      required: true,
    },
    label: { type: String, trim: true, maxlength: 80, default: '' },
    pitch: { type: String, trim: true, maxlength: 20, default: '' },
    covering: {
      type: String,
      enum: Object.values(ROOF_COVERING_TYPES),
      default: ROOF_COVERING_TYPES.ASPHALT_SHINGLE,
    },
    stories: { type: Number, min: 1, max: 20, default: 1 },
    notes: { type: String, trim: true, maxlength: 4000, default: '' },
    inspected: { type: Boolean, default: false },
    inspectedAt: { type: Date, default: null },
    sortOrder: { type: Number, default: 0 },
    clientUuid: { type: String, trim: true },
  },
  { timestamps: true, collection: 'elevations' }
);

elevationSchema.plugin(tenantScopedPlugin);
elevationSchema.plugin(auditFieldsPlugin);
elevationSchema.plugin(softDeletePlugin);
elevationSchema.plugin(require('../plugins/clientUuid.plugin'));

elevationSchema.index({ companyId: 1, inspectionId: 1, side: 1 });
elevationSchema.index({ companyId: 1, clientUuid: 1 }, require('../plugins/clientUuid.plugin').clientUuidIndex());

module.exports = mongoose.models.Elevation || mongoose.model('Elevation', elevationSchema);
