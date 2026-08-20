'use strict';

const { JOB_STATUSES } = require('../models/enums');
const HttpError = require('./httpError');

/** Legacy values still present in older documents → product workflow. */
const LEGACY_STATUS_MAP = Object.freeze({
  scheduled: JOB_STATUSES.ASSIGNED,
  pending_sync: JOB_STATUSES.IN_PROGRESS,
  accepted: JOB_STATUSES.ASSIGNED,
  review_required: JOB_STATUSES.SUBMITTED,
  report_generated: JOB_STATUSES.COMPLETED,
  archived: JOB_STATUSES.COMPLETED,
  cancelled: JOB_STATUSES.REJECTED,
});

const TERMINAL = new Set([JOB_STATUSES.COMPLETED, JOB_STATUSES.REJECTED]);

/**
 * Assigned → In Progress → Submitted → Reviewed → Complete
 * Optional: Rejected, Reopened, On Hold
 */
const TRANSITIONS = Object.freeze({
  [JOB_STATUSES.DRAFT]: [JOB_STATUSES.ASSIGNED, JOB_STATUSES.ON_HOLD],
  [JOB_STATUSES.ASSIGNED]: [
    JOB_STATUSES.IN_PROGRESS,
    JOB_STATUSES.ON_HOLD,
    JOB_STATUSES.REJECTED,
    JOB_STATUSES.DRAFT,
  ],
  [JOB_STATUSES.IN_PROGRESS]: [
    JOB_STATUSES.SUBMITTED,
    JOB_STATUSES.ON_HOLD,
    JOB_STATUSES.REJECTED,
  ],
  [JOB_STATUSES.SUBMITTED]: [
    JOB_STATUSES.REVIEWED,
    JOB_STATUSES.IN_PROGRESS,
    JOB_STATUSES.REJECTED,
  ],
  [JOB_STATUSES.REVIEWED]: [
    JOB_STATUSES.COMPLETED,
    JOB_STATUSES.REJECTED,
    JOB_STATUSES.IN_PROGRESS,
  ],
  [JOB_STATUSES.COMPLETED]: [JOB_STATUSES.REOPENED],
  [JOB_STATUSES.REJECTED]: [JOB_STATUSES.REOPENED],
  [JOB_STATUSES.REOPENED]: [
    JOB_STATUSES.ASSIGNED,
    JOB_STATUSES.IN_PROGRESS,
    JOB_STATUSES.ON_HOLD,
  ],
  [JOB_STATUSES.ON_HOLD]: [
    JOB_STATUSES.ASSIGNED,
    JOB_STATUSES.IN_PROGRESS,
    JOB_STATUSES.REJECTED,
  ],
});

function normalizeStatus(status) {
  if (!status) return JOB_STATUSES.DRAFT;
  return LEGACY_STATUS_MAP[status] || status;
}

function canCancel(status) {
  const current = normalizeStatus(status);
  return !TERMINAL.has(current);
}

function assertTransition(from, to) {
  const current = normalizeStatus(from);
  const next = normalizeStatus(to);

  if (current === next) {
    return current;
  }

  if (next === JOB_STATUSES.REJECTED) {
    if (!canCancel(current)) {
      throw new HttpError(400, `Cannot reject a job in status "${current}"`);
    }
    return next;
  }

  const allowed = TRANSITIONS[current] || [];
  if (!allowed.includes(next)) {
    throw new HttpError(400, `Invalid status transition from "${current}" to "${next}"`);
  }
  return next;
}

function applyStatusTimestamps(job, nextStatus) {
  const now = new Date();
  switch (nextStatus) {
    case JOB_STATUSES.IN_PROGRESS:
      job.startedAt = job.startedAt || now;
      break;
    case JOB_STATUSES.SUBMITTED:
      job.submittedAt = now;
      job.reviewRequiredAt = now;
      break;
    case JOB_STATUSES.REVIEWED:
      job.reviewedAt = now;
      break;
    case JOB_STATUSES.COMPLETED:
      job.completedAt = now;
      break;
    case JOB_STATUSES.REJECTED:
      job.cancelledAt = now;
      break;
    case JOB_STATUSES.REOPENED:
      job.completedAt = null;
      job.cancelledAt = null;
      break;
    default:
      break;
  }
  job.status = nextStatus;
  return job;
}

function statusAfterAssign(currentStatus) {
  const current = normalizeStatus(currentStatus);
  if (
    current === JOB_STATUSES.DRAFT
    || current === JOB_STATUSES.ASSIGNED
    || current === JOB_STATUSES.ON_HOLD
    || current === JOB_STATUSES.REOPENED
  ) {
    return JOB_STATUSES.ASSIGNED;
  }
  return current;
}

module.exports = {
  LEGACY_STATUS_MAP,
  TRANSITIONS,
  normalizeStatus,
  canCancel,
  assertTransition,
  applyStatusTimestamps,
  statusAfterAssign,
};
