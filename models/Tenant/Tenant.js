'use strict';

const mongoose = require('mongoose');
const { TENANT_STATUSES } = require('../enums');
const addressSchema = require('../common/address.schema');
const brandingSchema = require('../common/branding.schema');
const { planLimitsSchema, planFeaturesSchema } = require('../common/planLimits.schema');
const auditFieldsPlugin = require('../plugins/auditFields.plugin');
const softDeletePlugin = require('../plugins/softDelete.plugin');

const { Schema } = mongoose;

const ACCESS_STATUSES = new Set([TENANT_STATUSES.TRIAL, TENANT_STATUSES.ACTIVE]);

/**
 * Company (roofing workspace).
 *
 * Flow: user signup → create company (this doc) → buy subscription → then access.
 * Inspectors / jobs / photos are private because they store this document's _id as companyId.
 *
 * Operational access (create inspectors, create jobs) is allowed only when hasAccess is true.
 */
const tenantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, maxlength: 80 },
    legalName: { type: String, trim: true, maxlength: 200, default: '' },
    status: {
      type: String,
      enum: Object.values(TENANT_STATUSES),
      default: TENANT_STATUSES.PENDING_SUBSCRIPTION,
      index: true,
    },
    subscriptionRequired: { type: Boolean, default: false },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    planId: { type: Schema.Types.ObjectId, ref: 'Plan', default: null, index: true },
    subscriptionId: { type: Schema.Types.ObjectId, ref: 'Subscription', default: null },
    contact: {
      email: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
      phone: { type: String, trim: true, maxlength: 30, default: '' },
      website: { type: String, trim: true, maxlength: 200, default: '' },
      address: { type: addressSchema, default: () => ({}) },
    },
    branding: { type: brandingSchema, default: () => ({}) },
    billing: {
      stripeCustomerId: { type: String, trim: true, default: '' },
      email: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
    },
    usage: {
      seatsUsed: { type: Number, min: 0, default: 0 },
      storageBytes: { type: Number, min: 0, default: 0 },
      inspectionsThisPeriod: { type: Number, min: 0, default: 0 },
      reportsThisPeriod: { type: Number, min: 0, default: 0 },
      periodStart: { type: Date, default: null },
      periodEnd: { type: Date, default: null },
    },
    featureOverrides: { type: planFeaturesSchema, default: undefined },
    limitOverrides: { type: planLimitsSchema, default: undefined },
    trialEndsAt: { type: Date, default: null },
    suspendedAt: { type: Date, default: null },
    suspendedReason: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { timestamps: true, collection: 'tenants' }
);

tenantSchema.plugin(auditFieldsPlugin);
tenantSchema.plugin(softDeletePlugin);

tenantSchema.virtual('hasAccess').get(function hasAccess() {
  if (this.status === TENANT_STATUSES.SUSPENDED || this.status === TENANT_STATUSES.CANCELLED) {
    return false;
  }
  if (!this.subscriptionRequired) {
    return true;
  }
  return ACCESS_STATUSES.has(this.status);
});

tenantSchema.index({ status: 1, createdAt: -1 });
tenantSchema.index({ ownerId: 1 });
tenantSchema.index({ 'billing.stripeCustomerId': 1 }, { unique: true, sparse: true });

tenantSchema.set('toJSON', { virtuals: true });
tenantSchema.set('toObject', { virtuals: true });

module.exports = mongoose.models.Tenant || mongoose.model('Tenant', tenantSchema);
