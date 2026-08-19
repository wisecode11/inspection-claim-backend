'use strict';

const mongoose = require('mongoose');
const { ROOF_COVERING_TYPES } = require('../enums');
const addressSchema = require('../common/address.schema');
const geoPointSchema = require('../common/geoPoint.schema');
const geocodeSchema = require('../common/geocode.schema');
const tenantScopedPlugin = require('../plugins/tenantScoped.plugin');
const auditFieldsPlugin = require('../plugins/auditFields.plugin');
const softDeletePlugin = require('../plugins/softDelete.plugin');

const { Schema } = mongoose;

const propertySchema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    address: { type: addressSchema, required: true },
    geocode: { type: geocodeSchema, default: () => ({}) },
    location: { type: geoPointSchema, default: undefined },
    yearBuilt: { type: Number, min: 1800, max: 2100, default: null },
    stories: { type: Number, min: 1, max: 20, default: 1 },
    sqft: { type: Number, min: 0, default: null },
    roof: {
      covering: {
        type: String,
        enum: Object.values(ROOF_COVERING_TYPES),
        default: ROOF_COVERING_TYPES.ASPHALT_SHINGLE,
      },
      ageYears: { type: Number, min: 0, max: 80, default: null },
      layers: { type: Number, min: 1, max: 5, default: 1 },
      pitch: { type: String, trim: true, maxlength: 20, default: '' },
    },
    notes: { type: String, trim: true, maxlength: 2000, default: '' },
    clientUuid: { type: String, trim: true, default: '' },
  },
  { timestamps: true, collection: 'properties' }
);

propertySchema.plugin(tenantScopedPlugin);
propertySchema.plugin(auditFieldsPlugin);
propertySchema.plugin(softDeletePlugin);

propertySchema.index({ companyId: 1, customerId: 1 });
propertySchema.index({ location: '2dsphere' });
propertySchema.index({ companyId: 1, 'address.postalCode': 1 });
propertySchema.index({ companyId: 1, clientUuid: 1 }, { unique: true, sparse: true });

propertySchema.virtual('latitude').get(function latitude() {
  return this.geocode && this.geocode.latitude;
});

propertySchema.virtual('longitude').get(function longitude() {
  return this.geocode && this.geocode.longitude;
});

propertySchema.methods.applyGeocode = function applyGeocode({ latitude, longitude, formattedAddress, placeId, provider }) {
  this.geocode.latitude = latitude;
  this.geocode.longitude = longitude;
  this.geocode.formattedAddress = formattedAddress || '';
  this.geocode.placeId = placeId || '';
  this.geocode.provider = provider || 'google';
  this.geocode.status = 'success';
  this.geocode.geocodedAt = new Date();
  this.geocode.error = '';
  this.location = { type: 'Point', coordinates: [longitude, latitude] };
  return this;
};

propertySchema.set('toJSON', { virtuals: true });
propertySchema.set('toObject', { virtuals: true });

module.exports = mongoose.models.Property || mongoose.model('Property', propertySchema);
