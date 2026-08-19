'use strict';

const mongoose = require('mongoose');
const { TEMPLATE_SCOPES } = require('../enums');
const tenantScopedPlugin = require('../plugins/tenantScoped.plugin');
const auditFieldsPlugin = require('../plugins/auditFields.plugin');
const softDeletePlugin = require('../plugins/softDelete.plugin');

const { Schema } = mongoose;

/** Building-code citations used in reports. Platform library + optional tenant custom rows. */
const codeCitationSchema = new Schema(
  {
    scope: {
      type: String,
      enum: Object.values(TEMPLATE_SCOPES),
      required: true,
      default: TEMPLATE_SCOPES.PLATFORM,
    },
    state: { type: String, required: true, trim: true, uppercase: true, maxlength: 2, index: true },
    code: { type: String, required: true, trim: true, maxlength: 80 },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, required: true, trim: true, maxlength: 8000 },
    source: { type: String, trim: true, maxlength: 200, default: '' },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true, collection: 'code_citations' }
);

codeCitationSchema.plugin(tenantScopedPlugin, { optional: true });
codeCitationSchema.plugin(auditFieldsPlugin);
codeCitationSchema.plugin(softDeletePlugin);

codeCitationSchema.pre('validate', function requireTenantWhenScoped() {
  if (this.scope === TEMPLATE_SCOPES.TENANT && !this.companyId) {
    this.invalidate('companyId', 'Tenant-scoped citations require companyId');
  }
  if (this.scope === TEMPLATE_SCOPES.PLATFORM && this.companyId) {
    this.invalidate('companyId', 'Platform citations must not have companyId');
  }
});

codeCitationSchema.index({ scope: 1, state: 1, code: 1 });
codeCitationSchema.index({ companyId: 1, state: 1, isActive: 1 });

module.exports =
  mongoose.models.CodeCitation || mongoose.model('CodeCitation', codeCitationSchema);
