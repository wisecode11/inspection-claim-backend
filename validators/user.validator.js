'use strict';

const HttpError = require('../utils/httpError');
const { ALL_PERMISSIONS } = require('../utils/permissions');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function optionalString(value, field, maxLength = 200) {
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

function parseName(body) {
  if (body.firstName) {
    return {
      firstName: requiredString(body.firstName, 'First name'),
      lastName: typeof body.lastName === 'string' ? body.lastName.trim() : '',
    };
  }

  const name = requiredString(body.name, 'Name');
  const parts = name.split(/\s+/);
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

function parseOptionalName(body = {}) {
  if (body.firstName !== undefined || body.lastName !== undefined || body.name !== undefined) {
    if (body.firstName || body.lastName) {
      return {
        firstName: optionalString(body.firstName, 'First name', 80),
        lastName: optionalString(body.lastName, 'Last name', 80),
      };
    }
    if (body.name) {
      const parts = String(body.name).trim().split(/\s+/);
      return {
        firstName: parts[0] || '',
        lastName: parts.slice(1).join(' '),
      };
    }
  }
  return {};
}

function parseCertifications(list) {
  if (list === undefined) return undefined;
  if (!Array.isArray(list)) {
    throw new HttpError(400, 'certifications must be an array');
  }
  return list.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new HttpError(400, `certifications[${index}] is invalid`);
    }
    return {
      name: requiredString(item.name, `Certification ${index + 1} name`),
      issuer: optionalString(item.issuer, 'Issuer', 160),
      number: optionalString(item.number, 'Certificate number', 80),
      issuedAt: item.issuedAt || null,
      expiresAt: item.expiresAt || null,
    };
  });
}

function createInspectorBody(body) {
  const email = requiredString(body.email, 'Email').toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new HttpError(400, 'Enter a valid email');
  }

  const password = requiredString(body.password, 'Password', 6);
  const { firstName, lastName } = parseName(body || {});

  return {
    name: `${firstName} ${lastName}`.trim(),
    firstName,
    lastName,
    email,
    password,
    phone: optionalString(body.phone, 'Phone', 30),
    licenseNumber: optionalString(body.licenseNumber, 'License number', 80),
    certifications: parseCertifications(body.certifications) || [],
  };
}

function updateInspectorBody(body = {}) {
  const result = {
    ...parseOptionalName(body),
    phone: body.phone !== undefined ? optionalString(body.phone, 'Phone', 30) : undefined,
    licenseNumber: body.licenseNumber !== undefined
      ? optionalString(body.licenseNumber, 'License number', 80)
      : undefined,
    certifications: parseCertifications(body.certifications),
  };

  if (body.password) {
    result.password = requiredString(body.password, 'Password', 6);
  }

  return Object.fromEntries(
    Object.entries(result).filter(([, value]) => value !== undefined)
  );
}

function inspectorStatusBody(body) {
  const status = String(body.status || '').trim();
  if (status !== 'active' && status !== 'suspended' && status !== 'deactivated') {
    throw new HttpError(400, 'Status must be active, suspended, or deactivated');
  }
  return { status };
}

function resetPasswordBody(body = {}) {
  if (body.password) {
    return { password: requiredString(body.password, 'Password', 6) };
  }
  return {};
}

function reassignJobsBody(body = {}) {
  const toInspectorId = typeof body.toInspectorId === 'string' ? body.toInspectorId.trim() : '';
  if (!toInspectorId) {
    throw new HttpError(400, 'toInspectorId is required');
  }
  const jobIds = Array.isArray(body.jobIds)
    ? body.jobIds.map((id) => String(id).trim()).filter(Boolean)
    : undefined;
  return { toInspectorId, jobIds };
}

function createStaffBody(body = {}) {
  const email = requiredString(body.email, 'Email').toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new HttpError(400, 'Enter a valid email');
  }

  const password = requiredString(body.password, 'Password', 6);
  const { firstName, lastName } = parseName(body);

  let permissions;
  if (body.permissions !== undefined) {
    if (!Array.isArray(body.permissions)) {
      throw new HttpError(400, 'permissions must be an array');
    }
    permissions = body.permissions.filter((item) => ALL_PERMISSIONS.includes(item));
  }

  return {
    firstName,
    lastName,
    email,
    password,
    phone: optionalString(body.phone, 'Phone', 30),
    permissions,
  };
}

function updateStaffBody(body = {}) {
  const result = {
    ...parseOptionalName(body),
    phone: body.phone !== undefined ? optionalString(body.phone, 'Phone', 30) : undefined,
  };

  if (body.password) {
    result.password = requiredString(body.password, 'Password', 6);
  }

  if (body.permissions !== undefined) {
    if (!Array.isArray(body.permissions)) {
      throw new HttpError(400, 'permissions must be an array');
    }
    result.permissions = body.permissions.filter((item) => ALL_PERMISSIONS.includes(item));
  }

  return Object.fromEntries(
    Object.entries(result).filter(([, value]) => value !== undefined)
  );
}

module.exports = {
  createInspectorBody,
  updateInspectorBody,
  inspectorStatusBody,
  resetPasswordBody,
  reassignJobsBody,
  createStaffBody,
  updateStaffBody,
};
