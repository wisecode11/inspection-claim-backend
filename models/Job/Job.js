'use strict';

const mongoose = require('mongoose');
const {
  JOB_TYPES,
  JOB_STATUSES,
  JOB_SOURCES,
  CLAIM_STATUSES,
  USER_ROLES,
} = require('../enums');
const addressSchema = require('../common/address.schema');
const geoPointSchema = require('../common/geoPoint.schema');
const geocodeSchema = require('../common/geocode.schema');
const tenantScopedPlugin = require('../plugins/tenantScoped.plugin');
const auditFieldsPlugin = require('../plugins/auditFields.plugin');
const softDeletePlugin = require('../plugins/softDelete.plugin');

const { Schema } = mongoose;

/**
 * Jobs are created by company admin after subscription access.
 * assignedTo = inspector of THIS company only.
 * Inspector feed: { companyId: inspector.companyId, assignedTo: inspector._id }
 *
 * Address is stored on the job. Service layer geocodes it (Google) and
 * writes latitude/longitude + GeoJSON Point onto this document.
 */
const jobSchema = new Schema(
  {
    jobNumber: { type: String, required: true, trim: true, maxlength: 40 },
    type: {
      type: String,
      enum: Object.values(JOB_TYPES),
      default: JOB_TYPES.INSPECTION,
    },
    status: {
      type: String,
      enum: Object.values(JOB_STATUSES),
      default: JOB_STATUSES.DRAFT,
      index: true,
    },
    source: {
      type: String,
      enum: Object.values(JOB_SOURCES),
      default: JOB_SOURCES.INBOUND,
    },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    address: { type: addressSchema, required: true },
    geocode: { type: geocodeSchema, default: () => ({}) },
    location: { type: geoPointSchema, default: undefined },
    canvassAreaId: { type: Schema.Types.ObjectId, ref: 'CanvassArea', default: null },
    stormEventId: { type: Schema.Types.ObjectId, ref: 'StormEvent', default: null },
    scheduledAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    claim: {
      insuranceCompany: { type: String, trim: true, maxlength: 160, default: '' },
      policyNumber: { type: String, trim: true, maxlength: 80, default: '' },
      claimNumber: { type: String, trim: true, maxlength: 80, default: '' },
      dateOfLoss: { type: Date, default: null },
      status: {
        type: String,
        enum: Object.values(CLAIM_STATUSES),
        default: CLAIM_STATUSES.NOT_FILED,
      },
    },
    notes: { type: String, trim: true, maxlength: 4000, default: '' },
    sync: {
      version: { type: Number, default: 1 },
      lastSyncedAt: { type: Date, default: null },
      lastDeviceId: { type: String, trim: true, default: '' },
    },
    clientUuid: { type: String, trim: true },
  },
  { timestamps: true, collection: 'jobs' }
);

jobSchema.plugin(tenantScopedPlugin);
jobSchema.plugin(auditFieldsPlugin);
jobSchema.plugin(softDeletePlugin);
jobSchema.plugin(require('../plugins/clientUuid.plugin'));

jobSchema.index({ companyId: 1, jobNumber: 1 }, { unique: true });
jobSchema.index({ companyId: 1, assignedTo: 1, status: 1 });
jobSchema.index({ companyId: 1, createdAt: -1 });
jobSchema.index({ companyId: 1, 'claim.status': 1 });
jobSchema.index({ companyId: 1, clientUuid: 1 }, require('../plugins/clientUuid.plugin').clientUuidIndex());
jobSchema.index({ location: '2dsphere' });

jobSchema.virtual('latitude').get(function latitude() {
  return this.geocode && this.geocode.latitude;
});

jobSchema.virtual('longitude').get(function longitude() {
  return this.geocode && this.geocode.longitude;
});

jobSchema.methods.applyGeocode = function applyGeocode({ latitude, longitude, formattedAddress, placeId, provider }) {
  this.geocode.latitude = latitude;
  this.geocode.longitude = longitude;
  this.geocode.formattedAddress = formattedAddress || '';
  this.geocode.placeId = placeId || '';
  this.geocode.provider = provider || 'google';
  this.geocode.status = 'success';
  this.geocode.geocodedAt = new Date();
  this.geocode.error = '';
  this.geocode.confirmed = false;
  this.geocode.confirmedAt = null;
  this.location = { type: 'Point', coordinates: [longitude, latitude] };
  return this;
};

jobSchema.methods.confirmLocation = function confirmLocation({ latitude, longitude }) {
  this.geocode.latitude = latitude;
  this.geocode.longitude = longitude;
  this.geocode.status = 'success';
  this.geocode.error = '';
  this.geocode.confirmed = true;
  this.geocode.confirmedAt = new Date();
  this.location = { type: 'Point', coordinates: [longitude, latitude] };
  return this;
};

jobSchema.statics.forUser = function forUser(user) {
  const filter = { companyId: user.companyId };
  if (user.role === USER_ROLES.INSPECTOR) {
    filter.assignedTo = user._id;
  }
  return this.find(filter);
};

jobSchema.set('toJSON', { virtuals: true });
jobSchema.set('toObject', { virtuals: true });

module.exports = mongoose.models.Job || mongoose.model('Job', jobSchema);
