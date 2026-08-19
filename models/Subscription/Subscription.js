'use strict';

const mongoose = require('mongoose');
const { SUBSCRIPTION_STATUSES, BILLING_INTERVALS } = require('../enums');
const tenantScopedPlugin = require('../plugins/tenantScoped.plugin');
const auditFieldsPlugin = require('../plugins/auditFields.plugin');

const { Schema } = mongoose;

/**
 * Local mirror of the Stripe subscription.
 * Billing UI is web-only — mobile never reads pricing from this collection.
 */
const subscriptionSchema = new Schema(
  {
    planId: { type: Schema.Types.ObjectId, ref: 'Plan', required: true, index: true },
    stripeCustomerId: { type: String, required: true, trim: true, index: true },
    stripeSubscriptionId: { type: String, required: true, trim: true, unique: true },
    status: {
      type: String,
      enum: Object.values(SUBSCRIPTION_STATUSES),
      required: true,
      index: true,
    },
    interval: {
      type: String,
      enum: Object.values(BILLING_INTERVALS),
      default: BILLING_INTERVALS.MONTHLY,
    },
    seats: { type: Number, min: 1, default: 1 },
    currentPeriodStart: { type: Date, required: true },
    currentPeriodEnd: { type: Date, required: true, index: true },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    cancelledAt: { type: Date, default: null },
    trialStart: { type: Date, default: null },
    trialEnd: { type: Date, default: null },
    defaultPaymentMethodId: { type: String, trim: true, default: '' },
  },
  { timestamps: true, collection: 'subscriptions' }
);

subscriptionSchema.plugin(tenantScopedPlugin);
subscriptionSchema.plugin(auditFieldsPlugin);

subscriptionSchema.index({ companyId: 1, status: 1 });

module.exports = mongoose.models.Subscription || mongoose.model('Subscription', subscriptionSchema);
