'use strict';

const mongoose = require('mongoose');
const { TEMPLATE_SCOPES } = require('../enums');
const tenantScopedPlugin = require('../plugins/tenantScoped.plugin');
const auditFieldsPlugin = require('../plugins/auditFields.plugin');
const softDeletePlugin = require('../plugins/softDelete.plugin');

const { Schema } = mongoose;

const templateSectionSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 80 },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    include: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    body: { type: String, trim: true, maxlength: 8000, default: '' },
  },
  { _id: true }
);

const reportTemplateSchema = new Schema(
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
    sections: { type: [templateSectionSchema], default: [] },
    definitions: { type: String, trim: true, maxlength: 8000, default: '' },
    legalFooter: { type: String, trim: true, maxlength: 4000, default: '' },
    codeCitationIds: [{ type: Schema.Types.ObjectId, ref: 'CodeCitation' }],
    includeWeatherPage: { type: Boolean, default: true },
    includeTestSquares: { type: Boolean, default: true },
    includeCollateral: { type: Boolean, default: true },
    includePhotoIndex: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'report_templates' }
);

reportTemplateSchema.plugin(tenantScopedPlugin, { optional: true });
reportTemplateSchema.plugin(auditFieldsPlugin);
reportTemplateSchema.plugin(softDeletePlugin);

reportTemplateSchema.pre('validate', function requireTenantWhenScoped() {
  if (this.scope === TEMPLATE_SCOPES.TENANT && !this.companyId) {
    this.invalidate('companyId', 'Tenant-scoped templates require companyId');
  }
  if (this.scope === TEMPLATE_SCOPES.PLATFORM && this.companyId) {
    this.invalidate('companyId', 'Platform templates must not have companyId');
  }
});

reportTemplateSchema.index({ companyId: 1, isDefault: 1, isActive: 1 });
reportTemplateSchema.index({ scope: 1, isActive: 1 });

module.exports =
  mongoose.models.ReportTemplate || mongoose.model('ReportTemplate', reportTemplateSchema);
