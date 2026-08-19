'use strict';

const mongoose = require('mongoose');
const { INSPECTION_STATUSES, CHECKLIST_STEP_TYPES } = require('../enums');
const tenantScopedPlugin = require('../plugins/tenantScoped.plugin');
const auditFieldsPlugin = require('../plugins/auditFields.plugin');
const softDeletePlugin = require('../plugins/softDelete.plugin');

const { Schema } = mongoose;

const checklistSnapshotStepSchema = new Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    type: { type: String, enum: Object.values(CHECKLIST_STEP_TYPES), required: true },
    required: { type: Boolean, default: false },
    options: [{ type: String, trim: true }],
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false }
);

const checklistResponseSchema = new Schema(
  {
    stepKey: { type: String, required: true, trim: true },
    value: { type: Schema.Types.Mixed, default: null },
    completedAt: { type: Date, default: null },
    skipped: { type: Boolean, default: false },
  },
  { _id: false }
);

/**
 * Field capture document for a job.
 * Heavy media and test-squares stay in child collections to stay under 16MB.
 * Checklist is snapshotted so later template edits do not rewrite history.
 */
const inspectionSchema = new Schema(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    inspectorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    checklistId: { type: Schema.Types.ObjectId, ref: 'Checklist', default: null },
    weatherVerificationId: { type: Schema.Types.ObjectId, ref: 'WeatherVerification', default: null },
    status: {
      type: String,
      enum: Object.values(INSPECTION_STATUSES),
      default: INSPECTION_STATUSES.NOT_STARTED,
      index: true,
    },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    summary: {
      overallNotes: { type: String, trim: true, maxlength: 8000, default: '' },
      recommendedAction: { type: String, trim: true, maxlength: 2000, default: '' },
      estimatedDamageSeverity: { type: String, trim: true, maxlength: 40, default: '' },
    },
    checklistSnapshot: {
      name: { type: String, trim: true, default: '' },
      version: { type: Number, default: 1 },
      steps: [checklistSnapshotStepSchema],
    },
    responses: [checklistResponseSchema],
    sync: {
      version: { type: Number, default: 1 },
      lastSyncedAt: { type: Date, default: null },
    },
    clientUuid: { type: String, trim: true },
  },
  { timestamps: true, collection: 'inspections' }
);

inspectionSchema.plugin(tenantScopedPlugin);
inspectionSchema.plugin(auditFieldsPlugin);
inspectionSchema.plugin(softDeletePlugin);
inspectionSchema.plugin(require('../plugins/clientUuid.plugin'));

inspectionSchema.index({ companyId: 1, jobId: 1 });
inspectionSchema.index({ companyId: 1, inspectorId: 1, createdAt: -1 });
inspectionSchema.index({ companyId: 1, clientUuid: 1 }, require('../plugins/clientUuid.plugin').clientUuidIndex());

module.exports = mongoose.models.Inspection || mongoose.model('Inspection', inspectionSchema);
