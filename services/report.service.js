'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const {
  Job,
  Inspection,
  Report,
  ReportShare,
  Photo,
  Tenant,
  CodeCitation,
} = require('../models');
const {
  REPORT_STATUSES,
  REPORT_PDF_STATUSES,
  JOB_STATUSES,
  INSPECTION_STATUSES,
  SHARE_CHANNELS,
} = require('../models/enums');
const HttpError = require('../utils/httpError');
const { normalizeStatus, applyStatusTimestamps } = require('../utils/jobStatus');
const { buildSimplePdf } = require('../utils/simplePdf');
const jobService = require('./job.service');
const templateService = require('./template.service');
const { sendBrandedReportShare } = require('./email.service');
const pdfStorage = require('./pdf-storage.service');

const LEGACY_PDF = new Set(['queued', 'generating', 'ready', 'failed']);

const PDF_SOURCE = { INSPECTOR: 'inspector_mobile', SERVER: 'server_summary' };

/** True when the current PDF is the inspector's evidence package from the mobile app. */
function hasInspectorPdf(report) {
  return (
    report.pdfSource === PDF_SOURCE.INSPECTOR
    || report.templateSnapshot?.source === PDF_SOURCE.INSPECTOR
  );
}

/** Report snapshot without the legacy inline PDF bytes. */
function snapshotWithoutPdfBytes(snapshot) {
  const { pdfBase64: _dropped, ...rest } = snapshot || {};
  return rest;
}

/**
 * Store `buffer` as the report's current PDF (GridFS) and keep the previous one in
 * `pdfHistory` — PDFs are never overwritten or deleted. Legacy inline base64 PDFs are
 * moved into GridFS first so they survive too. Caller saves the report.
 */
async function storeReportPdf(report, buffer, { fileName, source, actorId }) {
  const legacyBase64 = report.templateSnapshot?.pdfBase64;
  let previous = null;

  if (pdfStorage.isGridFsFile(report.pdf)) {
    previous = report.pdf.toObject ? report.pdf.toObject() : { ...report.pdf };
  } else if (legacyBase64) {
    previous = await pdfStorage.savePdf(Buffer.from(legacyBase64, 'base64'), {
      fileName: report.pdf?.originalFileName || `report-${report._id}.pdf`,
      reportId: report._id,
      companyId: report.companyId,
      source: report.templateSnapshot?.source || report.pdfSource || '',
    });
  }

  if (previous) {
    report.pdfHistory = [
      ...(report.pdfHistory || []),
      {
        file: previous,
        source: report.pdfSource || report.templateSnapshot?.source || '',
        storedAt: report.pdfStoredAt || report.generatedAt || null,
        replacedAt: new Date(),
        replacedBy: actorId || null,
      },
    ];
  }

  const stored = await pdfStorage.savePdf(buffer, {
    fileName,
    reportId: report._id,
    companyId: report.companyId,
    source,
  });
  const token = crypto.randomBytes(16).toString('hex');

  report.pdf = { ...stored, url: `/api/reports/${report._id}/pdf?token=${token}` };
  report.pdfSource = source;
  report.pdfStoredAt = new Date();
  report.templateSnapshot = {
    ...snapshotWithoutPdfBytes(report.templateSnapshot),
    pdfToken: token,
    source,
  };
}

function normalizeReportStatus(status) {
  if (!status) return REPORT_STATUSES.DRAFT;
  if (LEGACY_PDF.has(status)) return REPORT_STATUSES.DRAFT;
  if (Object.values(REPORT_STATUSES).includes(status)) return status;
  return REPORT_STATUSES.DRAFT;
}

function normalizePdfStatus(report) {
  if (report.pdfStatus && Object.values(REPORT_PDF_STATUSES).includes(report.pdfStatus)) {
    return report.pdfStatus;
  }
  if (LEGACY_PDF.has(report.status)) return report.status;
  if (report.pdf?.url) return REPORT_PDF_STATUSES.READY;
  return REPORT_PDF_STATUSES.QUEUED;
}

/** Resolve ObjectId whether the field is raw or populated. */
function refId(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'object') {
    if (value._id != null) return String(value._id);
    if (value.id != null) return String(value.id);
    return '';
  }
  const asString = String(value);
  return asString === '[object Object]' ? '' : asString;
}

function toReportResponse(report, extras = {}) {
  const status = normalizeReportStatus(report.status);
  const pdfStatus = normalizePdfStatus(report);
  return {
    id: String(report._id),
    jobId: refId(report.jobId),
    inspectionId: report.inspectionId ? refId(report.inspectionId) : null,
    status,
    pdfStatus,
    version: report.version,
    title: report.title,
    narrative: report.narrative || '',
    warnings: report.warnings || [],
    reviewNotes: report.reviewNotes || '',
    rejectionReason: report.rejectionReason || '',
    changesRequested: report.changesRequested || '',
    reviewedBy: report.reviewedBy ? refId(report.reviewedBy) : null,
    reviewedAt: report.reviewedAt || null,
    submittedAt: report.submittedAt || null,
    pageCount: report.pageCount || 0,
    pdfUrl: report.pdf?.url || '',
    pdfSource: report.pdfSource || report.templateSnapshot?.source || '',
    /** Earlier PDFs kept for this report (resubmissions never overwrite). */
    pdfHistoryCount: (report.pdfHistory || []).length,
    generatedAt: report.generatedAt,
    dataSnapshot: report.dataSnapshot || {},
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    ...extras,
  };
}

async function ensureInspection(job, actor) {
  let inspection = await Inspection.findOne({
    jobId: job._id,
    companyId: actor.companyId,
  }).sort({ createdAt: -1 });

  if (!inspection) {
    if (!job.assignedTo) {
      throw new HttpError(400, 'Assign an inspector before creating a report');
    }
    inspection = await Inspection.create({
      companyId: actor.companyId,
      jobId: job._id,
      inspectorId: job.assignedTo,
      status: INSPECTION_STATUSES.COMPLETED,
      completedAt: new Date(),
      summary: {
        overallNotes: job.notes || '',
        recommendedAction: '',
        estimatedDamageSeverity: '',
      },
      createdBy: actor._id,
    });
  }

  return inspection;
}

async function getOrCreateLatestReport(actor, jobId) {
  if (!mongoose.isValidObjectId(jobId)) {
    throw new HttpError(400, 'Valid job id is required');
  }

  const job = await Job.findOne({ _id: jobId, companyId: actor.companyId });
  if (!job) {
    throw new HttpError(404, 'Job not found');
  }

  let report = await Report.findOne({ jobId: job._id, companyId: actor.companyId })
    .sort({ version: -1 });

  if (!report) {
    const inspection = await ensureInspection(job, actor);
    report = await Report.create({
      companyId: actor.companyId,
      jobId: job._id,
      inspectionId: inspection._id,
      generatedBy: actor._id,
      status: REPORT_STATUSES.DRAFT,
      pdfStatus: REPORT_PDF_STATUSES.QUEUED,
      version: 1,
      narrative: inspection.summary?.overallNotes || job.notes || '',
      warnings: [],
      createdBy: actor._id,
    });
  } else if (LEGACY_PDF.has(report.status)) {
    report.pdfStatus = report.status;
    report.status = REPORT_STATUSES.DRAFT;
    await report.save();
  }

  return { job, report };
}

async function findCompanyReport(actor, reportId) {
  if (!mongoose.isValidObjectId(reportId)) {
    throw new HttpError(400, 'Valid report id is required');
  }
  const report = await Report.findOne({ _id: reportId, companyId: actor.companyId });
  if (!report) {
    throw new HttpError(404, 'Report not found');
  }
  if (LEGACY_PDF.has(report.status)) {
    report.pdfStatus = report.status;
    report.status = REPORT_STATUSES.DRAFT;
    await report.save();
  }
  return report;
}

async function listReports(actor, query = {}) {
  const filter = { companyId: actor.companyId };
  // Company admin review queue: only inspector-submitted (and later) reports.
  // Drafts are in-progress inspector work and must not appear for approve/reject.
  const reviewStatuses = [
    REPORT_STATUSES.SUBMITTED,
    REPORT_STATUSES.UNDER_REVIEW,
    REPORT_STATUSES.APPROVED,
    REPORT_STATUSES.REJECTED,
  ];
  if (query.status) {
    if (!reviewStatuses.includes(query.status)) {
      return [];
    }
    filter.status = query.status;
  } else {
    filter.status = { $in: reviewStatuses };
  }

  const reports = await Report.find(filter)
    .sort({ updatedAt: -1 })
    .populate('jobId', 'jobNumber title status assignedTo address claim')
    .populate('generatedBy', 'email profile')
    .populate('reviewedBy', 'email profile')
    .limit(200);

  return reports.map((report) => {
    const job = report.jobId && typeof report.jobId === 'object' ? report.jobId : null;
    const author = report.generatedBy && typeof report.generatedBy === 'object' ? report.generatedBy : null;
    const authorName = author
      ? `${author.profile?.firstName || ''} ${author.profile?.lastName || ''}`.trim() || author.email
      : '—';
    const assignedId = job?.assignedTo
      ? refId(job.assignedTo)
      : author
        ? refId(author)
        : null;
    return toReportResponse(report, {
      jobNumber: job?.jobNumber || '',
      jobTitle: job?.title || '',
      jobStatus: job ? normalizeStatus(job.status) : null,
      claimNumber: job?.claim?.claimNumber || '',
      propertyAddress: job?.address?.formatted || job?.address?.line1 || report.dataSnapshot?.propertyAddress || '',
      inspectorName: report.dataSnapshot?.inspectorName || authorName,
      inspectorId: assignedId || null,
      customerName: report.dataSnapshot?.customerName || '',
    });
  });
}

function listExtrasForReport(report, job) {
  const assigned = job?.assignedTo && typeof job.assignedTo === 'object' ? job.assignedTo : null;
  const assignedId = job?.assignedTo ? refId(job.assignedTo) : null;
  const authorName = assigned
    ? `${assigned.profile?.firstName || ''} ${assigned.profile?.lastName || ''}`.trim() || assigned.email
    : '';
  const customer = job?.customerId && typeof job.customerId === 'object' ? job.customerId : null;
  return {
    jobNumber: job?.jobNumber || '',
    jobTitle: job?.title || '',
    jobStatus: job ? normalizeStatus(job.status) : null,
    claimNumber: job?.claim?.claimNumber || '',
    propertyAddress:
      job?.address?.formatted
      || job?.address?.line1
      || report.dataSnapshot?.propertyAddress
      || '',
    inspectorName: report.dataSnapshot?.inspectorName || authorName || '—',
    inspectorId: assignedId || null,
    customerName: report.dataSnapshot?.customerName || customer?.name || '',
  };
}

async function getReportById(actor, reportId) {
  const report = await findCompanyReport(actor, reportId);
  const job = await Job.findOne({ _id: report.jobId, companyId: actor.companyId })
    .populate('customerId', 'name email phone')
    .populate('assignedTo', 'email profile');
  return toReportResponse(report, {
    ...listExtrasForReport(report, job),
    job: job ? jobService.toJobResponse(job) : null,
  });
}

async function getReportForJob(actor, jobId) {
  const { report } = await getOrCreateLatestReport(actor, jobId);
  return toReportResponse(report);
}

async function updateNarrative(actor, jobId, narrative) {
  const { report } = await getOrCreateLatestReport(actor, jobId);
  const status = normalizeReportStatus(report.status);
  if ([REPORT_STATUSES.APPROVED, REPORT_STATUSES.REJECTED].includes(status)) {
    throw new HttpError(400, 'Cannot edit an approved or rejected report');
  }
  report.narrative = narrative || '';
  report.updatedBy = actor._id;
  await report.save();
  return toReportResponse(report);
}

async function generateReport(actor, jobId, options = {}) {
  const { job, report } = await getOrCreateLatestReport(actor, jobId);
  // The inspector's package is the evidence of record; a server summary must never replace
  // it (or the captured data snapshot below). Checked before anything is modified.
  if (hasInspectorPdf(report)) {
    throw new HttpError(
      409,
      "This report already has the inspector's evidence package PDF. Generating a summary PDF would replace it."
    );
  }
  const inspection = await ensureInspection(job, actor);
  const populated = await job.populate([
    { path: 'customerId', select: 'name email phone' },
    { path: 'assignedTo', select: 'email profile' },
  ]);

  const company = await Tenant.findById(actor.companyId).select('name branding contact');
  const photos = await Photo.find({
    jobId: job._id,
    companyId: actor.companyId,
    includeInReport: true,
  }).limit(200);

  if (options.narrative !== undefined) {
    report.narrative = options.narrative;
  }

  const inspectorName = populated.assignedTo
    ? `${populated.assignedTo.profile?.firstName || ''} ${populated.assignedTo.profile?.lastName || ''}`.trim()
      || populated.assignedTo.email
    : 'Unassigned';

  const addressLine = job.address?.formatted
    || [job.address?.line1, job.address?.city, job.address?.state, job.address?.postalCode]
      .filter(Boolean)
      .join(', ');

  const brand = company?.branding || {};
  const displayName = brand.companyDisplayName || company?.name || 'Company';
  const contact = company?.contact || {};
  const contactAddress = contact.address || {};
  const contactLine = [
    contact.phone,
    contact.email,
    contact.website,
    [contactAddress.line1, contactAddress.city, contactAddress.state, contactAddress.postalCode]
      .filter(Boolean)
      .join(', '),
  ].filter(Boolean).join(' · ');
  const footerText = brand.footerText || brand.letterheadNote || '';

  const templateDoc = await templateService.getDefaultForCompany(actor.companyId);
  const template = templateDoc ? templateService.toTemplateResponse(templateDoc) : null;
  const includedSections = (template?.sections || []).filter((section) => section.include);
  let citations = [];
  if (template?.codeCitationIds?.length) {
    citations = await CodeCitation.find({
      _id: { $in: template.codeCitationIds },
      isActive: true,
    }).select('state code title body source');
  }
  const language = template?.defaultLanguage || {};
  const languageLines = [
    ['Roof damage', language.roof_damage],
    ['Hail damage', language.hail_damage],
    ['Wind damage', language.wind_damage],
    ['Missing shingles', language.missing_shingles],
    ['Interior damage', language.interior_damage],
  ].filter(([, text]) => Boolean(text && String(text).trim()));

  const warnings = [];
  if (!job.claim?.claimNumber) warnings.push('Claim number is missing');
  if (!job.claim?.dateOfLoss) warnings.push('Date of loss is missing');
  if (!photos.length) warnings.push('No photos included in evidence package');
  if (!report.narrative) warnings.push('Report narrative is empty');

  report.pdfStatus = REPORT_PDF_STATUSES.GENERATING;
  report.warnings = warnings;
  if (templateDoc) {
    report.templateId = templateDoc._id;
  }
  report.dataSnapshot = {
    customerName: populated.customerId?.name || '',
    propertyAddress: addressLine,
    inspectorName,
    dateOfLoss: job.claim?.dateOfLoss || null,
    inspectedAt: inspection.completedAt || inspection.submittedAt || new Date(),
    photoIds: photos.map((photo) => photo._id),
    includedSectionKeys: includedSections.map((section) => section.key),
    notes: job.notes || '',
  };
  report.brandingSnapshot = {
    logoUrl: brand.logoUrl || '',
    primaryColor: brand.primaryColor || '#1B4F72',
    secondaryColor: brand.secondaryColor || '#F4D03F',
    accentColor: brand.accentColor || '#FFFFFF',
    companyDisplayName: displayName,
    tagline: brand.tagline || '',
    footerText,
    letterheadNote: footerText,
  };
  report.generatedBy = actor._id;
  await report.save();

  const pdfLines = [
    displayName,
    brand.tagline || 'Roof Assessment Report',
    '',
    `Company: ${displayName}`,
    brand.logoUrl ? 'Logo: on file' : 'Logo: not uploaded',
    `Job: ${job.jobNumber}`,
    `Customer: ${report.dataSnapshot.customerName}`,
    `Property: ${addressLine}`,
    `Inspector: ${inspectorName}`,
    `Claim #: ${job.claim?.claimNumber || '—'}`,
    `Policy #: ${job.claim?.policyNumber || '—'}`,
    `Date of loss: ${job.claim?.dateOfLoss ? new Date(job.claim.dateOfLoss).toISOString().slice(0, 10) : '—'}`,
    contactLine ? `Contact: ${contactLine}` : '',
    '',
    'Narrative',
    report.narrative || 'No narrative provided.',
  ];

  for (const section of includedSections) {
    pdfLines.push('', section.title);
    if (section.body) pdfLines.push(section.body);
  }

  if (languageLines.length) {
    pdfLines.push('', 'Standard damage language');
    for (const [label, text] of languageLines) {
      pdfLines.push(`${label}: ${text}`);
    }
  }

  if (citations.length) {
    pdfLines.push('', 'Code citations');
    for (const citation of citations) {
      pdfLines.push(
        `${citation.state} ${citation.code} — ${citation.title}`,
        citation.body || ''
      );
    }
  }

  if (template?.legalFooter) {
    pdfLines.push('', 'Disclaimer', template.legalFooter);
  }

  pdfLines.push(
    '',
    `Photos included: ${photos.length}`,
    ...warnings.map((warning) => `Warning: ${warning}`)
  );

  const pdfBuffer = buildSimplePdf(
    pdfLines.filter((line) => line !== ''),
    {
      primaryColor: brand.primaryColor || '#1B4F72',
      footerLines: [
        footerText || `${displayName} confidential report`,
        contactLine,
      ].filter(Boolean),
    }
  );
  await storeReportPdf(report, pdfBuffer, {
    fileName: `${job.jobNumber}-report.pdf`,
    source: PDF_SOURCE.SERVER,
    actorId: actor._id,
  });

  report.pdfStatus = REPORT_PDF_STATUSES.READY;
  report.pageCount = 1;
  report.generatedAt = new Date();
  report.errorMessage = '';
  report.updatedBy = actor._id;
  report.templateSnapshot = {
    ...report.templateSnapshot,
    templateId: template?.id || null,
    templateName: template?.name || '',
    legalFooter: template?.legalFooter || '',
    defaultLanguage: language,
    sectionKeys: includedSections.map((section) => section.key),
  };
  await report.save();

  return toReportResponse(report, {
    job: jobService.toJobResponse(job),
  });
}

async function getPdfBuffer(reportId, token) {
  if (!mongoose.isValidObjectId(reportId)) {
    throw new HttpError(400, 'Invalid report id');
  }

  const report = await Report.findById(reportId);
  if (!report) {
    throw new HttpError(404, 'Report not found');
  }

  const expected = report.templateSnapshot?.pdfToken;
  if (!expected || expected !== token) {
    throw new HttpError(403, 'Invalid download token');
  }

  const fileName = report.pdf?.originalFileName || 'report.pdf';

  if (pdfStorage.isGridFsFile(report.pdf)) {
    try {
      return { buffer: await pdfStorage.readPdf(report.pdf.key), fileName };
    } catch {
      throw new HttpError(404, 'PDF not available');
    }
  }

  // Reports stored before GridFS keep their bytes inline until migrated.
  const base64 = report.templateSnapshot?.pdfBase64;
  if (!base64) {
    throw new HttpError(404, 'PDF not available');
  }

  return { buffer: Buffer.from(base64, 'base64'), fileName };
}

/**
 * Every PDF this report has held, oldest first: the entries in pdfHistory, then the
 * current one. Version numbers are 1-based and stable (history is append-only).
 */
function pdfVersionsOf(report) {
  const history = (report.pdfHistory || []).map((entry, index) => ({
    version: index + 1,
    isCurrent: false,
    file: entry.file || {},
    source: entry.source || '',
    storedAt: entry.storedAt || null,
    replacedAt: entry.replacedAt || null,
  }));

  const hasCurrent =
    pdfStorage.isGridFsFile(report.pdf) || Boolean(report.templateSnapshot?.pdfBase64);
  if (hasCurrent) {
    history.push({
      version: history.length + 1,
      isCurrent: true,
      file: report.pdf || {},
      source: report.pdfSource || report.templateSnapshot?.source || '',
      storedAt: report.pdfStoredAt || report.generatedAt || null,
      replacedAt: null,
    });
  }
  return history;
}

async function listPdfVersions(actor, reportId) {
  const report = await findCompanyReport(actor, reportId);
  const versions = pdfVersionsOf(report)
    .map((entry) => ({
      version: entry.version,
      isCurrent: entry.isCurrent,
      source: entry.source,
      fileName: entry.file.originalFileName || `report-v${entry.version}.pdf`,
      sizeBytes: entry.file.sizeBytes || 0,
      checksum: entry.file.checksum || '',
      storedAt: entry.storedAt,
      replacedAt: entry.replacedAt,
    }))
    .reverse(); // newest first for display

  // Same job details as the report list/detail (customer, inspector, claim, job number).
  const job = await Job.findOne({ _id: report.jobId, companyId: actor.companyId })
    .populate('customerId', 'name email phone')
    .populate('assignedTo', 'email profile');
  return { report: toReportResponse(report, listExtrasForReport(report, job)), versions };
}

/** Bytes for one PDF version of a company report (authenticated; no share token needed). */
async function getPdfVersionBuffer(actor, reportId, versionParam) {
  const report = await findCompanyReport(actor, reportId);
  const version = Number.parseInt(versionParam, 10);
  const entry = pdfVersionsOf(report).find((item) => item.version === version);
  if (!entry) {
    throw new HttpError(404, 'PDF version not found');
  }

  const fileName = entry.file.originalFileName || `report-v${entry.version}.pdf`;
  if (pdfStorage.isGridFsFile(entry.file)) {
    try {
      return { buffer: await pdfStorage.readPdf(entry.file.key), fileName };
    } catch {
      throw new HttpError(404, 'PDF file is missing from storage');
    }
  }
  // Current PDF that has not been migrated off inline storage yet.
  if (entry.isCurrent && report.templateSnapshot?.pdfBase64) {
    return { buffer: Buffer.from(report.templateSnapshot.pdfBase64, 'base64'), fileName };
  }
  throw new HttpError(404, 'PDF file is missing from storage');
}

async function shareEvidencePackage(actor, jobId, payload = {}) {
  const { job, report } = await getOrCreateLatestReport(actor, jobId);

  if (normalizePdfStatus(report) !== REPORT_PDF_STATUSES.READY) {
    await generateReport(actor, jobId);
  }

  const refreshed = await Report.findById(report._id);
  return createShare(actor, refreshed, job, payload);
}

async function shareReport(actor, reportId, payload = {}) {
  const report = await findCompanyReport(actor, reportId);
  const job = await Job.findOne({ _id: report.jobId, companyId: actor.companyId });
  if (!job) throw new HttpError(404, 'Job not found');

  if (normalizePdfStatus(report) !== REPORT_PDF_STATUSES.READY) {
    await generateReport(actor, String(job._id));
  }
  const refreshed = await Report.findById(report._id);
  return createShare(actor, refreshed, job, payload);
}

async function createShare(actor, report, job, payload = {}) {
  const channel = payload.channel && Object.values(SHARE_CHANNELS).includes(payload.channel)
    ? payload.channel
    : SHARE_CHANNELS.LINK;
  const rawToken = crypto.randomBytes(24).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = payload.expiresInDays
    ? new Date(Date.now() + Number(payload.expiresInDays) * 24 * 60 * 60 * 1000)
    : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const share = await ReportShare.create({
    companyId: actor.companyId,
    reportId: report._id,
    jobId: job._id,
    channel,
    recipient: payload.recipient || '',
    tokenHash,
    allowDownload: payload.allowDownload !== false,
    expiresAt,
    createdBy: actor._id,
  });

  const company = await Tenant.findById(actor.companyId).select('name branding contact');
  let emailSent = false;
  if (payload.recipient && (channel === SHARE_CHANNELS.EMAIL || payload.sendEmail)) {
    const mail = await sendBrandedReportShare({
      to: payload.recipient,
      recipientName: payload.recipientName || '',
      company,
      reportTitle: report.title,
      jobNumber: job.jobNumber,
      pdfUrl: report.pdf?.url || '',
      shareUrl: `/share/evidence/${rawToken}`,
    });
    emailSent = Boolean(mail.sent);
  }

  return {
    share: {
      id: String(share._id),
      channel: share.channel,
      recipient: share.recipient,
      expiresAt: share.expiresAt,
      allowDownload: share.allowDownload,
      url: report.pdf?.url || `/share/evidence/${rawToken}`,
      token: rawToken,
      pdfUrl: report.pdf?.url || '',
      emailSent,
    },
    report: toReportResponse(report),
  };
}

async function transitionReport(actor, reportId, nextStatus, payload = {}) {
  const report = await findCompanyReport(actor, reportId);
  const current = normalizeReportStatus(report.status);
  const allowed = {
    [REPORT_STATUSES.DRAFT]: [REPORT_STATUSES.SUBMITTED],
    [REPORT_STATUSES.SUBMITTED]: [REPORT_STATUSES.UNDER_REVIEW, REPORT_STATUSES.DRAFT],
    [REPORT_STATUSES.UNDER_REVIEW]: [
      REPORT_STATUSES.APPROVED,
      REPORT_STATUSES.REJECTED,
      REPORT_STATUSES.DRAFT,
    ],
    [REPORT_STATUSES.APPROVED]: [],
    [REPORT_STATUSES.REJECTED]: [REPORT_STATUSES.DRAFT],
  };

  if (!(allowed[current] || []).includes(nextStatus)) {
    throw new HttpError(400, `Cannot move report from "${current}" to "${nextStatus}"`);
  }

  const now = new Date();
  report.status = nextStatus;
  report.updatedBy = actor._id;

  if (nextStatus === REPORT_STATUSES.SUBMITTED) {
    report.submittedAt = now;
    report.changesRequested = '';
  }
  if (nextStatus === REPORT_STATUSES.UNDER_REVIEW) {
    report.reviewedBy = actor._id;
  }
  if (nextStatus === REPORT_STATUSES.APPROVED) {
    report.reviewedBy = actor._id;
    report.reviewedAt = now;
    report.reviewNotes = payload.notes || report.reviewNotes || '';
    report.rejectionReason = '';
    report.changesRequested = '';
  }
  if (nextStatus === REPORT_STATUSES.REJECTED) {
    report.reviewedBy = actor._id;
    report.reviewedAt = now;
    report.rejectionReason = payload.reason || payload.notes || 'Rejected';
  }
  if (nextStatus === REPORT_STATUSES.DRAFT && current === REPORT_STATUSES.UNDER_REVIEW) {
    report.changesRequested = payload.notes || payload.reason || 'Changes requested';
    report.reviewedBy = actor._id;
    report.reviewedAt = now;
  }

  await report.save();

  const job = await Job.findOne({ _id: report.jobId, companyId: actor.companyId });
  if (job) {
    const jobStatus = normalizeStatus(job.status);
    if (nextStatus === REPORT_STATUSES.SUBMITTED && jobStatus === JOB_STATUSES.IN_PROGRESS) {
      applyStatusTimestamps(job, JOB_STATUSES.SUBMITTED);
      job.updatedBy = actor._id;
      await job.save();
    }
    if (nextStatus === REPORT_STATUSES.UNDER_REVIEW && jobStatus === JOB_STATUSES.SUBMITTED) {
      // stay on submitted / move toward reviewed later
    }
    if (nextStatus === REPORT_STATUSES.APPROVED) {
      try {
        if ([JOB_STATUSES.SUBMITTED, JOB_STATUSES.IN_PROGRESS].includes(jobStatus)) {
          applyStatusTimestamps(job, JOB_STATUSES.REVIEWED);
        }
        applyStatusTimestamps(job, JOB_STATUSES.COMPLETED);
        job.updatedBy = actor._id;
        await job.save();
      } catch {
        // Job may already be completed; report approval still succeeds.
      }
    }
    if (nextStatus === REPORT_STATUSES.REJECTED) {
      applyStatusTimestamps(job, JOB_STATUSES.REJECTED);
      job.updatedBy = actor._id;
      await job.save();
    }
  }

  return toReportResponse(report);
}

async function submitReport(actor, reportId) {
  return transitionReport(actor, reportId, REPORT_STATUSES.SUBMITTED);
}

async function startReview(actor, reportId) {
  return transitionReport(actor, reportId, REPORT_STATUSES.UNDER_REVIEW);
}

async function approveReport(actor, reportId, payload = {}) {
  const report = await findCompanyReport(actor, reportId);
  const current = normalizeReportStatus(report.status);
  if (current === REPORT_STATUSES.SUBMITTED) {
    await transitionReport(actor, reportId, REPORT_STATUSES.UNDER_REVIEW);
  }
  return transitionReport(actor, reportId, REPORT_STATUSES.APPROVED, payload);
}

async function rejectReport(actor, reportId, payload = {}) {
  const report = await findCompanyReport(actor, reportId);
  const current = normalizeReportStatus(report.status);
  if (current === REPORT_STATUSES.SUBMITTED) {
    await transitionReport(actor, reportId, REPORT_STATUSES.UNDER_REVIEW);
  }
  return transitionReport(actor, reportId, REPORT_STATUSES.REJECTED, payload);
}

async function requestChanges(actor, reportId, payload = {}) {
  const report = await findCompanyReport(actor, reportId);
  const current = normalizeReportStatus(report.status);
  if (current === REPORT_STATUSES.SUBMITTED) {
    await transitionReport(actor, reportId, REPORT_STATUSES.UNDER_REVIEW);
  }
  return transitionReport(actor, reportId, REPORT_STATUSES.DRAFT, payload);
}

async function reviewPackage(actor, jobId) {
  const detail = await jobService.getJob(actor, jobId);
  const report = await getReportForJob(actor, jobId);
  if (report.status === REPORT_STATUSES.SUBMITTED) {
    const updated = await startReview(actor, report.id);
    return {
      job: detail,
      report: updated,
      monitoring: detail.progress,
    };
  }
  return {
    job: detail,
    report,
    monitoring: detail.progress,
  };
}

/**
 * Why the inspector may not send (another) package right now, or '' when they may.
 * Allowed: never sent (no report / draft), changes requested (back to draft), rejected.
 * Blocked: waiting for the admin (submitted / under review) or already approved.
 */
function submissionBlockedReason(reportStatus) {
  if (reportStatus === REPORT_STATUSES.SUBMITTED || reportStatus === REPORT_STATUSES.UNDER_REVIEW) {
    return 'This evidence package was already sent and is waiting for admin review. You can send again only if the admin rejects it or requests changes.';
  }
  if (reportStatus === REPORT_STATUSES.APPROVED) {
    return 'This evidence package was already approved by the admin.';
  }
  return '';
}

/**
 * Inspector mobile "Send to Admin": attach field PDF + capture payload,
 * mark report submitted, and move the job into the admin review queue.
 */
async function submitInspectorEvidencePackage(inspector, jobId, body = {}) {
  if (!mongoose.isValidObjectId(jobId)) {
    throw new HttpError(400, 'Valid job id is required');
  }

  const job = await Job.findOne({
    _id: jobId,
    companyId: inspector.companyId,
    assignedTo: inspector._id,
  });
  if (!job) {
    throw new HttpError(404, 'Job not found');
  }

  // One package per review round: send once, then again only after the admin rejects it
  // or requests changes. Checked before anything is modified.
  const latest = await Report.findOne({ jobId: job._id, companyId: inspector.companyId })
    .sort({ version: -1 })
    .select('status');
  const blockedReason = submissionBlockedReason(latest ? normalizeReportStatus(latest.status) : null);
  if (blockedReason) {
    throw new HttpError(409, blockedReason);
  }

  const inspection = await ensureInspection(job, inspector);
  const now = new Date();
  const overallNotes = body.summary?.overallNotes || body.narrative || inspection.summary?.overallNotes || '';

  inspection.status = INSPECTION_STATUSES.SUBMITTED;
  inspection.completedAt = inspection.completedAt || now;
  inspection.submittedAt = now;
  inspection.summary = {
    ...(inspection.summary || {}),
    overallNotes: String(overallNotes || '').slice(0, 8000),
  };
  inspection.updatedBy = inspector._id;
  if (body.clientUuid) {
    inspection.clientUuid = String(body.clientUuid).slice(0, 120);
  }
  await inspection.save();

  let report = await Report.findOne({ jobId: job._id, companyId: inspector.companyId })
    .sort({ version: -1 });

  const previousStatus = report ? normalizeReportStatus(report.status) : null;
  const alreadySubmitted = [
    REPORT_STATUSES.SUBMITTED,
    REPORT_STATUSES.UNDER_REVIEW,
    REPORT_STATUSES.APPROVED,
  ].includes(previousStatus);

  if (!report) {
    report = await Report.create({
      companyId: inspector.companyId,
      jobId: job._id,
      inspectionId: inspection._id,
      generatedBy: inspector._id,
      status: REPORT_STATUSES.DRAFT,
      pdfStatus: REPORT_PDF_STATUSES.QUEUED,
      version: 1,
      narrative: '',
      warnings: [],
      createdBy: inspector._id,
    });
  } else if (LEGACY_PDF.has(report.status)) {
    report.pdfStatus = report.status;
    report.status = REPORT_STATUSES.DRAFT;
  }

  if (previousStatus === REPORT_STATUSES.REJECTED) {
    report.status = REPORT_STATUSES.DRAFT;
    report.rejectionReason = '';
  }

  const populated = await Job.findById(job._id)
    .populate('customerId', 'name email phone')
    .populate('assignedTo', 'email profile');

  const inspectorName = `${inspector.profile?.firstName || ''} ${inspector.profile?.lastName || ''}`.trim()
    || inspector.email
    || 'Inspector';
  const addressLine = job.address?.formatted
    || [job.address?.line1, job.address?.city, job.address?.state, job.address?.postalCode]
      .filter(Boolean)
      .join(', ');
  const customerName = populated?.customerId?.name
    || body.capture?.homeownerName
    || '';

  const photos = await Photo.find({
    jobId: job._id,
    companyId: inspector.companyId,
  }).sort({ sortOrder: 1, createdAt: 1 }).limit(200);

  const narrative = String(body.narrative || overallNotes || report.narrative || '').slice(0, 12000);
  report.narrative = narrative;
  report.title = body.title || report.title || 'Roof Assessment Report';
  report.inspectionId = inspection._id;
  report.generatedBy = inspector._id;
  report.updatedBy = inspector._id;
  report.warnings = photos.length ? [] : ['No photos included in evidence package'];
  report.dataSnapshot = {
    ...(report.dataSnapshot || {}),
    customerName,
    propertyAddress: body.capture?.address || addressLine,
    inspectorName,
    dateOfLoss: job.claim?.dateOfLoss || null,
    inspectedAt: inspection.completedAt || now,
    photoIds: photos.map((photo) => photo._id),
    includedSectionKeys: body.capture?.completedSteps || report.dataSnapshot?.includedSectionKeys || [],
    notes: overallNotes,
    capture: body.capture || null,
  };

  const pdfBase64Raw = body.pdfBase64 ? String(body.pdfBase64).trim() : '';
  if (pdfBase64Raw) {
    const cleaned = pdfBase64Raw.replace(/^data:application\/pdf;base64,/i, '');
    let pdfBuffer;
    try {
      pdfBuffer = Buffer.from(cleaned, 'base64');
    } catch {
      throw new HttpError(400, 'Invalid PDF data');
    }
    if (!pdfBuffer.length) {
      throw new HttpError(400, 'PDF data is empty');
    }

    if (pdfBuffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new HttpError(400, 'Attached file is not a PDF');
    }

    const fileName = body.pdfFileName || `RoofCheck_${job.jobNumber || job._id}.pdf`;
    // A resubmission keeps the earlier package in pdfHistory instead of overwriting it.
    await storeReportPdf(report, pdfBuffer, {
      fileName,
      source: PDF_SOURCE.INSPECTOR,
      actorId: inspector._id,
    });
    report.pdfStatus = REPORT_PDF_STATUSES.READY;
    report.pageCount = report.pageCount || 1;
    report.generatedAt = now;
    report.errorMessage = '';
  } else if (normalizePdfStatus(report) !== REPORT_PDF_STATUSES.READY) {
    report.warnings = [...(report.warnings || []), 'Inspector submitted without an attached PDF'];
  }

  const currentReportStatus = normalizeReportStatus(report.status);
  if (currentReportStatus === REPORT_STATUSES.APPROVED) {
    // Keep approved reports intact; only refresh PDF/narrative above.
  } else if (
    currentReportStatus === REPORT_STATUSES.DRAFT
    || currentReportStatus === REPORT_STATUSES.REJECTED
  ) {
    report.status = REPORT_STATUSES.SUBMITTED;
    report.submittedAt = now;
    report.changesRequested = '';
    report.rejectionReason = '';
  } else if (currentReportStatus === REPORT_STATUSES.UNDER_REVIEW) {
    // Stay under review; package refresh for the admin.
    report.submittedAt = report.submittedAt || now;
  } else {
    report.status = REPORT_STATUSES.SUBMITTED;
    report.submittedAt = report.submittedAt || now;
  }

  await report.save();

  const jobStatus = normalizeStatus(job.status);
  if (jobStatus === JOB_STATUSES.REJECTED) {
    applyStatusTimestamps(job, JOB_STATUSES.REOPENED);
    applyStatusTimestamps(job, JOB_STATUSES.IN_PROGRESS);
  }
  if (
    [JOB_STATUSES.ASSIGNED, JOB_STATUSES.REOPENED].includes(normalizeStatus(job.status))
  ) {
    applyStatusTimestamps(job, JOB_STATUSES.IN_PROGRESS);
  }
  if (normalizeStatus(job.status) === JOB_STATUSES.IN_PROGRESS) {
    applyStatusTimestamps(job, JOB_STATUSES.SUBMITTED);
  }
  job.updatedBy = inspector._id;
  await job.save();

  const refreshedJob = await jobService.getJob(inspector, String(job._id));
  return {
    job: refreshedJob,
    report: toReportResponse(report, listExtrasForReport(report, populated)),
    alreadySubmitted,
    photosUploaded: photos.length,
  };
}

module.exports = {
  listReports,
  getReportById,
  getReportForJob,
  updateNarrative,
  generateReport,
  getPdfBuffer,
  listPdfVersions,
  getPdfVersionBuffer,
  shareEvidencePackage,
  shareReport,
  submitReport,
  startReview,
  approveReport,
  rejectReport,
  requestChanges,
  reviewPackage,
  submitInspectorEvidencePackage,
  toReportResponse,
  normalizeReportStatus,
  // Exposed for tests.
  submissionBlockedReason,
  storeReportPdf,
  hasInspectorPdf,
  PDF_SOURCE,
};
