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
    { label: '1. Elevations', type: 'section' },
    { label: 'Front Elevation', type: 'boolean', required: true },
    { label: 'Right Elevation', type: 'boolean', required: true },
    { label: 'Rear Elevation', type: 'boolean', required: true },
    { label: 'Left Elevation', type: 'boolean', required: true },
    { label: 'Additional Elevations / Structures', type: 'boolean', required: false },

    { label: '2. Collateral Damage', type: 'section' },
    { label: 'Downspouts', type: 'boolean', required: false },
    { label: 'Window Screens', type: 'boolean', required: false },
    { label: 'Metal Fascia', type: 'boolean', required: false },
    { label: 'Siding', type: 'boolean', required: false },
    { label: 'Garage Doors', type: 'boolean', required: false },
    { label: 'AC Condenser / HVAC Fins', type: 'boolean', required: false },
    { label: 'Fences', type: 'boolean', required: false },
    { label: 'Decks / Railings', type: 'boolean', required: false },
    { label: 'Satellite Dishes', type: 'boolean', required: false },
    { label: 'Gutter Guards / Toppers', type: 'boolean', required: false },
    { label: 'Skylights', type: 'boolean', required: false },
    { label: 'Other Collateral', type: 'boolean', required: false },

    { label: '3. Spatter', type: 'section' },
    { label: 'Front Spatter', type: 'boolean', required: false },
    { label: 'Right Spatter', type: 'boolean', required: false },
    { label: 'Rear Spatter', type: 'boolean', required: false },
    { label: 'Left Spatter', type: 'boolean', required: false },
    { label: 'Roof Spatter', type: 'boolean', required: false },
    { label: 'Other Spatter', type: 'boolean', required: false },

    { label: '4. Hail Impacts: Metal', type: 'section' },
    { label: 'Metal Roof', type: 'boolean', required: false },
    { label: 'Metal Porch Roof', type: 'boolean', required: false },
    { label: 'Bay Window Metal Roof', type: 'boolean', required: false },
    { label: 'Metal Cornice Return', type: 'boolean', required: false },
    { label: 'Other Metal Roofing / Component', type: 'boolean', required: false },

    { label: '5. Hail Impacts: Shingles', type: 'section' },
    { label: 'Hail Bruising', type: 'boolean', required: false },
    { label: 'Granule Displacement', type: 'boolean', required: false },
    { label: 'Exposed Asphalt', type: 'boolean', required: false },
    { label: 'Mat Fracture', type: 'boolean', required: false },
    { label: 'Cracking', type: 'boolean', required: false },
    { label: 'Other Shingle Hail Damage', type: 'boolean', required: false },

    { label: '6. Test Squares', type: 'section' },
    { label: 'North Test Square', type: 'boolean', required: true },
    { label: 'South Test Square', type: 'boolean', required: true },
    { label: 'East Test Square', type: 'boolean', required: true },
    { label: 'West Test Square', type: 'boolean', required: true },

    { label: '7. Wear & Tear', type: 'section' },
    { label: 'Excessive Granule Loss', type: 'boolean', required: false },
    { label: 'Blistering', type: 'boolean', required: false },
    { label: 'Other Wear & Tear', type: 'boolean', required: false },

    { label: '8. Roof Tie-Ins', type: 'section' },
    { label: 'Connected Slopes', type: 'boolean', required: false },
    { label: 'Upper / Lower Slope Relationships', type: 'boolean', required: false },
    { label: 'Valleys', type: 'boolean', required: false },
    { label: 'Intersecting Roof Sections', type: 'boolean', required: false },
    { label: 'Areas that cannot be separated during replacement', type: 'boolean', required: false },

    { label: '9. Roof Overviews', type: 'section' },
    { label: 'Front Roof Overview', type: 'boolean', required: true },
    { label: 'Right Roof Overview', type: 'boolean', required: true },
    { label: 'Rear Roof Overview', type: 'boolean', required: true },
    { label: 'Left Roof Overview', type: 'boolean', required: true },
    { label: 'Ridge Overview', type: 'boolean', required: false },
    { label: 'Full Roof / Wide-Angle Overview', type: 'boolean', required: false },
    { label: 'Additional Roof Sections', type: 'boolean', required: false },

    { label: '10. Build Notes', type: 'section' },
    { label: 'Stories', type: 'boolean', required: false },
    { label: 'Roof Pitch', type: 'boolean', required: false },
    { label: 'Shingle Type', type: 'boolean', required: false },
    { label: 'Layers', type: 'boolean', required: false },
    { label: 'Ridge Vent / Box Vents', type: 'boolean', required: false },
    { label: 'Pipe Boots', type: 'boolean', required: false },
    { label: 'Skylights / Chimneys', type: 'boolean', required: false },
    { label: 'Gutters / Gutter Guards', type: 'boolean', required: false },
    { label: 'Satellite Dish / Solar Panels', type: 'boolean', required: false },
    { label: 'Roof Construction notes', type: 'boolean', required: false },
    { label: 'Special Conditions', type: 'boolean', required: false },
    { label: 'Access / Setup', type: 'boolean', required: false },
    { label: 'Additional Build Notes', type: 'boolean', required: false },
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
    name: 'Inspector form',
    description: '',
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
    name: payload.name || 'Inspector form',
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
