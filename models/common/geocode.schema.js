'use strict';

const { Schema } = require('mongoose');
const { GEOCODE_STATUSES } = require('../enums');

/**
 * Result of geocoding a job/property address via Google Maps (or similar).
 * Service layer calls the API; this subdocument stores the outcome.
 */
const geocodeSchema = new Schema(
  {
    status: {
      type: String,
      enum: Object.values(GEOCODE_STATUSES),
      default: GEOCODE_STATUSES.PENDING,
    },
    provider: { type: String, trim: true, default: 'google' },
    latitude: { type: Number, min: -90, max: 90, default: null },
    longitude: { type: Number, min: -180, max: 180, default: null },
    formattedAddress: { type: String, trim: true, maxlength: 400, default: '' },
    placeId: { type: String, trim: true, default: '' },
    confirmed: { type: Boolean, default: false },
    confirmedAt: { type: Date, default: null },
    geocodedAt: { type: Date, default: null },
    error: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { _id: false }
);

module.exports = geocodeSchema;
