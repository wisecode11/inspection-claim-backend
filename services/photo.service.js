'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const { Job, Photo, Inspection } = require('../models');
const {
  USER_ROLES,
  PHOTO_SUBJECT_TYPES,
  PHOTO_STATUSES,
  CUSTODY_EVENTS,
  INSPECTION_STATUSES,
} = require('../models/enums');
const HttpError = require('../utils/httpError');

const STEP_SUBJECT_MAP = Object.freeze({
  elevations: PHOTO_SUBJECT_TYPES.OVERVIEW,
  collateral: PHOTO_SUBJECT_TYPES.COLLATERAL,
  'test-squares': PHOTO_SUBJECT_TYPES.TEST_SQUARE,
  'roof-overviews': PHOTO_SUBJECT_TYPES.OVERVIEW,
});

function stripDataUri(base64 = '') {
  const raw = String(base64 || '').trim();
  const match = raw.match(/^data:([^;]+);base64,(.+)$/i);
  if (match) {
    return { mimeType: match[1], base64: match[2] };
  }
  return { mimeType: null, base64: raw };
}

function mapSubjectType(stepId) {
  if (!stepId) return PHOTO_SUBJECT_TYPES.INSPECTION;
  return STEP_SUBJECT_MAP[stepId] || PHOTO_SUBJECT_TYPES.INSPECTION;
}

function toPhotoResponse(photo) {
  return {
    id: String(photo._id),
    jobId: String(photo.jobId),
    inspectionId: photo.inspectionId ? String(photo.inspectionId) : null,
    subjectType: photo.subjectType,
    status: photo.status,
    caption: photo.caption || '',
    sortOrder: photo.sortOrder || 0,
    includeInReport: photo.includeInReport !== false,
    url: photo.storage?.url || '',
    createdAt: photo.createdAt,
    takenAt: photo.capture?.takenAt || null,
    clientUuid: photo.clientUuid || '',
  };
}

async function findAssignedJob(actor, jobId) {
  if (!mongoose.isValidObjectId(jobId)) {
    throw new HttpError(400, 'Valid job id is required');
  }

  const filter = { _id: jobId, companyId: actor.companyId };
  if (actor.role === USER_ROLES.INSPECTOR) {
    filter.assignedTo = actor._id;
  }

  const job = await Job.findOne(filter);
  if (!job) {
    throw new HttpError(404, 'Job not found');
  }
  return job;
}

async function ensureInspectionForJob(actor, job) {
  let inspection = await Inspection.findOne({
    jobId: job._id,
    companyId: actor.companyId,
  }).sort({ createdAt: -1 });

  if (!inspection) {
    inspection = await Inspection.create({
      companyId: actor.companyId,
      jobId: job._id,
      inspectorId: job.assignedTo || actor._id,
      status: INSPECTION_STATUSES.IN_PROGRESS,
      startedAt: new Date(),
      createdBy: actor._id,
    });
  }

  return inspection;
}

async function uploadJobPhoto(actor, jobId, body = {}) {
  const job = await findAssignedJob(actor, jobId);
  const inspection = await ensureInspectionForJob(actor, job);

  const parsed = stripDataUri(body.base64);
  if (!parsed.base64) {
    throw new HttpError(400, 'Photo base64 is required');
  }

  let buffer;
  try {
    buffer = Buffer.from(parsed.base64, 'base64');
  } catch {
    throw new HttpError(400, 'Invalid photo base64');
  }
  if (!buffer.length) {
    throw new HttpError(400, 'Photo data is empty');
  }

  const mimeType = body.mimeType || parsed.mimeType || 'image/jpeg';
  const token = crypto.randomBytes(16).toString('hex');
  const clientUuid = body.clientUuid ? String(body.clientUuid).trim() : '';

  let photo = null;
  if (clientUuid) {
    photo = await Photo.findOne({
      companyId: actor.companyId,
      jobId: job._id,
      clientUuid,
    });
  }

  const storageMeta = {
    bucket: 'local',
    key: '',
    url: '',
    mimeType,
    sizeBytes: buffer.length,
    checksum: crypto.createHash('sha256').update(buffer).digest('hex'),
    originalFileName: body.fileName || `${clientUuid || 'photo'}.jpg`,
  };

  if (photo) {
    photo.caption = body.caption || photo.caption || '';
    photo.sortOrder = body.sortOrder != null ? Number(body.sortOrder) : photo.sortOrder;
    photo.subjectType = mapSubjectType(body.stepId);
    photo.inspectionId = inspection._id;
    photo.status = PHOTO_STATUSES.SYNCED;
    photo.includeInReport = body.includeInReport !== false;
    photo.storage = storageMeta;
    photo.capture = {
      ...(photo.capture || {}),
      takenAt: body.takenAt ? new Date(body.takenAt) : photo.capture?.takenAt || new Date(),
    };
    photo.filePayload = {
      token,
      base64: parsed.base64,
      mimeType,
    };
    photo.storage.url = `/api/photos/${photo._id}/file?token=${token}`;
    photo.storage.key = `photos/${photo._id}`;
    photo.chainOfCustody = [
      ...(photo.chainOfCustody || []),
      { event: CUSTODY_EVENTS.UPLOADED, at: new Date(), by: actor._id },
    ];
    photo.updatedBy = actor._id;
    await photo.save();
    return toPhotoResponse(photo);
  }

  photo = await Photo.create({
    companyId: actor.companyId,
    jobId: job._id,
    inspectionId: inspection._id,
    subjectType: mapSubjectType(body.stepId),
    caption: body.caption || '',
    sortOrder: body.sortOrder != null ? Number(body.sortOrder) : 0,
    includeInReport: body.includeInReport !== false,
    status: PHOTO_STATUSES.SYNCED,
    clientUuid: clientUuid || undefined,
    capture: {
      takenAt: body.takenAt ? new Date(body.takenAt) : new Date(),
    },
    storage: storageMeta,
    filePayload: {
      token,
      base64: parsed.base64,
      mimeType,
    },
    chainOfCustody: [
      { event: CUSTODY_EVENTS.CAPTURED, at: body.takenAt ? new Date(body.takenAt) : new Date(), by: actor._id },
      { event: CUSTODY_EVENTS.UPLOADED, at: new Date(), by: actor._id },
    ],
    createdBy: actor._id,
  });

  photo.storage.key = `photos/${photo._id}`;
  photo.storage.url = `/api/photos/${photo._id}/file?token=${token}`;
  await photo.save();

  return toPhotoResponse(photo);
}

async function getPhotoBuffer(photoId, token) {
  if (!mongoose.isValidObjectId(photoId)) {
    throw new HttpError(400, 'Invalid photo id');
  }

  const photo = await Photo.findById(photoId).select('+filePayload');
  if (!photo) {
    throw new HttpError(404, 'Photo not found');
  }

  const expected = photo.filePayload?.token;
  if (!expected || expected !== token) {
    throw new HttpError(403, 'Invalid download token');
  }

  const base64 = photo.filePayload?.base64;
  if (!base64) {
    throw new HttpError(404, 'Photo file not available');
  }

  return {
    buffer: Buffer.from(base64, 'base64'),
    mimeType: photo.filePayload?.mimeType || photo.storage?.mimeType || 'image/jpeg',
    fileName: photo.storage?.originalFileName || 'photo.jpg',
  };
}

module.exports = {
  uploadJobPhoto,
  getPhotoBuffer,
  toPhotoResponse,
  ensureInspectionForJob,
};
