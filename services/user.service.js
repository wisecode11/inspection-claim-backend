'use strict';

const mongoose = require('mongoose');
const { User, Tenant, Job } = require('../models');
const { USER_ROLES, USER_STATUSES } = require('../models/enums');
const HttpError = require('../utils/httpError');
const { hashPassword } = require('../utils/password');
const { toUserResponse } = require('../utils/userResponse');
const { sendInspectorCredentials } = require('./email.service');

function inspectorName(user) {
  const name = `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim();
  return name || user.email;
}

function toInspectorStaff(user, jobsTotal = 0) {
  return {
    ...toUserResponse(user),
    name: inspectorName(user),
    jobsTotal,
    jobsCompleted: jobsTotal,
  };
}

async function jobsTotalByInspector(companyId, inspectorIds) {
  if (!inspectorIds.length) {
    return new Map();
  }

  const rows = await Job.aggregate([
    {
      $match: {
        companyId,
        assignedTo: { $in: inspectorIds },
      },
    },
    { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
  ]);

  return new Map(rows.map((row) => [String(row._id), row.count]));
}

async function findCompanyInspector(owner, inspectorId) {
  if (!owner.companyId) {
    throw new HttpError(400, 'Create a company first');
  }
  if (!mongoose.isValidObjectId(inspectorId)) {
    throw new HttpError(400, 'Invalid inspector id');
  }

  const inspector = await User.findOne({
    _id: inspectorId,
    companyId: owner.companyId,
    role: USER_ROLES.INSPECTOR,
  });
  if (!inspector) {
    throw new HttpError(404, 'Inspector not found');
  }
  return inspector;
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
    },
    createdBy: owner._id,
  });

  const company = await Tenant.findById(owner.companyId).select('name').lean();
  const mail = await sendInspectorCredentials({
    to: inspector.email,
    name: inspectorName(inspector),
    password: payload.password,
    companyName: company?.name || '',
  });

  return {
    inspector: toInspectorStaff(inspector, 0),
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

  const counts = await jobsTotalByInspector(
    owner.companyId,
    inspectors.map((item) => item._id)
  );

  return inspectors.map((item) => toInspectorStaff(item, counts.get(String(item._id)) || 0));
}

async function setInspectorStatus(owner, inspectorId, status) {
  const inspector = await findCompanyInspector(owner, inspectorId);
  inspector.status = status === USER_STATUSES.SUSPENDED
    ? USER_STATUSES.SUSPENDED
    : USER_STATUSES.ACTIVE;
  await inspector.save();

  const counts = await jobsTotalByInspector(owner.companyId, [inspector._id]);
  return toInspectorStaff(inspector, counts.get(String(inspector._id)) || 0);
}

async function deleteInspector(owner, inspectorId) {
  const inspector = await findCompanyInspector(owner, inspectorId);
  await inspector.softDelete(owner._id);
  return { id: String(inspector._id) };
}

module.exports = {
  createInspector,
  listInspectors,
  setInspectorStatus,
  deleteInspector,
};
