'use strict';

const mongoose = require('mongoose');
const { DAMAGE_TYPES } = require('../enums');
const tenantScopedPlugin = require('../plugins/tenantScoped.plugin');
const auditFieldsPlugin = require('../plugins/auditFields.plugin');
const softDeletePlugin = require('../plugins/softDelete.plugin');

const { Schema } = mongoose;

const hitSchema = new Schema(
  {
    x: { type: Number, required: true, min: 0, max: 1 },
    y: { type: Number, required: true, min: 0, max: 1 },
    damageType: {
      type: String,
      enum: Object.values(DAMAGE_TYPES),
      default: DAMAGE_TYPES.HAIL_HIT,
    },
    notes: { type: String, trim: true, maxlength: 300, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

/**
 * Hail test square (typically 10x10 ft = 100 sq ft).
 * Hits are embedded — a square rarely exceeds a few dozen taps.
 * Density is derived on save: hitCount / (sizeSqFt / 100).
 */
const testSquareSchema = new Schema(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    inspectionId: { type: Schema.Types.ObjectId, ref: 'Inspection', required: true, index: true },
    elevationId: { type: Schema.Types.ObjectId, ref: 'Elevation', required: true, index: true },
    label: { type: String, trim: true, maxlength: 80, default: 'Test Square' },
    sizeSqFt: { type: Number, min: 1, default: 100 },
    locationNote: { type: String, trim: true, maxlength: 200, default: '' },
    hits: { type: [hitSchema], default: [] },
    hitCount: { type: Number, min: 0, default: 0 },
    densityPer100SqFt: { type: Number, min: 0, default: 0 },
    clientUuid: { type: String, trim: true, default: '' },
  },
  { timestamps: true, collection: 'test_squares' }
);

testSquareSchema.plugin(tenantScopedPlugin);
testSquareSchema.plugin(auditFieldsPlugin);
testSquareSchema.plugin(softDeletePlugin);

testSquareSchema.pre('save', function computeDensity() {
  this.hitCount = Array.isArray(this.hits) ? this.hits.length : 0;
  const area = this.sizeSqFt || 100;
  this.densityPer100SqFt = area > 0 ? Number(((this.hitCount * 100) / area).toFixed(2)) : this.hitCount;
});

testSquareSchema.index({ companyId: 1, elevationId: 1 });
testSquareSchema.index({ companyId: 1, inspectionId: 1 });
testSquareSchema.index({ companyId: 1, clientUuid: 1 }, { unique: true, sparse: true });

module.exports = mongoose.models.TestSquare || mongoose.model('TestSquare', testSquareSchema);
