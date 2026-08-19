'use strict';

const mongoose = require('mongoose');
const { CANVASS_AREA_STATUSES } = require('../enums');
const geoPointSchema = require('../common/geoPoint.schema');
const tenantScopedPlugin = require('../plugins/tenantScoped.plugin');
const auditFieldsPlugin = require('../plugins/auditFields.plugin');
const softDeletePlugin = require('../plugins/softDelete.plugin');

const { Schema } = mongoose;

/** Neighborhood / zone a company is canvassing after a storm. */
const canvassAreaSchema = new Schema(
  {
    stormEventId: { type: Schema.Types.ObjectId, ref: 'StormEvent', default: null, index: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    status: {
      type: String,
      enum: Object.values(CANVASS_AREA_STATUSES),
      default: CANVASS_AREA_STATUSES.PLANNED,
      index: true,
    },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    center: { type: geoPointSchema, default: undefined },
    radiusMiles: { type: Number, min: 0, default: null },
    notes: { type: String, trim: true, maxlength: 2000, default: '' },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'canvass_areas' }
);

canvassAreaSchema.plugin(tenantScopedPlugin);
canvassAreaSchema.plugin(auditFieldsPlugin);
canvassAreaSchema.plugin(softDeletePlugin);

canvassAreaSchema.index({ companyId: 1, status: 1, createdAt: -1 });
canvassAreaSchema.index({ center: '2dsphere' });

module.exports = mongoose.models.CanvassArea || mongoose.model('CanvassArea', canvassAreaSchema);
