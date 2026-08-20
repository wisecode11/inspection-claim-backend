'use strict';

const { USER_ROLES } = require('../models/enums');

/**
 * Fine-grained capabilities for office staff.
 * Company admins always pass permission checks.
 */
const PERMISSIONS = Object.freeze({
  COMPANY_VIEW: 'company:view',
  COMPANY_UPDATE: 'company:update',
  CODES_MANAGE: 'codes:manage',
  USERS_MANAGE: 'users:manage',
  INSPECTORS_VIEW: 'inspectors:view',
  INSPECTORS_MANAGE: 'inspectors:manage',
  STAFF_MANAGE: 'staff:manage',
  JOBS_VIEW: 'jobs:view',
  JOBS_CREATE: 'jobs:create',
  JOBS_EDIT: 'jobs:edit',
  JOBS_ASSIGN: 'jobs:assign',
  JOBS_CANCEL: 'jobs:cancel',
  JOBS_STATUS: 'jobs:status',
  REPORTS_REVIEW: 'reports:review',
  REPORTS_EDIT_NARRATIVE: 'reports:edit_narrative',
  REPORTS_GENERATE: 'reports:generate',
  REPORTS_SHARE: 'reports:share',
  PERMISSIONS_MANAGE: 'permissions:manage',
});

const STAFF_DEFAULT_PERMISSIONS = Object.freeze([
  PERMISSIONS.COMPANY_VIEW,
  PERMISSIONS.INSPECTORS_VIEW,
  PERMISSIONS.JOBS_VIEW,
  PERMISSIONS.JOBS_CREATE,
  PERMISSIONS.JOBS_EDIT,
  PERMISSIONS.JOBS_ASSIGN,
  PERMISSIONS.JOBS_CANCEL,
  PERMISSIONS.JOBS_STATUS,
  PERMISSIONS.REPORTS_REVIEW,
  PERMISSIONS.REPORTS_EDIT_NARRATIVE,
  PERMISSIONS.REPORTS_GENERATE,
  PERMISSIONS.REPORTS_SHARE,
]);

const ALL_PERMISSIONS = Object.freeze(Object.values(PERMISSIONS));

function userHasPermission(user, permission) {
  if (!user) return false;
  if (user.role === USER_ROLES.COMPANY_ADMIN || user.role === USER_ROLES.PLATFORM_ADMIN) {
    return true;
  }
  if (user.role !== USER_ROLES.OFFICE_STAFF) {
    return false;
  }
  const granted = Array.isArray(user.permissions) ? user.permissions : [];
  return granted.includes(permission);
}

module.exports = {
  PERMISSIONS,
  STAFF_DEFAULT_PERMISSIONS,
  ALL_PERMISSIONS,
  userHasPermission,
};
