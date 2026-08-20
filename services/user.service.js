'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const { User, Tenant, Job, Report } = require('../models');
const { USER_ROLES, USER_STATUSES, JOB_STATUSES } = require('../models/enums');
const HttpError = require('../utils/httpError');
const { hashPassword } = require('../utils/password');
const { toUserResponse } = require('../utils/userResponse');
const { STAFF_DEFAULT_PERMISSIONS, ALL_PERMISSIONS } = require('../utils/permissions');
const { normalizeStatus } = require('../utils/jobStatus');
const { sendInspectorCredentials } = require('./email.service');
const jobService = require('./job.service');

const OPEN_JOB_STATUSES = [
  JOB_STATUSES.DRAFT,
  JOB_STATUSES.ASSIGNED,
  JOB_STATUSES.IN_PROGRESS,
  JOB_STATUSES.SUBMITTED,
  JOB_STATUSES.REVIEWED,
  JOB_STATUSES.REOPENED,
  JOB_STATUSES.ON_HOLD,
];

const COMPLETED_JOB_STATUSES = [JOB_STATUSES.COMPLETED];

function memberName(user) {
  const name = `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim();
  return name || user.email;
}

function toStaffMember(user, metrics = {}) {
  const jobsAssigned = metrics.jobsAssigned || 0;
  const jobsCompleted = metrics.jobsCompleted || 0;
  const reportsSubmitted = metrics.reportsSubmitted || 0;
  const jobsTotal = metrics.jobsTotal || jobsAssigned + jobsCompleted;
  const completionRate = jobsTotal > 0 ? Math.round((jobsCompleted / jobsTotal) * 100) : 0;

  return {
    ...toUserResponse(user),
    name: memberName(user),
    role: user.role,
    status: user.status,
    jobsAssigned,
    jobsCompleted,
    reportsSubmitted,
    jobsTotal,
    productivity: {
      completionRate,
      avgJobsPerWeek: metrics.avgJobsPerWeek || 0,
    },
  };
}

function parseCertifications(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && item.name)
    .map((item) => ({
      name: String(item.name).trim(),
      issuer: String(item.issuer || '').trim(),
      number: String(item.number || '').trim(),
      issuedAt: item.issuedAt ? new Date(item.issuedAt) : null,
      expiresAt: item.expiresAt ? new Date(item.expiresAt) : null,
    }));
}

async function inspectorMetricsMap(companyId, inspectorIds) {
  const empty = new Map();
  if (!inspectorIds.length) return empty;

  const [assignedRows, completedRows, reportRows] = await Promise.all([
    Job.aggregate([
      {
        $match: {
          companyId,
          assignedTo: { $in: inspectorIds },
          status: { $in: OPEN_JOB_STATUSES },
        },
      },
      { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
    ]),
    Job.aggregate([
      {
        $match: {
          companyId,
          assignedTo: { $in: inspectorIds },
          status: { $in: COMPLETED_JOB_STATUSES },
        },
      },
      { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
    ]),
    Report.aggregate([
      {
        $match: {
          companyId,
          generatedBy: { $in: inspectorIds },
        },
      },
      { $group: { _id: '$generatedBy', count: { $sum: 1 } } },
    ]),
  ]);

  const map = new Map();
  for (const id of inspectorIds) {
    map.set(String(id), {
      jobsAssigned: 0,
      jobsCompleted: 0,
      reportsSubmitted: 0,
      jobsTotal: 0,
      avgJobsPerWeek: 0,
    });
  }
  for (const row of assignedRows) {
    const key = String(row._id);
    const current = map.get(key) || {};
    current.jobsAssigned = row.count;
    map.set(key, current);
  }
  for (const row of completedRows) {
    const key = String(row._id);
    const current = map.get(key) || {};
    current.jobsCompleted = row.count;
    map.set(key, current);
  }
  for (const row of reportRows) {
    const key = String(row._id);
    const current = map.get(key) || {};
    current.reportsSubmitted = row.count;
    map.set(key, current);
  }
  for (const [key, value] of map.entries()) {
    value.jobsTotal = (value.jobsAssigned || 0) + (value.jobsCompleted || 0);
    value.avgJobsPerWeek = Number((value.jobsCompleted / 4).toFixed(1));
    map.set(key, value);
  }
  return map;
}

async function findCompanyMember(owner, memberId, role) {
  if (!owner.companyId) {
    throw new HttpError(400, 'Create a company first');
  }
  if (!mongoose.isValidObjectId(memberId)) {
    throw new HttpError(400, 'Invalid member id');
  }

  const member = await User.findOne({
    _id: memberId,
    companyId: owner.companyId,
    role,
  });
  if (!member) {
    throw new HttpError(404, `${role === USER_ROLES.INSPECTOR ? 'Inspector' : 'Staff member'} not found`);
  }
  return member;
}

async function createInspector(owner, payload) {
  if (!owner.companyId) {
    throw new HttpError(400, 'Create a company first');
  }

  const existing = await User.findOne({ email: payload.email });
  if (existing) {
    throw new HttpError(409, 'Email already registered');
  }

  const inspector = await User.create({
    email: payload.email,
    passwordHash: await hashPassword(payload.password),
    role: USER_ROLES.INSPECTOR,
    status: USER_STATUSES.ACTIVE,
    companyId: owner.companyId,
    profile: {
      firstName: payload.firstName || '',
      lastName: payload.lastName || '',
      phone: payload.phone || '',
      licenseNumber: payload.licenseNumber || '',
      certifications: parseCertifications(payload.certifications),
    },
    createdBy: owner._id,
  });

  const company = await Tenant.findById(owner.companyId);
  const mail = await sendInspectorCredentials({
    to: inspector.email,
    name: memberName(inspector),
    password: payload.password,
    companyName: company?.name || '',
    company,
  });

  return {
    inspector: toStaffMember(inspector),
    emailSent: mail.sent,
  };
}

async function listInspectors(owner) {
  if (!owner.companyId) {
    throw new HttpError(400, 'Create a company first');
  }

  const inspectors = await User.find({
    companyId: owner.companyId,
    role: USER_ROLES.INSPECTOR,
  }).sort({ createdAt: -1 });

  const metrics = await inspectorMetricsMap(
    owner.companyId,
    inspectors.map((item) => item._id)
  );

  return inspectors.map((item) => toStaffMember(item, metrics.get(String(item._id))));
}

async function getInspector(owner, inspectorId) {
  const inspector = await findCompanyMember(owner, inspectorId, USER_ROLES.INSPECTOR);
  const metrics = await inspectorMetricsMap(owner.companyId, [inspector._id]);
  return toStaffMember(inspector, metrics.get(String(inspector._id)));
}

async function updateInspector(owner, inspectorId, payload = {}) {
  const inspector = await findCompanyMember(owner, inspectorId, USER_ROLES.INSPECTOR);

  if (payload.firstName !== undefined) inspector.profile.firstName = payload.firstName;
  if (payload.lastName !== undefined) inspector.profile.lastName = payload.lastName;
  if (payload.phone !== undefined) inspector.profile.phone = payload.phone;
  if (payload.licenseNumber !== undefined) inspector.profile.licenseNumber = payload.licenseNumber;
  if (payload.certifications !== undefined) {
    inspector.profile.certifications = parseCertifications(payload.certifications);
  }
  if (payload.password) {
    inspector.passwordHash = await hashPassword(payload.password);
    inspector.passwordChangedAt = new Date();
  }

  inspector.updatedBy = owner._id;
  await inspector.save();

  const metrics = await inspectorMetricsMap(owner.companyId, [inspector._id]);
  return toStaffMember(inspector, metrics.get(String(inspector._id)));
}

async function setInspectorStatus(owner, inspectorId, status) {
  const inspector = await findCompanyMember(owner, inspectorId, USER_ROLES.INSPECTOR);
  const allowed = new Set([
    USER_STATUSES.ACTIVE,
    USER_STATUSES.SUSPENDED,
    USER_STATUSES.DEACTIVATED,
  ]);
  if (!allowed.has(status)) {
    throw new HttpError(400, 'Status must be active, suspended, or deactivated');
  }
  inspector.status = status;
  inspector.updatedBy = owner._id;
  await inspector.save();

  const metrics = await inspectorMetricsMap(owner.companyId, [inspector._id]);
  return toStaffMember(inspector, metrics.get(String(inspector._id)));
}

async function deleteInspector(owner, inspectorId) {
  return setInspectorStatus(owner, inspectorId, USER_STATUSES.DEACTIVATED);
}

async function resetInspectorPassword(owner, inspectorId, payload = {}) {
  const inspector = await findCompanyMember(owner, inspectorId, USER_ROLES.INSPECTOR);
  const password = payload.password && String(payload.password).trim().length >= 6
    ? String(payload.password).trim()
    : crypto.randomBytes(4).toString('hex') + 'A1';

  inspector.passwordHash = await hashPassword(password);
  inspector.passwordChangedAt = new Date();
  inspector.updatedBy = owner._id;
  await inspector.save();

  const company = await Tenant.findById(owner.companyId);
  const mail = await sendInspectorCredentials({
    to: inspector.email,
    name: memberName(inspector),
    password,
    companyName: company?.name || '',
    company,
  });

  const metrics = await inspectorMetricsMap(owner.companyId, [inspector._id]);
  return {
    inspector: toStaffMember(inspector, metrics.get(String(inspector._id))),
    temporaryPassword: mail.sent ? undefined : password,
    emailSent: mail.sent,
  };
}

async function reassignInspectorJobs(owner, fromInspectorId, payload = {}) {
  const fromInspector = await findCompanyMember(owner, fromInspectorId, USER_ROLES.INSPECTOR);
  const toInspector = await findCompanyMember(owner, payload.toInspectorId, USER_ROLES.INSPECTOR);
  if (String(fromInspector._id) === String(toInspector._id)) {
    throw new HttpError(400, 'Choose a different inspector');
  }
  if (toInspector.status !== USER_STATUSES.ACTIVE) {
    throw new HttpError(400, 'Target inspector is not active');
  }

  const filter = {
    companyId: owner.companyId,
    assignedTo: fromInspector._id,
    status: { $in: OPEN_JOB_STATUSES },
  };
  if (Array.isArray(payload.jobIds) && payload.jobIds.length) {
    filter._id = {
      $in: payload.jobIds.filter((id) => mongoose.isValidObjectId(id)),
    };
  }

  const jobs = await Job.find(filter).select('_id');
  const reassigned = [];
  for (const job of jobs) {
    reassigned.push(await jobService.assignJob(owner, job._id, toInspector._id));
  }

  const metrics = await inspectorMetricsMap(owner.companyId, [fromInspector._id, toInspector._id]);
  return {
    count: reassigned.length,
    jobs: reassigned,
    fromInspector: toStaffMember(fromInspector, metrics.get(String(fromInspector._id))),
    toInspector: toStaffMember(toInspector, metrics.get(String(toInspector._id))),
  };
}

async function getInspectorHistory(owner, inspectorId) {
  const inspector = await findCompanyMember(owner, inspectorId, USER_ROLES.INSPECTOR);

  const jobs = await Job.find({
    companyId: owner.companyId,
    assignedTo: inspector._id,
  })
    .sort({ createdAt: -1 })
    .populate('customerId', 'name')
    .limit(200);

  const metrics = await inspectorMetricsMap(owner.companyId, [inspector._id]);
  return {
    inspector: toStaffMember(inspector, metrics.get(String(inspector._id))),
    history: jobs.map((job) => ({
      id: String(job._id),
      jobNumber: job.jobNumber,
      title: job.title || '',
      status: normalizeStatus(job.status),
      customerName: job.customerId?.name || '',
      addressLine: job.address?.formatted || job.address?.line1 || '',
      claimNumber: job.claim?.claimNumber || '',
      completedAt: job.completedAt,
      createdAt: job.createdAt,
    })),
  };
}

async function createStaff(owner, payload) {
  if (!owner.companyId) {
    throw new HttpError(400, 'Create a company first');
  }

  const existing = await User.findOne({ email: payload.email });
  if (existing) {
    throw new HttpError(409, 'Email already registered');
  }

  const permissions = Array.isArray(payload.permissions) && payload.permissions.length
    ? payload.permissions.filter((item) => ALL_PERMISSIONS.includes(item))
    : [...STAFF_DEFAULT_PERMISSIONS];

  const staff = await User.create({
    email: payload.email,
    passwordHash: await hashPassword(payload.password),
    role: USER_ROLES.OFFICE_STAFF,
    status: USER_STATUSES.ACTIVE,
    companyId: owner.companyId,
    permissions,
    profile: {
      firstName: payload.firstName || '',
      lastName: payload.lastName || '',
      phone: payload.phone || '',
    },
    createdBy: owner._id,
  });

  return { staff: toStaffMember(staff) };
}

async function listStaff(owner) {
  if (!owner.companyId) {
    throw new HttpError(400, 'Create a company first');
  }

  const staff = await User.find({
    companyId: owner.companyId,
    role: USER_ROLES.OFFICE_STAFF,
  }).sort({ createdAt: -1 });

  return staff.map((item) => toStaffMember(item));
}

async function updateStaff(owner, staffId, payload = {}) {
  const staff = await findCompanyMember(owner, staffId, USER_ROLES.OFFICE_STAFF);

  if (payload.firstName !== undefined) staff.profile.firstName = payload.firstName;
  if (payload.lastName !== undefined) staff.profile.lastName = payload.lastName;
  if (payload.phone !== undefined) staff.profile.phone = payload.phone;
  if (payload.password) {
    staff.passwordHash = await hashPassword(payload.password);
    staff.passwordChangedAt = new Date();
  }
  if (payload.permissions !== undefined) {
    if (!Array.isArray(payload.permissions)) {
      throw new HttpError(400, 'permissions must be an array');
    }
    staff.permissions = payload.permissions.filter((item) => ALL_PERMISSIONS.includes(item));
  }

  staff.updatedBy = owner._id;
  await staff.save();
  return toStaffMember(staff);
}

async function setStaffStatus(owner, staffId, status) {
  const staff = await findCompanyMember(owner, staffId, USER_ROLES.OFFICE_STAFF);
  staff.status = status === USER_STATUSES.SUSPENDED
    ? USER_STATUSES.SUSPENDED
    : status === USER_STATUSES.DEACTIVATED
      ? USER_STATUSES.DEACTIVATED
      : USER_STATUSES.ACTIVE;
  staff.updatedBy = owner._id;
  await staff.save();
  return toStaffMember(staff);
}

async function deleteStaff(owner, staffId) {
  return setStaffStatus(owner, staffId, USER_STATUSES.DEACTIVATED);
}

async function listCompanyUsers(owner) {
  if (!owner.companyId) {
    throw new HttpError(400, 'Create a company first');
  }

  const users = await User.find({
    companyId: owner.companyId,
    role: { $in: [USER_ROLES.COMPANY_ADMIN, USER_ROLES.OFFICE_STAFF, USER_ROLES.INSPECTOR] },
  }).sort({ role: 1, createdAt: -1 });

  return users.map((item) => toStaffMember(item));
}

module.exports = {
  createInspector,
  listInspectors,
  getInspector,
  updateInspector,
  setInspectorStatus,
  deleteInspector,
  resetInspectorPassword,
  reassignInspectorJobs,
  getInspectorHistory,
  createStaff,
  listStaff,
  updateStaff,
  setStaffStatus,
  deleteStaff,
  listCompanyUsers,
};
