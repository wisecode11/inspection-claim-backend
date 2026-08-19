'use strict';

const mongoose = require('mongoose');
const {
  USER_ROLES,
  INVITE_STATUSES,
  INVITE_PURPOSES,
  INVITE_TTL_HOURS,
} = require('../enums');
const tenantScopedPlugin = require('../plugins/tenantScoped.plugin');
const auditFieldsPlugin = require('../plugins/auditFields.plugin');

const { Schema } = mongoose;

const ONE_DAY_MS = INVITE_TTL_HOURS * 60 * 60 * 1000;

/**
 * Inspector access:
 * Company admin creates the inspector user (with companyId) then this invite is emailed.
 * Link expires in 24 hours. Inspector opens Gmail link → login / set password → status active.
 */
const inviteSchema = new Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    role: {
      type: String,
      enum: [USER_ROLES.COMPANY_ADMIN, USER_ROLES.INSPECTOR, USER_ROLES.OFFICE_STAFF],
      required: true,
      default: USER_ROLES.INSPECTOR,
    },
    purpose: {
      type: String,
      enum: Object.values(INVITE_PURPOSES),
      default: INVITE_PURPOSES.INSPECTOR_LOGIN,
    },
    status: {
      type: String,
      enum: Object.values(INVITE_STATUSES),
      default: INVITE_STATUSES.PENDING,
      index: true,
    },
    tokenHash: { type: String, required: true, unique: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
    acceptedUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, collection: 'invites' }
);

inviteSchema.plugin(tenantScopedPlugin);
inviteSchema.plugin(auditFieldsPlugin);

inviteSchema.pre('validate', function setOneDayExpiry() {
  if (!this.expiresAt) {
    this.expiresAt = new Date(Date.now() + ONE_DAY_MS);
  }
});

inviteSchema.methods.isExpired = function isExpired() {
  return !this.expiresAt || this.expiresAt.getTime() < Date.now();
};

inviteSchema.index({ companyId: 1, email: 1, status: 1 });
inviteSchema.index({ companyId: 1, userId: 1, status: 1 });
inviteSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { status: 'pending' } }
);

module.exports = mongoose.models.Invite || mongoose.model('Invite', inviteSchema);
