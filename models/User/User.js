'use strict';

const mongoose = require('mongoose');
const { USER_ROLES, USER_STATUSES } = require('../enums');
const tenantScopedPlugin = require('../plugins/tenantScoped.plugin');
const auditFieldsPlugin = require('../plugins/auditFields.plugin');
const softDeletePlugin = require('../plugins/softDelete.plugin');

const { Schema } = mongoose;

/**
 * Access flow
 * 1. Company admin signs up          → status pending_setup, companyId null
 * 2. Creates company                 → companyId set, still no operational access
 * 3. Buys subscription               → company status trial/active → user status active
 * 4. Creates inspector               → inspector saved WITH companyId (private to that company)
 * 5. Inspector gets 24h email link   → status invited until login
 *
 * Inspectors never see another company's data: every query is { companyId, assignedTo }.
 */
const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      unique: true,
    },
    passwordHash: {
      type: String,
      select: false,
      required() {
        if (this.status === USER_STATUSES.INVITED) return false;
        if (this.status === USER_STATUSES.PENDING_SETUP) return true;
        return this.status === USER_STATUSES.ACTIVE;
      },
    },
    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(USER_STATUSES),
      default: USER_STATUSES.PENDING_SETUP,
      index: true,
    },
    profile: {
      firstName: { type: String, trim: true, maxlength: 80, default: '' },
      lastName: { type: String, trim: true, maxlength: 80, default: '' },
      phone: { type: String, trim: true, maxlength: 30, default: '' },
      avatarUrl: { type: String, trim: true, default: '' },
      licenseNumber: { type: String, trim: true, maxlength: 80, default: '' },
    },
    permissions: [{ type: String, trim: true }],
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, trim: true, default: '' },
    passwordChangedAt: { type: Date, default: null },
    emailVerifiedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'users' }
);

userSchema.plugin(tenantScopedPlugin, { optional: true });
userSchema.plugin(auditFieldsPlugin);
userSchema.plugin(softDeletePlugin);

userSchema.index({ companyId: 1, role: 1, status: 1 });
userSchema.index({ companyId: 1, 'profile.lastName': 1, 'profile.firstName': 1 });

userSchema.pre('validate', function enforceCompanyIsolation() {
  const isPlatformAdmin = this.role === USER_ROLES.PLATFORM_ADMIN;
  const isOwnerSignup = this.role === USER_ROLES.COMPANY_ADMIN && this.status === USER_STATUSES.PENDING_SETUP;

  if (isPlatformAdmin && this.companyId) {
    this.invalidate('companyId', 'Platform admins must not belong to a company');
  }

  if (this.role === USER_ROLES.INSPECTOR && !this.companyId) {
    this.invalidate('companyId', 'Inspector must be saved with companyId');
  }

  if (this.role === USER_ROLES.OFFICE_STAFF && !this.companyId) {
    this.invalidate('companyId', 'Staff must be saved with companyId');
  }

  if (this.role === USER_ROLES.COMPANY_ADMIN && !isOwnerSignup && !this.companyId) {
    this.invalidate('companyId', 'Company admin must belong to a company after setup');
  }
});

userSchema.virtual('fullName').get(function fullName() {
  return `${this.profile.firstName} ${this.profile.lastName}`.trim();
});

userSchema.set('toJSON', {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
