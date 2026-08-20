'use strict';

const mongoose = require('mongoose');
const { CodeCitation, Checklist } = require('../models');
const { TEMPLATE_SCOPES } = require('../models/enums');
const HttpError = require('../utils/httpError');

function toCitationResponse(doc) {
  return {
    id: String(doc._id),
    scope: doc.scope,
    state: doc.state,
    code: doc.code,
    title: doc.title,
    body: doc.body,
    source: doc.source || '',
    isActive: Boolean(doc.isActive),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function slugKey(value, fallback = 'step') {
  const base = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return base || fallback;
}

function normalizeSteps(steps = []) {
  return steps.map((step, index) => ({
    key: step.key || slugKey(step.label || step.title, `step_${index + 1}`),
    label: String(step.label || step.title || `Step ${index + 1}`).trim(),
    type: step.type || 'boolean',
    required: Boolean(step.required),
    helpText: step.helpText || '',
    options: step.options || [],
    elevationRequired: Boolean(step.elevationRequired),
    sortOrder: step.sortOrder ?? index,
  }));
}

function toChecklistResponse(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    version: doc.version,
    description: doc.description || '',
    isDefault: Boolean(doc.isDefault),
    isActive: Boolean(doc.isActive),
    steps: (doc.steps || [])
      .slice()
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map((step, index) => ({
        id: String(step._id || `${step.key}-${index}`),
        key: step.key,
        label: step.label,
        type: step.type,
        required: Boolean(step.required),
        helpText: step.helpText || '',
        options: step.options || [],
        elevationRequired: Boolean(step.elevationRequired),
        sortOrder: step.sortOrder ?? index,
      })),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function defaultInspectionSteps() {
  const rows = [
    { label: 'Roof Inspection', type: 'section' },
    { label: 'Roof Overview', type: 'boolean', required: true },
    { label: 'Slope Inspection', type: 'boolean', required: true },
    { label: 'Ridge Inspection', type: 'boolean', required: true },
    { label: 'Flashing Inspection', type: 'boolean', required: true },
    { label: 'Vent Inspection', type: 'boolean', required: true },
    { label: 'Exterior Inspection', type: 'section' },
    { label: 'Gutters', type: 'boolean', required: true },
    { label: 'Siding', type: 'boolean', required: false },
    { label: 'Windows', type: 'boolean', required: false },
    { label: 'Interior Inspection', type: 'section' },
    { label: 'Ceilings', type: 'boolean', required: false },
    { label: 'Water Stains', type: 'boolean', required: false },
  ];
  return normalizeSteps(rows);
}

async function clearOtherChecklistDefaults(companyId, keepId) {
  await Checklist.updateMany(
    { companyId, _id: { $ne: keepId }, isDefault: true },
    { $set: { isDefault: false } }
  );
}

async function listCitations(user, query = {}) {
  const filter = {
    $or: [
      { scope: TEMPLATE_SCOPES.PLATFORM },
      { scope: TEMPLATE_SCOPES.TENANT, companyId: user.companyId },
    ],
  };
  if (query.state) filter.state = String(query.state).toUpperCase();
  if (query.active === 'true') filter.isActive = true;

  const rows = await CodeCitation.find(filter).sort({ state: 1, code: 1 });
  return rows.map(toCitationResponse);
}

async function createCitation(user, payload) {
  const citation = await CodeCitation.create({
    scope: TEMPLATE_SCOPES.TENANT,
    companyId: user.companyId,
    state: String(payload.state || '').toUpperCase(),
    code: payload.code,
    title: payload.title,
    body: payload.body,
    source: payload.source || '',
    isActive: payload.isActive !== false,
    createdBy: user._id,
  });
  return toCitationResponse(citation);
}

async function updateCitation(user, id, payload = {}) {
  if (!mongoose.isValidObjectId(id)) {
    throw new HttpError(400, 'Invalid citation id');
  }

  const citation = await CodeCitation.findOne({
    _id: id,
    scope: TEMPLATE_SCOPES.TENANT,
    companyId: user.companyId,
  });
  if (!citation) {
    throw new HttpError(404, 'Citation not found');
  }

  if (payload.state !== undefined) citation.state = String(payload.state).toUpperCase();
  if (payload.code !== undefined) citation.code = payload.code;
  if (payload.title !== undefined) citation.title = payload.title;
  if (payload.body !== undefined) citation.body = payload.body;
  if (payload.source !== undefined) citation.source = payload.source;
  if (payload.isActive !== undefined) citation.isActive = Boolean(payload.isActive);
  citation.updatedBy = user._id;
  await citation.save();
  return toCitationResponse(citation);
}

async function deleteCitation(user, id) {
  if (!mongoose.isValidObjectId(id)) {
    throw new HttpError(400, 'Invalid citation id');
  }

  const citation = await CodeCitation.findOne({
    _id: id,
    scope: TEMPLATE_SCOPES.TENANT,
    companyId: user.companyId,
  });
  if (!citation) {
    throw new HttpError(404, 'Citation not found');
  }

  await citation.softDelete(user._id);
  return { id: String(citation._id) };
}

async function listChecklists(user) {
  const rows = await Checklist.find({ companyId: user.companyId }).sort({
    isDefault: -1,
    name: 1,
  });
  return rows.map(toChecklistResponse);
}

async function ensureDefaultChecklist(user) {
  const existing = await Checklist.findOne({
    companyId: user.companyId,
    isDefault: true,
    isActive: true,
  });
  if (existing) return toChecklistResponse(existing);

  const any = await Checklist.findOne({ companyId: user.companyId }).sort({ updatedAt: -1 });
  if (any) {
    any.isDefault = true;
    await any.save();
    return toChecklistResponse(any);
  }

  const created = await Checklist.create({
    scope: TEMPLATE_SCOPES.TENANT,
    companyId: user.companyId,
    name: 'Standard roof inspection',
    description: 'Company inspection standards',
    version: 1,
    isDefault: true,
    isActive: true,
    steps: defaultInspectionSteps(),
    createdBy: user._id,
  });
  return toChecklistResponse(created);
}

async function createChecklist(user, payload) {
  const count = await Checklist.countDocuments({ companyId: user.companyId });
  const makeDefault = payload.isDefault === true || count === 0;
  const checklist = await Checklist.create({
    scope: TEMPLATE_SCOPES.TENANT,
    companyId: user.companyId,
    name: payload.name || 'Inspection checklist',
    description: payload.description || '',
    version: 1,
    isDefault: makeDefault,
    isActive: payload.isActive !== false,
    steps: normalizeSteps(
      payload.steps?.length ? payload.steps : defaultInspectionSteps()
    ),
    createdBy: user._id,
  });
  if (makeDefault) {
    await clearOtherChecklistDefaults(user.companyId, checklist._id);
  }
  return toChecklistResponse(checklist);
}

async function updateChecklist(user, id, payload = {}) {
  if (!mongoose.isValidObjectId(id)) {
    throw new HttpError(400, 'Invalid checklist id');
  }

  const checklist = await Checklist.findOne({ _id: id, companyId: user.companyId });
  if (!checklist) {
    throw new HttpError(404, 'Checklist not found');
  }

  if (payload.name !== undefined) checklist.name = payload.name;
  if (payload.description !== undefined) checklist.description = payload.description;
  if (payload.steps !== undefined) {
    checklist.steps = normalizeSteps(payload.steps);
    checklist.version = (checklist.version || 1) + 1;
  }
  if (payload.isActive !== undefined) checklist.isActive = Boolean(payload.isActive);
  if (payload.isDefault === true) checklist.isDefault = true;
  checklist.updatedBy = user._id;
  await checklist.save();

  if (checklist.isDefault) {
    await clearOtherChecklistDefaults(user.companyId, checklist._id);
  }

  return toChecklistResponse(checklist);
}

module.exports = {
  listCitations,
  createCitation,
  updateCitation,
  deleteCitation,
  listChecklists,
  ensureDefaultChecklist,
  createChecklist,
  updateChecklist,
};
