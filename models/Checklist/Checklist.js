'use strict';

const mongoose = require('mongoose');
const { TEMPLATE_SCOPES, CHECKLIST_STEP_TYPES } = require('../enums');
const tenantScopedPlugin = require('../plugins/tenantScoped.plugin');
const auditFieldsPlugin = require('../plugins/auditFields.plugin');
const softDeletePlugin = require('../plugins/softDelete.plugin');

const { Schema } = mongoose;

const checklistStepSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 80 },
    label: { type: String, required: true, trim: true, maxlength: 200 },
    type: {
      type: String,
      enum: Object.values(CHECKLIST_STEP_TYPES),
      required: true,
    },
    required: { type: Boolean, default: false },
    helpText: { type: String, trim: true, maxlength: 500, default: '' },
    options: [{ type: String, trim: true, maxlength: 120 }],
    elevationRequired: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: true }
);

/**
 * Guided inspection workflow.
 * scope=platform → default library; cloned to a tenant on signup.
 * scope=tenant → company-customized checklist.
 */
const checklistSchema = new Schema(
  {
    scope: {
      type: String,
      enum: Object.values(TEMPLATE_SCOPES),
      required: true,
      default: TEMPLATE_SCOPES.TENANT,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    version: { type: Number, min: 1, default: 1 },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    steps: { type: [checklistStepSchema], default: [] },
  },
  { timestamps: true, collection: 'checklists' }
);

checklistSchema.plugin(tenantScopedPlugin, { optional: true });
checklistSchema.plugin(auditFieldsPlugin);
checklistSchema.plugin(softDeletePlugin);

checklistSchema.pre('validate', function requireTenantWhenScoped() {
  if (this.scope === TEMPLATE_SCOPES.TENANT && !this.companyId) {
    this.invalidate('companyId', 'Tenant-scoped checklists require companyId');
  }
  if (this.scope === TEMPLATE_SCOPES.PLATFORM && this.companyId) {
    this.invalidate('companyId', 'Platform checklists must not have companyId');
  }
});

checklistSchema.index({ companyId: 1, isDefault: 1, isActive: 1 });
checklistSchema.index({ scope: 1, isActive: 1 });

module.exports = mongoose.models.Checklist || mongoose.model('Checklist', checklistSchema);
