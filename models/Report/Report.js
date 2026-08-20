'use strict';

const mongoose = require('mongoose');
const { REPORT_STATUSES, REPORT_PDF_STATUSES } = require('../enums');
const brandingSchema = require('../common/branding.schema');
const storageFileSchema = require('../common/storageFile.schema');
const tenantScopedPlugin = require('../plugins/tenantScoped.plugin');
const auditFieldsPlugin = require('../plugins/auditFields.plugin');
const softDeletePlugin = require('../plugins/softDelete.plugin');

const { Schema } = mongoose;

/**
 * Inspector assessment report for a job.
 * Review workflow: draft → submitted → under_review → approved | rejected
 * (request changes returns to draft). PDF generation is tracked in pdfStatus.
 */
const reportSchema = new Schema(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    inspectionId: { type: Schema.Types.ObjectId, ref: 'Inspection', required: true, index: true },
    templateId: { type: Schema.Types.ObjectId, ref: 'ReportTemplate', default: null },
    generatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: Object.values(REPORT_STATUSES),
      default: REPORT_STATUSES.DRAFT,
      index: true,
    },
    pdfStatus: {
      type: String,
      enum: Object.values(REPORT_PDF_STATUSES),
      default: REPORT_PDF_STATUSES.QUEUED,
      index: true,
    },
    version: { type: Number, min: 1, default: 1 },
    title: { type: String, trim: true, maxlength: 200, default: 'Roof Assessment Report' },
    narrative: { type: String, trim: true, maxlength: 12000, default: '' },
    warnings: [{ type: String, trim: true, maxlength: 500 }],
    reviewNotes: { type: String, trim: true, maxlength: 4000, default: '' },
    rejectionReason: { type: String, trim: true, maxlength: 2000, default: '' },
    changesRequested: { type: String, trim: true, maxlength: 2000, default: '' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    pdf: { type: storageFileSchema, default: () => ({}) },
    pageCount: { type: Number, min: 0, default: 0 },
    errorMessage: { type: String, trim: true, maxlength: 1000, default: '' },
    brandingSnapshot: { type: brandingSchema, default: () => ({}) },
    templateSnapshot: { type: Schema.Types.Mixed, default: undefined },
    dataSnapshot: {
      customerName: { type: String, trim: true, default: '' },
      propertyAddress: { type: String, trim: true, default: '' },
      inspectorName: { type: String, trim: true, default: '' },
      dateOfLoss: { type: Date, default: null },
      inspectedAt: { type: Date, default: null },
      photoIds: [{ type: Schema.Types.ObjectId, ref: 'Photo' }],
      includedSectionKeys: [{ type: String }],
      notes: { type: String, trim: true, default: '' },
    },
    generatedAt: { type: Date, default: null },
    clientUuid: { type: String, trim: true },
  },
  { timestamps: true, collection: 'reports' }
);

reportSchema.plugin(tenantScopedPlugin);
reportSchema.plugin(auditFieldsPlugin);
reportSchema.plugin(softDeletePlugin);
reportSchema.plugin(require('../plugins/clientUuid.plugin'));

reportSchema.index({ companyId: 1, jobId: 1, version: -1 });
reportSchema.index({ companyId: 1, status: 1, createdAt: -1 });
reportSchema.index({ companyId: 1, createdAt: -1 });
reportSchema.index({ companyId: 1, clientUuid: 1 }, require('../plugins/clientUuid.plugin').clientUuidIndex());

module.exports = mongoose.models.Report || mongoose.model('Report', reportSchema);
