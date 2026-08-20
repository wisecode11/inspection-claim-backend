'use strict';

const mongoose = require('mongoose');
const { Customer, Property, Job, User, Inspection, Report, Photo } = require('../models');
const { USER_ROLES, USER_STATUSES, JOB_STATUSES, JOB_PRIORITIES, CLAIM_STATUSES } = require('../models/enums');
const HttpError = require('../utils/httpError');
const {
  normalizeStatus,
  assertTransition,
  applyStatusTimestamps,
  statusAfterAssign,
  canCancel,
} = require('../utils/jobStatus');
const geocodeService = require('./geocode.service');

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

function parseDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'Invalid date value');
  }
  return date;
}

function buildClaim(claim = {}) {
  return {
    insuranceCompany: claim.insuranceCompany || '',
    policyNumber: claim.policyNumber || '',
    claimNumber: claim.claimNumber || '',
    dateOfLoss: parseDate(claim.dateOfLoss),
    status: claim.status && Object.values(CLAIM_STATUSES).includes(claim.status)
      ? claim.status
      : CLAIM_STATUSES.NOT_FILED,
  };
}

function buildPropertyInfo(info = {}) {
  return {
    yearBuilt: info.yearBuilt != null && info.yearBuilt !== '' ? Number(info.yearBuilt) : null,
    stories: info.stories != null && info.stories !== '' ? Number(info.stories) : null,
    roofType: info.roofType || '',
    squareFootage: info.squareFootage != null && info.squareFootage !== ''
      ? Number(info.squareFootage)
      : null,
    notes: info.notes || '',
  };
}

function toJobResponse(job, extras = {}) {
  const doc = typeof job.toObject === 'function' ? job.toObject({ virtuals: true }) : job;
  const geocode = toGeocodeResponse(doc.geocode);
  const assigned = doc.assignedTo && typeof doc.assignedTo === 'object' ? doc.assignedTo : null;
  const address = doc.address || {};
  const customer = doc.customerId && typeof doc.customerId === 'object' ? doc.customerId : null;
  const status = normalizeStatus(doc.status);

  return {
    id: String(doc._id),
    jobNumber: doc.jobNumber,
    title: doc.title || doc.jobNumber || '',
    priority: doc.priority || JOB_PRIORITIES.NORMAL,
    status,
    type: doc.type,
    assignedTo: assigned ? String(assigned._id) : (doc.assignedTo ? String(doc.assignedTo) : null),
    inspector: inspectorLabel(doc.assignedTo),
    customer: customer
      ? {
        id: String(customer._id),
        name: customer.name || '',
        email: customer.email || '',
        phone: customer.phone || '',
      }
      : doc.customerId || null,
    customerName: customer?.name || '',
    address,
    addressLine: address.formatted || address.line1 || '',
    city: [address.city, address.state].filter(Boolean).join(', '),
    claim: {
      insuranceCompany: doc.claim?.insuranceCompany || '',
      policyNumber: doc.claim?.policyNumber || '',
      claimNumber: doc.claim?.claimNumber || '',
      dateOfLoss: doc.claim?.dateOfLoss || null,
      status: doc.claim?.status || CLAIM_STATUSES.NOT_FILED,
    },
    propertyInfo: {
      yearBuilt: doc.propertyInfo?.yearBuilt ?? null,
      stories: doc.propertyInfo?.stories ?? null,
      roofType: doc.propertyInfo?.roofType || '',
      squareFootage: doc.propertyInfo?.squareFootage ?? null,
      notes: doc.propertyInfo?.notes || '',
    },
    notes: doc.notes || '',
    attachments: Array.isArray(doc.attachments)
      ? doc.attachments.map((item) => ({
        name: item.name || '',
        url: item.url || '',
        mimeType: item.mimeType || '',
        size: item.size || 0,
        uploadedAt: item.uploadedAt || null,
      }))
      : [],
    dueDate: doc.dueDate || null,
    scheduledAt: doc.scheduledAt || null,
    acceptedAt: doc.acceptedAt || null,
    startedAt: doc.startedAt || null,
    submittedAt: doc.submittedAt || doc.reviewRequiredAt || null,
    reviewedAt: doc.reviewedAt || null,
    reviewRequiredAt: doc.reviewRequiredAt || null,
    completedAt: doc.completedAt || null,
    reportGeneratedAt: doc.reportGeneratedAt || null,
    archivedAt: doc.archivedAt || null,
    cancelledAt: doc.cancelledAt || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    geocode,
    latitude: geocode.latitude,
    longitude: geocode.longitude,
    ...extras,
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

async function findCompanyJob(user, jobId, { forInspector = false } = {}) {
  if (!mongoose.isValidObjectId(jobId)) {
    throw new HttpError(400, 'Valid job id is required');
  }

  const filter = { _id: jobId, companyId: user.companyId };
  if (forInspector || user.role === USER_ROLES.INSPECTOR) {
    filter.assignedTo = user._id;
  }

  const job = await Job.findOne(filter);
  if (!job) {
    throw new HttpError(404, 'Job not found');
  }
  return job;
}

async function loadActiveInspector(companyId, inspectorId) {
  if (!mongoose.isValidObjectId(inspectorId)) {
    throw new HttpError(400, 'Valid inspectorId is required');
  }

  const inspector = await User.findOne({
    _id: inspectorId,
    companyId,
    role: USER_ROLES.INSPECTOR,
  });
  if (!inspector) {
    throw new HttpError(404, 'Inspector not found in this company');
  }
  if (inspector.status !== USER_STATUSES.ACTIVE) {
    throw new HttpError(400, 'Inspector is not active');
  }
  return inspector;
}

async function populateJob(job) {
  return job.populate([
    { path: 'customerId', select: 'name email phone' },
    { path: 'propertyId' },
    { path: 'assignedTo', select: 'email role profile' },
  ]);
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
  const claim = buildClaim(payload.claim || {});
  const propertyInfo = buildPropertyInfo(payload.propertyInfo || {});

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
    yearBuilt: propertyInfo.yearBuilt,
    stories: propertyInfo.stories || 1,
    sqft: propertyInfo.squareFootage,
    notes: propertyInfo.notes || '',
    createdBy: owner._id,
  });

  const hasInspector = Boolean(payload.inspectorId);
  const job = new Job({
    companyId,
    jobNumber: await nextJobNumber(companyId),
    title: payload.title || '',
    priority: payload.priority || JOB_PRIORITIES.NORMAL,
    status: hasInspector ? JOB_STATUSES.ASSIGNED : JOB_STATUSES.DRAFT,
    customerId: customer._id,
    propertyId: property._id,
    address,
    claim,
    propertyInfo,
    notes: payload.notes || '',
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    dueDate: parseDate(payload.dueDate),
    scheduledAt: hasInspector ? new Date() : null,
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
      created = await populateJob(job);
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

  if (payload.inspectorId) {
    return assignJob(owner, created._id, payload.inspectorId);
  }

  return toJobResponse(created);
}

async function updateJob(actor, jobId, payload = {}) {
  const job = await findCompanyJob(actor, jobId);
  const status = normalizeStatus(job.status);

  if (status === JOB_STATUSES.CANCELLED || status === JOB_STATUSES.REJECTED || status === JOB_STATUSES.ARCHIVED) {
    throw new HttpError(400, `Cannot edit a ${status} job`);
  }

  if (payload.customer) {
    const customer = await Customer.findOne({ _id: job.customerId, companyId: actor.companyId });
    if (customer) {
      if (payload.customer.name) customer.name = payload.customer.name;
      if (payload.customer.email !== undefined) customer.email = payload.customer.email || '';
      if (payload.customer.phone !== undefined) customer.phone = payload.customer.phone || '';
      customer.updatedBy = actor._id;
      await customer.save();
    }
  }

  if (payload.address) {
    const address = normalizeAddress({ ...job.address?.toObject?.() || job.address, ...payload.address });
    job.address = address;
    const geocodeResult = await geocodeService.geocodeAddress(address);
    geocodeService.applyGeocodeResult(job, geocodeResult);

    const property = await Property.findOne({ _id: job.propertyId, companyId: actor.companyId });
    if (property) {
      property.address = address;
      geocodeService.applyGeocodeResult(property, geocodeResult);
      property.updatedBy = actor._id;
      await property.save();
    }
  }

  if (payload.claim) {
    job.claim = {
      ...buildClaim({ ...job.claim?.toObject?.() || job.claim, ...payload.claim }),
    };
  }

  if (payload.propertyInfo) {
    job.propertyInfo = buildPropertyInfo({
      ...(job.propertyInfo?.toObject?.() || job.propertyInfo || {}),
      ...payload.propertyInfo,
    });
  }

  if (payload.notes !== undefined) {
    job.notes = payload.notes || '';
  }
  if (payload.title !== undefined) {
    job.title = payload.title || '';
  }
  if (payload.priority !== undefined) {
    job.priority = payload.priority || JOB_PRIORITIES.NORMAL;
  }
  if (payload.dueDate !== undefined) {
    job.dueDate = parseDate(payload.dueDate);
  }
  if (payload.attachments !== undefined) {
    job.attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  }

  job.updatedBy = actor._id;
  await job.save();

  if (payload.inspectorId) {
    return assignJob(actor, job._id, payload.inspectorId);
  }
  if (payload.inspectorId === null || payload.unassign === true) {
    return unassignJob(actor, job._id);
  }

  const updated = await populateJob(job);
  return toJobResponse(updated);
}

async function assignJob(actor, jobId, inspectorId, options = {}) {
  if (!mongoose.isValidObjectId(jobId)) {
    throw new HttpError(400, 'Valid jobId is required');
  }

  const inspector = await loadActiveInspector(actor.companyId, inspectorId);
  const job = await findCompanyJob(actor, jobId);
  const status = normalizeStatus(job.status);

  if (status === JOB_STATUSES.REJECTED || status === JOB_STATUSES.CANCELLED || status === JOB_STATUSES.ARCHIVED) {
    throw new HttpError(400, `Cannot assign a ${status} job`);
  }

  job.assignedTo = inspector._id;
  job.scheduledAt = job.scheduledAt || new Date();
  if (options.dueDate !== undefined) {
    job.dueDate = parseDate(options.dueDate);
  }
  if (options.priority !== undefined) {
    job.priority = options.priority || JOB_PRIORITIES.NORMAL;
  }
  job.updatedBy = actor._id;

  const next = statusAfterAssign(status);
  if (next !== status) {
    applyStatusTimestamps(job, next);
  } else {
    job.status = status;
  }

  await job.save();
  const updated = await populateJob(job);
  return toJobResponse(updated);
}

async function bulkAssignJobs(actor, payload = {}) {
  const results = [];
  for (const jobId of payload.jobIds || []) {
    const job = await assignJob(actor, jobId, payload.inspectorId, {
      dueDate: payload.dueDate,
      priority: payload.priority,
    });
    results.push(job);
  }
  return results;
}

async function unassignJob(actor, jobId) {
  const job = await findCompanyJob(actor, jobId);
  const status = normalizeStatus(job.status);

  if (![JOB_STATUSES.DRAFT, JOB_STATUSES.ASSIGNED, JOB_STATUSES.ON_HOLD].includes(status)) {
    throw new HttpError(400, 'Only unassigned, assigned, or on-hold jobs can be unassigned');
  }

  job.assignedTo = null;
  applyStatusTimestamps(job, JOB_STATUSES.DRAFT);
  job.updatedBy = actor._id;
  await job.save();

  const updated = await populateJob(job);
  return toJobResponse(updated);
}

async function updateJobStatus(actor, jobId, nextStatus) {
  const job = await findCompanyJob(actor, jobId);
  const resolved = assertTransition(job.status, nextStatus);
  applyStatusTimestamps(job, resolved);
  job.updatedBy = actor._id;
  await job.save();

  const updated = await populateJob(job);
  return toJobResponse(updated);
}

async function cancelJob(actor, jobId, reason = '') {
  const job = await findCompanyJob(actor, jobId);
  if (!canCancel(job.status)) {
    throw new HttpError(400, `Cannot reject a job in status "${normalizeStatus(job.status)}"`);
  }

  applyStatusTimestamps(job, JOB_STATUSES.REJECTED);
  if (reason) {
    job.notes = [job.notes, `Rejected: ${reason}`].filter(Boolean).join('\n');
  }
  job.updatedBy = actor._id;
  await job.save();

  const updated = await populateJob(job);
  return toJobResponse(updated);
}

async function acceptJob(inspector, jobId) {
  const job = await findCompanyJob(inspector, jobId, { forInspector: true });
  return updateJobStatus(inspector, job._id, JOB_STATUSES.IN_PROGRESS);
}

async function listJobs(user, query = {}) {
  const filter = { companyId: user.companyId };
  if (user.role === USER_ROLES.INSPECTOR) {
    filter.assignedTo = user._id;
  }
  if (query.status) {
    filter.status = query.status;
  }
  if (query.inspectorId && mongoose.isValidObjectId(query.inspectorId)) {
    filter.assignedTo = query.inspectorId;
  }

  const jobs = await Job.find(filter)
    .sort({ createdAt: -1 })
    .populate('customerId', 'name email phone')
    .populate('assignedTo', 'email role profile')
    .populate('propertyId');

  for (const job of jobs) {
    await geocodeService.geocodeAndSave([job, job.propertyId], job.address);
  }

  return jobs.map((job) => toJobResponse(job));
}

async function getJob(user, jobId) {
  const job = await findCompanyJob(user, jobId);
  const populated = await populateJob(job);

  const [inspection, photos, reports] = await Promise.all([
    Inspection.findOne({ jobId: job._id, companyId: user.companyId }).sort({ createdAt: -1 }),
    Photo.find({ jobId: job._id, companyId: user.companyId }).sort({ createdAt: -1 }).limit(100),
    Report.find({ jobId: job._id, companyId: user.companyId }).sort({ version: -1 }),
  ]);

  return toJobResponse(populated, {
    inspection: inspection
      ? {
        id: String(inspection._id),
        status: inspection.status,
        summary: inspection.summary || {},
        startedAt: inspection.startedAt,
        completedAt: inspection.completedAt,
        submittedAt: inspection.submittedAt,
      }
      : null,
    photos: photos.map((photo) => ({
      id: String(photo._id),
      subjectType: photo.subjectType,
      status: photo.status,
      caption: photo.caption || '',
      url: photo.storage?.url || '',
      createdAt: photo.createdAt,
    })),
    reports: reports.map((report) => ({
      id: String(report._id),
      status: ['ready', 'queued', 'generating', 'failed'].includes(report.status)
        ? 'draft'
        : report.status,
      pdfStatus: report.pdfStatus || (report.pdf?.url ? 'ready' : report.status),
      version: report.version,
      title: report.title,
      narrative: report.narrative || '',
      warnings: report.warnings || [],
      generatedAt: report.generatedAt,
      pdfUrl: report.pdf?.url || '',
      submittedAt: report.submittedAt || null,
      reviewedAt: report.reviewedAt || null,
      reviewNotes: report.reviewNotes || '',
      rejectionReason: report.rejectionReason || '',
      changesRequested: report.changesRequested || '',
    })),
    progress: {
      notStarted: [JOB_STATUSES.ASSIGNED, JOB_STATUSES.DRAFT, JOB_STATUSES.REOPENED].includes(normalizeStatus(job.status)),
      inProgress: normalizeStatus(job.status) === JOB_STATUSES.IN_PROGRESS,
      review: [JOB_STATUSES.SUBMITTED, JOB_STATUSES.REVIEWED].includes(normalizeStatus(job.status)),
      completed: normalizeStatus(job.status) === JOB_STATUSES.COMPLETED,
      reportGenerated: false,
    },
  });
}

async function confirmJobLocation(user, jobId, payload = {}) {
  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  if (!geocodeService.isValidCoord(latitude, longitude)) {
    throw new HttpError(400, 'Valid latitude and longitude are required');
  }

  const job = await findCompanyJob(user, jobId);
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

  const updated = await populateJob(job);
  return toJobResponse(updated);
}

module.exports = {
  createJob,
  updateJob,
  assignJob,
  bulkAssignJobs,
  unassignJob,
  updateJobStatus,
  cancelJob,
  acceptJob,
  listJobs,
  getJob,
  confirmJobLocation,
  toJobResponse,
  normalizeStatus,
};
