'use strict';

const mongoose = require('mongoose');
const { Customer, Property, Job, User } = require('../models');
const { USER_ROLES, USER_STATUSES, JOB_STATUSES } = require('../models/enums');
const HttpError = require('../utils/httpError');
const geocodeService = require('./geocode.service');
const weatherService = require('./weather.service');

function normalizeAddress(address = {}) {
  const normalized = {
    line1: address.line1 || address.street || '',
    line2: address.line2 || '',
    city: address.city || '',
    state: address.state || '',
    postalCode: address.postalCode || address.zip || '',
    country: String(address.country || '').trim().toUpperCase(),
    formatted: address.formatted || '',
  };
  if (!normalized.country) {
    const blob = `${normalized.line1} ${normalized.city} ${normalized.state}`;
    if (/\b(lahore|karachi|islamabad|punjab|sindh|johar)\b/i.test(blob)) {
      normalized.country = 'PK';
    }
  }
  if (!normalized.country) {
    normalized.country = 'US';
  }
  return normalized;
}

function toGeocodeResponse(geocode = {}) {
  return {
    status: geocode.status || 'pending',
    provider: geocode.provider || '',
    latitude: geocode.latitude ?? null,
    longitude: geocode.longitude ?? null,
    formattedAddress: geocode.formattedAddress || '',
    confirmed: Boolean(geocode.confirmed),
    confirmedAt: geocode.confirmedAt || null,
    error: geocode.error || '',
  };
}

function inspectorLabel(assignedTo) {
  if (!assignedTo) return 'Unassigned';
  if (typeof assignedTo === 'object') {
    const name = `${assignedTo.profile?.firstName || ''} ${assignedTo.profile?.lastName || ''}`.trim();
    return name || assignedTo.email || 'Inspector';
  }
  return 'Assigned';
}

function toJobResponse(job) {
  const doc = typeof job.toObject === 'function' ? job.toObject({ virtuals: true }) : job;
  const geocode = toGeocodeResponse(doc.geocode);
  const assigned = doc.assignedTo && typeof doc.assignedTo === 'object' ? doc.assignedTo : null;
  const address = doc.address || {};
  const customer = doc.customerId && typeof doc.customerId === 'object' ? doc.customerId : null;
  return {
    id: String(doc._id),
    jobNumber: doc.jobNumber,
    status: doc.status,
    type: doc.type,
    assignedTo: assigned ? String(assigned._id) : (doc.assignedTo ? String(doc.assignedTo) : null),
    inspector: inspectorLabel(doc.assignedTo),
    customer: customer
      ? { id: String(customer._id), name: customer.name || '', email: customer.email || '', phone: customer.phone || '' }
      : doc.customerId || null,
    customerName: customer?.name || '',
    address,
    addressLine: address.formatted || address.line1 || '',
    city: [address.city, address.state].filter(Boolean).join(', '),
    notes: doc.notes,
    scheduledAt: doc.scheduledAt || null,
    createdAt: doc.createdAt,
    dateOfLoss: doc.claim?.dateOfLoss || null,
    claim: {
      dateOfLoss: doc.claim?.dateOfLoss || null,
      claimNumber: doc.claim?.claimNumber || '',
      status: doc.claim?.status || '',
    },
    geocode,
    latitude: geocode.latitude,
    longitude: geocode.longitude,
  };
}

async function nextJobNumber(companyId) {
  const latest = await Job.findOne({ companyId })
    .setOptions({ withDeleted: true })
    .sort({ jobNumber: -1 })
    .select('jobNumber')
    .lean();

  const current = latest && latest.jobNumber
    ? parseInt(String(latest.jobNumber).replace(/\D/g, ''), 10)
    : 0;
  const next = Number.isFinite(current) ? current + 1 : 1;
  return `JOB-${String(next).padStart(4, '0')}`;
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
  if (!payload.dateOfLoss) {
    throw new HttpError(400, 'Date of loss is required');
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

  const property = new Property({
    companyId,
    customerId: customer._id,
    address,
    createdBy: owner._id,
  });

  const job = new Job({
    companyId,
    jobNumber: await nextJobNumber(companyId),
    status: JOB_STATUSES.SCHEDULED,
    customerId: customer._id,
    propertyId: property._id,
    address,
    notes: payload.notes || '',
    claim: {
      dateOfLoss: payload.dateOfLoss,
    },
    createdBy: owner._id,
  });

  const geocodeResult = await geocodeService.geocodeAddress(address);
  geocodeService.applyGeocodeResult(job, geocodeResult);
  geocodeService.applyGeocodeResult(property, geocodeResult);

  await property.save();

  let created;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    job.jobNumber = attempt === 0 ? job.jobNumber : await nextJobNumber(companyId);
    try {
      await job.save();
      created = await job.populate(['customerId', 'propertyId', 'assignedTo']);
      break;
    } catch (error) {
      if (error.code !== 11000 || !error.keyPattern || !error.keyPattern.jobNumber) {
        throw error;
      }
    }
  }
  if (!created) {
    throw new HttpError(409, 'Could not assign a unique job number. Try again.');
  }

  let response;
  if (payload.inspectorId) {
    response = await assignJob(owner, created._id, payload.inspectorId);
  } else {
    response = toJobResponse(created);
  }

  try {
    response.weather = await weatherService.verifyForJob(owner, created._id);
  } catch {
    response.weather = null;
  }

  return response;
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
  if (inspector.status !== USER_STATUSES.ACTIVE) {
    throw new HttpError(400, 'Inspector is not active');
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
    .populate('assignedTo', 'email role profile')
    .populate('propertyId');

  for (const job of jobs) {
    await geocodeService.geocodeAndSave([job, job.propertyId], job.address);
  }

  return jobs.map(toJobResponse);
}

async function confirmJobLocation(user, jobId, payload = {}) {
  if (!mongoose.isValidObjectId(jobId)) {
    throw new HttpError(400, 'Valid job id is required');
  }

  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  if (!geocodeService.isValidCoord(latitude, longitude)) {
    throw new HttpError(400, 'Valid latitude and longitude are required');
  }

  const filter = { _id: jobId, companyId: user.companyId };
  if (user.role === USER_ROLES.INSPECTOR) {
    filter.assignedTo = user._id;
  }

  const job = await Job.findOne(filter);
  if (!job) {
    throw new HttpError(404, 'Job not found');
  }

  job.confirmLocation({ latitude, longitude });
  job.updatedBy = user._id;
  await job.save();

  if (job.propertyId) {
    const property = await Property.findOne({ _id: job.propertyId, companyId: user.companyId });
    if (property) {
      property.confirmLocation({ latitude, longitude });
      property.updatedBy = user._id;
      await property.save();
    }
  }

  const updated = await job.populate(['customerId', 'propertyId', 'assignedTo']);
  return toJobResponse(updated);
}

module.exports = { createJob, assignJob, listJobs, confirmJobLocation };
