'use strict';

const HttpError = require('../utils/httpError');
const { JOB_STATUSES, JOB_PRIORITIES } = require('../models/enums');
const { normalizeStatus } = require('../utils/jobStatus');

function requiredString(value, field, minLength = 1) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length < minLength) {
    throw new HttpError(400, `${field} must be at least ${minLength} characters`);
  }
  return trimmed;
}

function optionalString(value, field, maxLength = 4000) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') {
    throw new HttpError(400, `${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpError(400, `${field} is too long`);
  }
  return trimmed;
}

function optionalNumber(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new HttpError(400, `${field} must be a number`);
  }
  return num;
}

function parseDateOfLoss(value) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) {
    throw new HttpError(400, 'Date of loss is required');
  }

  const isoDay = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = isoDay
    ? new Date(Date.UTC(Number(isoDay[1]), Number(isoDay[2]) - 1, Number(isoDay[3])))
    : new Date(raw);

  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'Date of loss must be a valid date (YYYY-MM-DD)');
  }

  const tomorrow = new Date();
  tomorrow.setUTCHours(23, 59, 59, 999);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (date > tomorrow) {
    throw new HttpError(400, 'Date of loss cannot be in the future');
  }

  return date;
}

function parsePriority(value, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, 'Priority is required');
    return JOB_PRIORITIES.NORMAL;
  }
  const priority = String(value).trim().toLowerCase();
  if (!Object.values(JOB_PRIORITIES).includes(priority)) {
    throw new HttpError(400, 'Invalid priority');
  }
  return priority;
}

function parseAttachments(list) {
  if (list === undefined) return undefined;
  if (!Array.isArray(list)) {
    throw new HttpError(400, 'Attachments must be an array');
  }
  return list.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new HttpError(400, `Attachment ${index + 1} is invalid`);
    }
    const url = optionalString(item.url, `Attachment ${index + 1} file`, 2_500_000);
    if (!url) {
      throw new HttpError(400, `Attachment ${index + 1} file is required`);
    }
    return {
      name: requiredString(item.name, `Attachment ${index + 1} name`),
      url,
      mimeType: optionalString(item.mimeType, 'Mime type', 120),
      size: optionalNumber(item.size, 'Attachment size') || 0,
      uploadedAt: item.uploadedAt ? new Date(item.uploadedAt) : new Date(),
    };
  });
}

function parseClaim(claim = {}, { required = false } = {}) {
  if (required) {
    return {
      insuranceCompany: requiredString(claim.insuranceCompany || claim.carrierName, 'Carrier name', 2),
      policyNumber: requiredString(claim.policyNumber, 'Policy number'),
      claimNumber: requiredString(claim.claimNumber, 'Claim number'),
      dateOfLoss: claim.dateOfLoss || null,
      status: claim.status || undefined,
    };
  }
  return {
    insuranceCompany: optionalString(claim.insuranceCompany || claim.carrierName, 'Carrier name', 160),
    policyNumber: optionalString(claim.policyNumber, 'Policy number', 80),
    claimNumber: optionalString(claim.claimNumber, 'Claim number', 80),
    dateOfLoss: claim.dateOfLoss || null,
    status: claim.status || undefined,
  };
}

function parsePropertyInfo(info = {}) {
  return {
    yearBuilt: optionalNumber(info.yearBuilt, 'Year built'),
    stories: optionalNumber(info.stories, 'Stories'),
    roofType: optionalString(info.roofType, 'Roof type', 80),
    squareFootage: optionalNumber(info.squareFootage, 'Square footage'),
    notes: optionalString(info.notes, 'Property notes', 2000),
  };
}

function parseCustomer(customer = {}, { requireAll = true } = {}) {
  if (requireAll) {
    return {
      name: requiredString(customer.name, 'Homeowner name'),
      email: requiredString(customer.email, 'Homeowner email').toLowerCase(),
      phone: requiredString(customer.phone, 'Homeowner phone'),
    };
  }
  return {
    name: optionalString(customer.name, 'Homeowner name', 160) || undefined,
    email: optionalString(customer.email, 'Customer email', 254),
    phone: optionalString(customer.phone, 'Customer phone', 30),
  };
}

function parseAddress(address = {}, { required = true } = {}) {
  const line1Raw = address.line1 || address.street;
  if (required) {
    return {
      line1: requiredString(line1Raw, 'Property address'),
      line2: optionalString(address.line2, 'Address line 2', 120),
      city: requiredString(address.city, 'City'),
      state: requiredString(address.state, 'State'),
      postalCode: requiredString(address.postalCode || address.zip, 'Zip code'),
      country: optionalString(address.country, 'Country', 8) || 'US',
      formatted: optionalString(address.formatted, 'Formatted address', 300),
    };
  }
  return {
    line1: optionalString(line1Raw, 'Property address', 200),
    line2: optionalString(address.line2, 'Address line 2', 120),
    city: optionalString(address.city, 'City', 80),
    state: optionalString(address.state, 'State', 80),
    postalCode: optionalString(address.postalCode || address.zip, 'Zip code', 20),
    country: optionalString(address.country, 'Country', 8),
    formatted: optionalString(address.formatted, 'Formatted address', 300),
  };
}

function createJobBody(body = {}) {
  const inspectorId = typeof body.inspectorId === 'string' ? body.inspectorId.trim() : '';
  const claim = parseClaim(body.claim || {}, { required: true });
  const dateOfLoss = parseDateOfLoss(body.dateOfLoss || claim.dateOfLoss);
  claim.dateOfLoss = dateOfLoss;

  return {
    title: requiredString(body.title || body.jobTitle, 'Job title'),
    priority: parsePriority(body.priority),
    dueDate: body.dueDate || null,
    customer: parseCustomer(body.customer || {}, { requireAll: true }),
    address: parseAddress(body.address || {}, { required: true }),
    claim,
    propertyInfo: parsePropertyInfo(body.propertyInfo || {}),
    notes: optionalString(body.notes, 'Notes'),
    attachments: parseAttachments(body.attachments) || [],
    inspectorId,
    dateOfLoss,
  };
}

function updateJobBody(body = {}) {
  const result = {};

  if (body.title !== undefined || body.jobTitle !== undefined) {
    result.title = requiredString(body.title || body.jobTitle, 'Job title');
  }
  if (body.priority !== undefined) {
    result.priority = parsePriority(body.priority, { required: true });
  }
  if (body.dueDate !== undefined) {
    result.dueDate = body.dueDate || null;
  }
  if (body.customer) {
    result.customer = parseCustomer(body.customer, { requireAll: false });
  }
  if (body.address) {
    result.address = parseAddress(body.address, { required: false });
  }
  if (body.claim) {
    result.claim = parseClaim(body.claim, { required: false });
  }
  if (body.propertyInfo) {
    result.propertyInfo = parsePropertyInfo(body.propertyInfo);
  }
  if (body.notes !== undefined) {
    result.notes = optionalString(body.notes, 'Notes');
  }
  if (body.attachments !== undefined) {
    result.attachments = parseAttachments(body.attachments) || [];
  }
  if (body.inspectorId !== undefined) {
    if (body.inspectorId === null || body.inspectorId === '') {
      result.unassign = true;
      result.inspectorId = null;
    } else if (typeof body.inspectorId === 'string') {
      result.inspectorId = body.inspectorId.trim();
    } else {
      throw new HttpError(400, 'inspectorId must be a string');
    }
  }

  return result;
}

function assignJobBody(body = {}) {
  const inspectorId = typeof body.inspectorId === 'string' ? body.inspectorId.trim() : '';
  if (!inspectorId) {
    throw new HttpError(400, 'inspectorId is required');
  }
  const result = { inspectorId };
  if (body.dueDate !== undefined) result.dueDate = body.dueDate || null;
  if (body.priority !== undefined) result.priority = parsePriority(body.priority);
  return result;
}

function bulkAssignBody(body = {}) {
  if (!Array.isArray(body.jobIds) || !body.jobIds.length) {
    throw new HttpError(400, 'jobIds are required');
  }
  const jobIds = body.jobIds.map((id) => String(id).trim()).filter(Boolean);
  if (!jobIds.length) {
    throw new HttpError(400, 'jobIds are required');
  }
  const inspectorId = typeof body.inspectorId === 'string' ? body.inspectorId.trim() : '';
  if (!inspectorId) {
    throw new HttpError(400, 'inspectorId is required');
  }
  const result = { jobIds, inspectorId };
  if (body.dueDate !== undefined) result.dueDate = body.dueDate || null;
  if (body.priority !== undefined) result.priority = parsePriority(body.priority);
  return result;
}

const PRODUCT_STATUSES = new Set([
  JOB_STATUSES.DRAFT,
  JOB_STATUSES.ASSIGNED,
  JOB_STATUSES.IN_PROGRESS,
  JOB_STATUSES.SUBMITTED,
  JOB_STATUSES.REVIEWED,
  JOB_STATUSES.COMPLETED,
  JOB_STATUSES.REJECTED,
  JOB_STATUSES.REOPENED,
  JOB_STATUSES.ON_HOLD,
]);

function statusBody(body = {}) {
  const raw = String(body.status || '').trim();
  const status = normalizeStatus(raw);
  if (!PRODUCT_STATUSES.has(status) && !Object.values(JOB_STATUSES).includes(raw)) {
    throw new HttpError(400, 'Invalid job status');
  }
  return { status };
}

function cancelJobBody(body = {}) {
  return {
    reason: optionalString(body.reason, 'Cancel reason', 500),
  };
}

function verifyWeatherBody(body = {}) {
  if (!body.jobId || typeof body.jobId !== 'string' || !body.jobId.trim()) {
    throw new HttpError(400, 'jobId is required');
  }
  return {
    jobId: body.jobId.trim(),
    force: Boolean(body.force),
  };
}

module.exports = {
  createJobBody,
  updateJobBody,
  assignJobBody,
  bulkAssignBody,
  statusBody,
  cancelJobBody,
  verifyWeatherBody,
  parseDateOfLoss,
};
