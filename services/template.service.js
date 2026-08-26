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

/** Admin-editable narrative slots (v4). Photo sections stay fixed — filled by inspector tags. */
const DEFAULT_SECTION_BODIES = {
  'Summary of Findings':
    'Summary of Findings documents objective evidence gathered after wind or hail events to demonstrate conditions observed at the time of inspection. Photo sections below are organized by capture category and damage tags applied in the field.',
  'Investigation Process':
    'Visual inspection of slopes and elevations; collateral damage documentation; weather / third-party data review; property-owner interview when available; material and repairability assessment; documentation of pre-existing conditions and applicable code considerations.',
  'Damage Definitions & Assessment Criteria':
    'Physical damage is a distinct and demonstrable physical alteration of a building component. Functional damage determination is guided by HAAG Engineering standards and related industry practice. Functional damage compromises serviceability, structural integrity, or waterproofing. Cosmetic damage affects appearance without impairing material function.',
  'Existing Conditions':
    'The estimated roof age is [ROOF AGE]. Age-related wear and other pre-existing conditions may increase vulnerability to storm forces, but are not identified in this package as the cause of the storm-related damage that was observed and photographed during this inspection.',
};

function defaultSections() {
  const titles = [
    'Property / Cover',
    'Assessment Summary',
    'Summary of Findings',
    'Investigation Process',
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
    body: DEFAULT_SECTION_BODIES[title] || '',
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

function findSectionBody(sections = [], key, title) {
  const byKey = sections.find((row) => row.key === key);
  if (byKey?.body?.trim()) return byKey.body.trim();
  const byTitle = sections.find(
    (row) => String(row.title || '').toLowerCase() === String(title || '').toLowerCase()
  );
  if (byTitle?.body?.trim()) return byTitle.body.trim();
  return '';
}

/**
 * Inspector mobile PDF package — company default narrative + selected citations.
 * Read-only for field app; mirrors admin Report language tab.
 */
async function getReportLanguagePackage(user) {
  const templateDoc = await ensureDefaultTemplate(user);
  const sections = templateDoc.sections || [];

  const summaryOfFindings = findSectionBody(
    sections,
    'summary_of_findings',
    'Summary of Findings'
  );
  const investigationProcess = findSectionBody(
    sections,
    'investigation_process',
    'Investigation Process'
  );
  let damageDefinitions = findSectionBody(
    sections,
    'damage_definitions_assessment_criteria',
    'Damage Definitions & Assessment Criteria'
  );
  if (!damageDefinitions && templateDoc.definitions?.trim()) {
    damageDefinitions = templateDoc.definitions.trim();
  }
  const existingConditions = findSectionBody(
    sections,
    'existing_conditions',
    'Existing Conditions'
  );

  const citationIds = (templateDoc.codeCitationIds || []).filter((id) =>
    mongoose.isValidObjectId(id)
  );
  let citations = [];
  if (citationIds.length) {
    citations = await CodeCitation.find({
      _id: { $in: citationIds },
      isActive: true,
    })
      .select('state code title body source')
      .lean();

    const order = new Map(citationIds.map((id, index) => [String(id), index]));
    citations.sort(
      (a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0)
    );
  }

  return {
    templateId: templateDoc.id,
    templateName: templateDoc.name || '',
    summaryOfFindings,
    investigationProcess,
    damageDefinitions,
    existingConditions,
    legalFooter: templateDoc.legalFooter || '',
    citations: citations.map((row) => ({
      id: String(row._id),
      state: row.state || '',
      code: row.code || '',
      title: row.title || '',
      body: row.body || '',
      source: row.source || '',
    })),
  };
}

module.exports = {
  listTemplates,
  getTemplate,
  ensureDefaultTemplate,
  createTemplate,
  updateTemplate,
  getDefaultForCompany,
  getReportLanguagePackage,
  toTemplateResponse,
  EMPTY_LANGUAGE,
};
