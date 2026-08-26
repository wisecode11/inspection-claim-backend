'use strict';

const mongoose = require('mongoose');
const { BILLING_INTERVALS } = require('../enums');
const { planLimitsSchema, planFeaturesSchema } = require('../common/planLimits.schema');
const auditFieldsPlugin = require('../plugins/auditFields.plugin');

const { Schema } = mongoose;

const billingOptionCopySchema = new Schema(
  {
    priceLabel: { type: String, trim: true, maxlength: 120, default: '' },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    bullets: {
      type: [{ type: String, trim: true, maxlength: 200 }],
      default: [],
    },
  },
  { _id: false }
);

/**
 * Platform-level pricing catalog.
 * Tenants subscribe to a Plan; limits/features are enforced at API layer.
 */
const planSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    pricing: {
      monthlyAmount: { type: Number, min: 0, default: 0 },
      yearlyAmount: { type: Number, min: 0, default: 0 },
      currency: { type: String, trim: true, uppercase: true, default: 'USD', maxlength: 3 },
      perSeat: { type: Boolean, default: true },
    },
    /** Per billing-option marketing copy shown on company plan picker. */
    billingOptions: {
      trial: { type: billingOptionCopySchema, default: () => ({}) },
      monthly: { type: billingOptionCopySchema, default: () => ({}) },
      annual: { type: billingOptionCopySchema, default: () => ({}) },
    },
    stripe: {
      productId: { type: String, trim: true, default: '', index: true },
      monthlyPriceId: { type: String, trim: true, default: '' },
      yearlyPriceId: { type: String, trim: true, default: '' },
    },
    defaultInterval: {
      type: String,
      enum: Object.values(BILLING_INTERVALS),
      default: BILLING_INTERVALS.MONTHLY,
    },
    trialDays: { type: Number, min: 0, default: 14 },
    limits: { type: planLimitsSchema, default: () => ({}) },
    features: { type: planFeaturesSchema, default: () => ({}) },
    isPublic: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'plans' }
);

planSchema.plugin(auditFieldsPlugin);

planSchema.index({ isActive: 1, sortOrder: 1 });

module.exports = mongoose.models.Plan || mongoose.model('Plan', planSchema);
