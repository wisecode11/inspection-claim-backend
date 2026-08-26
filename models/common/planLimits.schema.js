'use strict';

const { Schema } = require('mongoose');

const planLimitsSchema = new Schema(
  {
    seats: { type: Number, min: 1, default: 9999 },
    inspectionsPerMonth: { type: Number, min: 0, default: 0 },
    storageGb: { type: Number, min: 0, default: 0 },
    photosPerInspection: { type: Number, min: 1, default: 80 },
    reportsPerMonth: { type: Number, min: 0, default: 0 },
  },
  { _id: false }
);

const planFeaturesSchema = new Schema(
  {
    weatherVerification: { type: Boolean, default: true },
    stormMap: { type: Boolean, default: true },
    customTemplates: { type: Boolean, default: true },
    customChecklists: { type: Boolean, default: true },
    analytics: { type: Boolean, default: true },
    whatsappShare: { type: Boolean, default: true },
    prioritySupport: { type: Boolean, default: false },
  },
  { _id: false }
);

module.exports = { planLimitsSchema, planFeaturesSchema };
