'use strict';

const mongoose = require('mongoose');
const { INVOICE_STATUSES } = require('../enums');
const tenantScopedPlugin = require('../plugins/tenantScoped.plugin');

const { Schema } = mongoose;

/** Cached Stripe invoices for the company billing portal and platform revenue dashboards. */
const invoiceSchema = new Schema(
  {
    stripeInvoiceId: { type: String, required: true, unique: true, trim: true },
    stripeSubscriptionId: { type: String, trim: true, default: '', index: true },
    number: { type: String, trim: true, default: '' },
    status: {
      type: String,
      enum: Object.values(INVOICE_STATUSES),
      required: true,
      index: true,
    },
    currency: { type: String, trim: true, uppercase: true, default: 'USD', maxlength: 3 },
    subtotal: { type: Number, min: 0, default: 0 },
    tax: { type: Number, min: 0, default: 0 },
    total: { type: Number, min: 0, default: 0 },
    amountPaid: { type: Number, min: 0, default: 0 },
    amountDue: { type: Number, min: 0, default: 0 },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    hostedInvoiceUrl: { type: String, trim: true, default: '' },
    pdfUrl: { type: String, trim: true, default: '' },
    paidAt: { type: Date, default: null },
    dueDate: { type: Date, default: null },
    attemptCount: { type: Number, min: 0, default: 0 },
    nextPaymentAttemptAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'invoices' }
);

invoiceSchema.plugin(tenantScopedPlugin);

invoiceSchema.index({ companyId: 1, createdAt: -1 });
invoiceSchema.index({ companyId: 1, status: 1 });

module.exports = mongoose.models.Invoice || mongoose.model('Invoice', invoiceSchema);
