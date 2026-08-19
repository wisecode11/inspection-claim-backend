'use strict';

const mongoose = require('mongoose');
const addressSchema = require('../common/address.schema');
const tenantScopedPlugin = require('../plugins/tenantScoped.plugin');
const auditFieldsPlugin = require('../plugins/auditFields.plugin');
const softDeletePlugin = require('../plugins/softDelete.plugin');

const { Schema } = mongoose;

/** Homeowner / property owner belonging to a roofing company. */
const customerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    email: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
    phone: { type: String, trim: true, maxlength: 30, default: '' },
    secondaryPhone: { type: String, trim: true, maxlength: 30, default: '' },
    mailingAddress: { type: addressSchema, default: () => ({}) },
    notes: { type: String, trim: true, maxlength: 2000, default: '' },
    clientUuid: { type: String, trim: true },
  },
  { timestamps: true, collection: 'customers' }
);

customerSchema.plugin(tenantScopedPlugin);
customerSchema.plugin(auditFieldsPlugin);
customerSchema.plugin(softDeletePlugin);
customerSchema.plugin(require('../plugins/clientUuid.plugin'));

customerSchema.index({ companyId: 1, name: 1 });
customerSchema.index({ companyId: 1, email: 1 });
customerSchema.index({ companyId: 1, phone: 1 });
customerSchema.index({ companyId: 1, clientUuid: 1 }, require('../plugins/clientUuid.plugin').clientUuidIndex());

module.exports = mongoose.models.Customer || mongoose.model('Customer', customerSchema);
