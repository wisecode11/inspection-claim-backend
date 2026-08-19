'use strict';

const mongoose = require('mongoose');
const { AUDIT_ACTIONS, USER_ROLES } = require('../enums');
const tenantScopedPlugin = require('../plugins/tenantScoped.plugin');

const { Schema } = mongoose;

/**
 * Append-only audit trail. Never update or soft-delete these rows.
 * Platform admin impersonation is recorded here with both actor identities.
 */
const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    actorRole: {
      type: String,
      enum: [...Object.values(USER_ROLES), 'system'],
      default: 'system',
    },
    action: {
      type: String,
      enum: Object.values(AUDIT_ACTIONS),
      required: true,
      index: true,
    },
    resourceType: { type: String, required: true, trim: true, maxlength: 80, index: true },
    resourceId: { type: Schema.Types.ObjectId, default: null, index: true },
    ip: { type: String, trim: true, default: '' },
    userAgent: { type: String, trim: true, maxlength: 400, default: '' },
    impersonation: {
      originalAdminId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      targetCompanyId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null },
    },
    metadata: { type: Schema.Types.Mixed, default: undefined },
  },
  { timestamps: true, collection: 'audit_logs' }
);

auditLogSchema.plugin(tenantScopedPlugin, { optional: true });

auditLogSchema.index({ companyId: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
