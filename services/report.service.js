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

const LEGACY_PDF = new Set(['queued', 'generating', 'ready', 'failed']);

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

function toReportResponse(report, extras = {}) {
  const status = normalizeReportStatus(report.status);
  const pdfStatus = normalizePdfStatus(report);
  return {
    id: String(report._id),
    jobId: String(report.jobId),
    inspectionId: report.inspectionId ? String(report.inspectionId) : null,
    status,
    pdfStatus,
    version: report.version,
    title: report.title,
    narrative: report.narrative || '',
    warnings: report.warnings || [],
    reviewNotes: report.reviewNotes || '',
    rejectionReason: report.rejectionReason || '',
    changesRequested: report.changesRequested || '',
    reviewedBy: report.reviewedBy ? String(report.reviewedBy) : null,
    reviewedAt: report.reviewedAt || null,
    submittedAt: report.submittedAt || null,
    pageCount: report.pageCount || 0,
    pdfUrl: report.pdf?.url || '',
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
    return toReportResponse(report, {
      jobNumber: job?.jobNumber || '',
      jobTitle: job?.title || '',
      jobStatus: job ? normalizeStatus(job.status) : null,
      claimNumber: job?.claim?.claimNumber || '',
      propertyAddress: job?.address?.formatted || job?.address?.line1 || report.dataSnapshot?.propertyAddress || '',
      inspectorName: report.dataSnapshot?.inspectorName || authorName,
      customerName: report.dataSnapshot?.customerName || '',
    });
  });
}

async function getReportById(actor, reportId) {
  const report = await findCompanyReport(actor, reportId);
  const job = await Job.findOne({ _id: report.jobId, companyId: actor.companyId })
    .populate('customerId', 'name email phone')
    .populate('assignedTo', 'email profile');
  return toReportResponse(report, {
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
  const token = crypto.randomBytes(16).toString('hex');

  report.pdfStatus = REPORT_PDF_STATUSES.READY;
  report.pageCount = 1;
  report.generatedAt = new Date();
  report.pdf = {
    bucket: 'local',
    key: `reports/${report._id}.pdf`,
    url: `/api/reports/${report._id}/pdf?token=${token}`,
    mimeType: 'application/pdf',
    sizeBytes: pdfBuffer.length,
    checksum: crypto.createHash('sha256').update(pdfBuffer).digest('hex'),
    originalFileName: `${job.jobNumber}-report.pdf`,
  };
  report.errorMessage = '';
  report.updatedBy = actor._id;
  report.templateSnapshot = {
    ...(report.templateSnapshot || {}),
    pdfToken: token,
    pdfBase64: pdfBuffer.toString('base64'),
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

  const base64 = report.templateSnapshot?.pdfBase64;
  if (!base64) {
    throw new HttpError(404, 'PDF not available');
  }

  return {
    buffer: Buffer.from(base64, 'base64'),
    fileName: report.pdf?.originalFileName || 'report.pdf',
  };
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

module.exports = {
  listReports,
  getReportById,
  getReportForJob,
  updateNarrative,
  generateReport,
  getPdfBuffer,
  shareEvidencePackage,
  shareReport,
  submitReport,
  startReview,
  approveReport,
  rejectReport,
  requestChanges,
  reviewPackage,
  toReportResponse,
  normalizeReportStatus,
};
