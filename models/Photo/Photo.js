'use strict';

const mongoose = require('mongoose');
const { PHOTO_SUBJECT_TYPES, PHOTO_STATUSES, CUSTODY_EVENTS, DAMAGE_TYPES } = require('../enums');
const geoPointSchema = require('../common/geoPoint.schema');
const storageFileSchema = require('../common/storageFile.schema');
const tenantScopedPlugin = require('../plugins/tenantScoped.plugin');
const auditFieldsPlugin = require('../plugins/auditFields.plugin');
const softDeletePlugin = require('../plugins/softDelete.plugin');

const { Schema } = mongoose;

const annotationSchema = new Schema(
  {
    type: { type: String, enum: ['arrow', 'circle', 'box', 'freehand', 'label'], required: true },
    geometry: { type: Schema.Types.Mixed, required: true },
    label: { type: String, trim: true, maxlength: 120, default: '' },
    color: { type: String, trim: true, default: '#FF0000' },
    damageType: {
      type: String,
      enum: [...Object.values(DAMAGE_TYPES), ''],
      default: '',
    },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const custodyEventSchema = new Schema(
  {
    event: { type: String, enum: Object.values(CUSTODY_EVENTS), required: true },
    at: { type: Date, required: true, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deviceId: { type: String, trim: true, default: '' },
    hash: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

/**
 * Claim-grade photo. File bytes live in object storage; this document is the ledger.
 * GPS/date stamps, annotations, and chain-of-custody stay on the document.
 */
const photoSchema = new Schema(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    inspectionId: { type: Schema.Types.ObjectId, ref: 'Inspection', default: null, index: true },
    subjectType: {
      type: String,
      enum: Object.values(PHOTO_SUBJECT_TYPES),
      required: true,
    },
    subjectId: { type: Schema.Types.ObjectId, default: null },
    storage: { type: storageFileSchema, default: () => ({}) },
    capture: {
      takenAt: { type: Date, default: null },
      location: { type: geoPointSchema, default: undefined },
      altitudeMeters: { type: Number, default: null },
      heading: { type: Number, min: 0, max: 360, default: null },
      deviceModel: { type: String, trim: true, maxlength: 80, default: '' },
      appVersion: { type: String, trim: true, maxlength: 40, default: '' },
    },
    stamps: {
      dateOverlay: { type: Boolean, default: true },
      gpsOverlay: { type: Boolean, default: true },
    },
    caption: { type: String, trim: true, maxlength: 500, default: '' },
    annotations: { type: [annotationSchema], default: [] },
    chainOfCustody: { type: [custodyEventSchema], default: [] },
    status: {
      type: String,
      enum: Object.values(PHOTO_STATUSES),
      default: PHOTO_STATUSES.LOCAL,
      index: true,
    },
    sortOrder: { type: Number, default: 0 },
    includeInReport: { type: Boolean, default: true },
    clientUuid: { type: String, trim: true },
  },
  { timestamps: true, collection: 'photos' }
);

photoSchema.plugin(tenantScopedPlugin);
photoSchema.plugin(auditFieldsPlugin);
photoSchema.plugin(softDeletePlugin);
photoSchema.plugin(require('../plugins/clientUuid.plugin'));

photoSchema.index({ companyId: 1, inspectionId: 1, sortOrder: 1 });
photoSchema.index({ companyId: 1, subjectType: 1, subjectId: 1 });
photoSchema.index({ companyId: 1, status: 1 });
photoSchema.index({ companyId: 1, clientUuid: 1 }, require('../plugins/clientUuid.plugin').clientUuidIndex());

module.exports = mongoose.models.Photo || mongoose.model('Photo', photoSchema);
