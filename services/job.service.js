'use strict';

const mongoose = require('mongoose');
const { Customer, Property, Job, User } = require('../models');
const { USER_ROLES, JOB_STATUSES } = require('../models/enums');
const HttpError = require('../utils/httpError');

function normalizeAddress(address = {}) {
  return {
    line1: address.line1 || address.street || '',
    line2: address.line2 || '',
    city: address.city || '',
    state: address.state || '',
    postalCode: address.postalCode || address.zip || '',
    country: address.country || 'US',
    formatted: address.formatted || '',
  };
}

function toJobResponse(job) {
  const doc = typeof job.toObject === 'function' ? job.toObject() : job;
  return {
    id: doc._id,
    jobNumber: doc.jobNumber,
    status: doc.status,
    type: doc.type,
    assignedTo: doc.assignedTo || null,
    customer: doc.customerId || null,
    address: doc.address,
    notes: doc.notes,
    createdAt: doc.createdAt,
  };
}

async function nextJobNumber(companyId) {
  const count = await Job.countDocuments({ companyId });
  return `JOB-${String(count + 1).padStart(4, '0')}`;
}

async function createJob(owner, payload) {
  if (!owner.companyId) {
    throw new HttpError(400, 'Create a company first');
  }
  if (!payload || !payload.customer || !payload.customer.name) {
    throw new HttpError(400, 'Customer name is required');
  }
  if (!payload.address || !(payload.address.line1 || payload.address.street)) {
    throw new HttpError(400, 'Job address is required');
  }

  const address = normalizeAddress(payload.address);
  const companyId = owner.companyId;

  const customer = await Customer.create({
    companyId,
    name: payload.customer.name,
    email: payload.customer.email || '',
    phone: payload.customer.phone || '',
    mailingAddress: address,
    createdBy: owner._id,
  });

  const property = await Property.create({
    companyId,
    customerId: customer._id,
    address,
    createdBy: owner._id,
  });

  const job = await Job.create({
    companyId,
    jobNumber: await nextJobNumber(companyId),
    status: JOB_STATUSES.SCHEDULED,
    customerId: customer._id,
    propertyId: property._id,
    address,
    notes: payload.notes || '',
    createdBy: owner._id,
  });

  const created = await job.populate(['customerId', 'propertyId', 'assignedTo']);
  return toJobResponse(created);
}

async function assignJob(owner, jobId, inspectorId) {
  if (!mongoose.isValidObjectId(jobId) || !mongoose.isValidObjectId(inspectorId)) {
    throw new HttpError(400, 'Valid jobId and inspectorId are required');
  }

  if (String(jobId) === String(inspectorId)) {
    throw new HttpError(
      400,
      'inspectorId cannot be the same as job id. Copy inspector id from Inspector create (data.inspector.id)'
    );
  }

  const inspector = await User.findOne({
    _id: inspectorId,
    companyId: owner.companyId,
    role: USER_ROLES.INSPECTOR,
  });
  if (!inspector) {
    throw new HttpError(
      404,
      'Inspector not found in this company. Use data.inspector.id from Inspector create, not customer id'
    );
  }

  const job = await Job.findOne({ _id: jobId, companyId: owner.companyId });
  if (!job) {
    throw new HttpError(404, 'Job not found. Use data.job.id from Job create, not customer._id');
  }

  job.assignedTo = inspector._id;
  job.updatedBy = owner._id;
  await job.save();

  const updated = await job.populate(['customerId', 'propertyId', 'assignedTo']);
  return toJobResponse(updated);
}

async function listJobs(user) {
  const jobs = await Job.forUser(user)
    .sort({ createdAt: -1 })
    .populate('customerId', 'name email phone')
    .populate('assignedTo', 'email role profile');
  return jobs.map(toJobResponse);
}

module.exports = { createJob, assignJob, listJobs };
