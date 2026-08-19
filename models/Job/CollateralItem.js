'use strict';

const mongoose = require('mongoose');
const { COLLATERAL_TYPES } = require('../enums');
const tenantScopedPlugin = require('../plugins/tenantScoped.plugin');
const auditFieldsPlugin = require('../plugins/auditFields.plugin');
const softDeletePlugin = require('../plugins/softDelete.plugin');

const { Schema } = mongoose;

const collateralItemSchema = new Schema(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    inspectionId: { type: Schema.Types.ObjectId, ref: 'Inspection', required: true, index: true },
    type: {
      type: String,
      enum: Object.values(COLLATERAL_TYPES),
      required: true,
    },
    label: { type: String, trim: true, maxlength: 120, default: '' },
    damaged: { type: Boolean, default: false },
    damageDescription: { type: String, trim: true, maxlength: 2000, default: '' },
    inspected: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    clientUuid: { type: String, trim: true },
  },
  { timestamps: true, collection: 'collateral_items' }
);

collateralItemSchema.plugin(tenantScopedPlugin);
collateralItemSchema.plugin(auditFieldsPlugin);
collateralItemSchema.plugin(softDeletePlugin);
collateralItemSchema.plugin(require('../plugins/clientUuid.plugin'));

collateralItemSchema.index({ companyId: 1, inspectionId: 1, type: 1 });
collateralItemSchema.index({ companyId: 1, clientUuid: 1 }, require('../plugins/clientUuid.plugin').clientUuidIndex());

module.exports =
  mongoose.models.CollateralItem || mongoose.model('CollateralItem', collateralItemSchema);
