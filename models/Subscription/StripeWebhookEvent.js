'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/** Idempotency log for Stripe webhook deliveries (stripeEventId is unique). */
const stripeWebhookEventSchema = new Schema(
  {
    stripeEventId: { type: String, required: true, unique: true, trim: true },
    type: { type: String, required: true, trim: true, index: true },
    livemode: { type: Boolean, default: false },
    processedAt: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ['processed', 'ignored', 'failed'],
      default: 'processed',
    },
    errorMessage: { type: String, trim: true, default: '' },
  },
  { timestamps: true, collection: 'stripe_webhook_events' }
);

stripeWebhookEventSchema.index({ createdAt: -1 });

module.exports =
  mongoose.models.StripeWebhookEvent ||
  mongoose.model('StripeWebhookEvent', stripeWebhookEventSchema);
