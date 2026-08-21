'use strict';

const mongoose = require('mongoose');
const { ReportTemplate, CodeCitation } = require('../models');
const { TEMPLATE_SCOPES } = require('../models/enums');
const HttpError = require('../utils/httpError');

const EMPTY_LANGUAGE = {
  roof_damage: '',
  hail_damage: '',
  wind_damage: '',
  missing_shingles: '',
  interior_damage: '',
};

function slugKey(value, fallback = 'section') {
  const base = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return base || fallback;
}

const DEFAULT_LEGAL_FOOTER =
  'This report reflects conditions observed at the time of inspection and is not a coverage determination.';

function defaultSections() {
  const titles = [
    'Property / Cover',
    'Assessment Summary',
    'Damage Definitions & Assessment Criteria',
    'Hail Report / Weather Data',
    'Elevations',
    'Collateral Damage',
    'Spatter',
    'Hail Impacts — Metal',
    'Hail Impacts — Shingles',
    'Test Squares',
    'Wear & Tear',
    'Roof Tie-Ins',
    'Roof Overviews',
    'Build Notes',
    'Existing Conditions',
    'Codes and Standards',
    "Inspector's Declaration",
  ];

  return titles.map((title, index) => ({
    key: slugKey(title, `section_${index + 1}`),
    title,
    include: true,
    sortOrder: index,
    body: title === 'Existing Conditions' ? 'Estimated roof age: [ROOF AGE] years.' : '',
  }));
}

function toTemplateResponse(doc) {
  const language = doc.defaultLanguage || {};
  return {
    id: String(doc._id),
    name: doc.name,
    description: doc.description || '',
    version: doc.version || 1,
    isDefault: Boolean(doc.isDefault),
    isActive: Boolean(doc.isActive),
    sections: (doc.sections || [])
      .slice()
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map((section, index) => ({
        id: String(section._id || `${section.key}-${index}`),
        key: section.key,
        title: section.title,
        include: section.include !== false,
        sortOrder: section.sortOrder ?? index,
        body: section.body || '',
      })),
    definitions: doc.definitions || '',
    legalFooter: doc.legalFooter || '',
    defaultLanguage: {
      roof_damage: language.roof_damage || '',
      hail_damage: language.hail_damage || '',
      wind_damage: language.wind_damage || '',
      missing_shingles: language.missing_shingles || '',
      interior_damage: language.interior_damage || '',
    },
    codeCitationIds: (doc.codeCitationIds || []).map((id) => String(id)),
    includeWeatherPage: doc.includeWeatherPage !== false,
    includeTestSquares: doc.includeTestSquares !== false,
    includeCollateral: doc.includeCollateral !== false,
    includePhotoIndex: doc.includePhotoIndex !== false,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function normalizeSections(sections = []) {
  return sections.map((section, index) => ({
    key: section.key || slugKey(section.title, `section_${index + 1}`),
    title: String(section.title || `Section ${index + 1}`).trim(),
    include: section.include !== false && section.visible !== false,
    sortOrder: section.sortOrder ?? index,
    body: section.body || section.defaultContent || '',
  }));
}

function normalizeLanguage(payload = {}) {
  return {
    roof_damage: payload.roof_damage || payload.roofDamage || '',
    hail_damage: payload.hail_damage || payload.hailDamage || '',
    wind_damage: payload.wind_damage || payload.windDamage || '',
    missing_shingles: payload.missing_shingles || payload.missingShingles || '',
    interior_damage: payload.interior_damage || payload.interiorDamage || '',
  };
}

async function clearOtherDefaults(companyId, keepId) {
  await ReportTemplate.updateMany(
    {
      companyId,
      _id: { $ne: keepId },
      isDefault: true,
    },
    { $set: { isDefault: false } }
  );
}

async function listTemplates(user) {
  const rows = await ReportTemplate.find({ companyId: user.companyId }).sort({
    isDefault: -1,
    name: 1,
  });
  return rows.map(toTemplateResponse);
}

async function getTemplate(user, id) {
  if (!mongoose.isValidObjectId(id)) {
    throw new HttpError(400, 'Invalid template id');
  }
  const doc = await ReportTemplate.findOne({ _id: id, companyId: user.companyId });
  if (!doc) {
    throw new HttpError(404, 'Report template not found');
  }
  return toTemplateResponse(doc);
}

async function ensureDefaultTemplate(user) {
  const existing = await ReportTemplate.findOne({
    companyId: user.companyId,
    isDefault: true,
    isActive: true,
  });
  if (existing) {
    return toTemplateResponse(existing);
  }

  const any = await ReportTemplate.findOne({ companyId: user.companyId }).sort({ updatedAt: -1 });
  if (any) {
    any.isDefault = true;
    await any.save();
    return toTemplateResponse(any);
  }

  const created = await ReportTemplate.create({
    scope: TEMPLATE_SCOPES.TENANT,
    companyId: user.companyId,
    name: 'PDF report',
    description: '',
    version: 1,
    isDefault: true,
    isActive: true,
    sections: defaultSections(),
    definitions: '',
    legalFooter: DEFAULT_LEGAL_FOOTER,
    defaultLanguage: { ...EMPTY_LANGUAGE },
    codeCitationIds: [],
    createdBy: user._id,
  });
  return toTemplateResponse(created);
}

async function createTemplate(user, payload = {}) {
  const count = await ReportTemplate.countDocuments({ companyId: user.companyId });
  const makeDefault = payload.isDefault === true || count === 0;

  if (payload.codeCitationIds?.length) {
    await assertCitationsBelongToCompany(user, payload.codeCitationIds);
  }

  const doc = await ReportTemplate.create({
    scope: TEMPLATE_SCOPES.TENANT,
    companyId: user.companyId,
    name: payload.name || 'Report template',
    description: payload.description || '',
    version: 1,
    isDefault: makeDefault,
    isActive: payload.isActive !== false,
    sections: normalizeSections(payload.sections?.length ? payload.sections : defaultSections()),
    definitions: payload.definitions || '',
    legalFooter: payload.legalFooter || payload.disclaimerText || '',
    defaultLanguage: normalizeLanguage(payload.defaultLanguage),
    codeCitationIds: payload.codeCitationIds || [],
    includeWeatherPage: payload.includeWeatherPage !== false,
    includeTestSquares: payload.includeTestSquares !== false,
    includeCollateral: payload.includeCollateral !== false,
    includePhotoIndex: payload.includePhotoIndex !== false,
    createdBy: user._id,
  });

  if (makeDefault) {
    await clearOtherDefaults(user.companyId, doc._id);
  }

  return toTemplateResponse(doc);
}

async function assertCitationsBelongToCompany(user, ids) {
  const objectIds = ids.filter((id) => mongoose.isValidObjectId(id));
  if (!objectIds.length) return;
  const count = await CodeCitation.countDocuments({
    _id: { $in: objectIds },
    $or: [
      { scope: TEMPLATE_SCOPES.PLATFORM },
      { scope: TEMPLATE_SCOPES.TENANT, companyId: user.companyId },
    ],
  });
  if (count !== objectIds.length) {
    throw new HttpError(400, 'One or more code citations are invalid for this company');
  }
}

async function updateTemplate(user, id, payload = {}) {
  if (!mongoose.isValidObjectId(id)) {
    throw new HttpError(400, 'Invalid template id');
  }

  const doc = await ReportTemplate.findOne({ _id: id, companyId: user.companyId });
  if (!doc) {
    throw new HttpError(404, 'Report template not found');
  }

  if (payload.name !== undefined) doc.name = payload.name;
  if (payload.description !== undefined) doc.description = payload.description;
  if (payload.definitions !== undefined) doc.definitions = payload.definitions;
  if (payload.legalFooter !== undefined || payload.disclaimerText !== undefined) {
    doc.legalFooter = payload.legalFooter ?? payload.disclaimerText;
  }
  if (payload.defaultLanguage !== undefined) {
    doc.defaultLanguage = normalizeLanguage(payload.defaultLanguage);
  }
  if (payload.sections !== undefined) {
    doc.sections = normalizeSections(payload.sections);
    doc.version = (doc.version || 1) + 1;
  }
  if (payload.codeCitationIds !== undefined) {
    await assertCitationsBelongToCompany(user, payload.codeCitationIds);
    doc.codeCitationIds = payload.codeCitationIds;
  }
  if (payload.includeWeatherPage !== undefined) doc.includeWeatherPage = Boolean(payload.includeWeatherPage);
  if (payload.includeTestSquares !== undefined) doc.includeTestSquares = Boolean(payload.includeTestSquares);
  if (payload.includeCollateral !== undefined) doc.includeCollateral = Boolean(payload.includeCollateral);
  if (payload.includePhotoIndex !== undefined) doc.includePhotoIndex = Boolean(payload.includePhotoIndex);
  if (payload.isActive !== undefined) doc.isActive = Boolean(payload.isActive);
  if (payload.isDefault === true) {
    doc.isDefault = true;
  }

  doc.updatedBy = user._id;
  await doc.save();

  if (doc.isDefault) {
    await clearOtherDefaults(user.companyId, doc._id);
  }

  return toTemplateResponse(doc);
}

async function getDefaultForCompany(companyId) {
  const preferred = await ReportTemplate.findOne({
    companyId,
    isDefault: true,
    isActive: true,
  });
  if (preferred) return preferred;
  return ReportTemplate.findOne({ companyId, isActive: true }).sort({ updatedAt: -1 });
}

module.exports = {
  listTemplates,
  getTemplate,
  ensureDefaultTemplate,
  createTemplate,
  updateTemplate,
  getDefaultForCompany,
  toTemplateResponse,
  EMPTY_LANGUAGE,
};
