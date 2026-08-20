'use strict';

const { Job, Report } = require('../models');
const { JOB_STATUSES, REPORT_STATUSES } = require('../models/enums');
const HttpError = require('../utils/httpError');
const { normalizeStatus } = require('../utils/jobStatus');
const userService = require('./user.service');

const COMPLETED_JOB_STATUSES = [JOB_STATUSES.COMPLETED];

const JOB_STATUS_LABELS = {
  draft: 'Draft',
  assigned: 'Assigned',
  in_progress: 'In progress',
  submitted: 'Submitted',
  reviewed: 'Reviewed',
  completed: 'Completed',
  rejected: 'Rejected',
  reopened: 'Reopened',
  on_hold: 'On hold',
  cancelled: 'Cancelled',
  archived: 'Archived',
};

function formatDurationHours(hours) {
  if (!hours || hours <= 0 || !Number.isFinite(hours)) return '—';
  const days = hours / 24;
  return days >= 1 ? `${days.toFixed(1)} days` : `${hours.toFixed(1)} hrs`;
}

function monthKey(date) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
  const [year, month] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

function lastNMonthKeys(n = 6) {
  const keys = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

async function getCompanyAnalytics(user) {
  if (!user.companyId) {
    throw new HttpError(400, 'Create a company first');
  }

  const companyId = user.companyId;
  const monthKeys = lastNMonthKeys(6);
  const rangeStart = new Date(`${monthKeys[0]}-01T00:00:00.000Z`);

  const [
    totalJobs,
    statusRows,
    completionSamples,
    createdInRange,
    completedInRange,
    reportsApproved,
    reportsRejected,
    reviewSamples,
    inspectors,
  ] = await Promise.all([
    Job.countDocuments({ companyId }),
    Job.aggregate([
      { $match: { companyId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Job.find({
      companyId,
      status: { $in: COMPLETED_JOB_STATUSES },
      startedAt: { $ne: null },
      completedAt: { $ne: null },
    })
      .select('startedAt completedAt')
      .limit(500)
      .lean(),
    Job.find({ companyId, createdAt: { $gte: rangeStart } })
      .select('createdAt')
      .lean(),
    Job.find({
      companyId,
      status: { $in: COMPLETED_JOB_STATUSES },
      completedAt: { $gte: rangeStart },
    })
      .select('completedAt')
      .lean(),
    Report.countDocuments({ companyId, status: REPORT_STATUSES.APPROVED }),
    Report.countDocuments({ companyId, status: REPORT_STATUSES.REJECTED }),
    Report.find({
      companyId,
      status: { $in: [REPORT_STATUSES.APPROVED, REPORT_STATUSES.REJECTED] },
      submittedAt: { $ne: null },
      reviewedAt: { $ne: null },
    })
      .select('submittedAt reviewedAt')
      .limit(500)
      .lean(),
    userService.listInspectors(user),
  ]);

  const byStatusMap = new Map();
  for (const row of statusRows) {
    const status = normalizeStatus(row._id);
    byStatusMap.set(status, (byStatusMap.get(status) || 0) + row.count);
  }
  const byStatus = [...byStatusMap.entries()]
    .map(([status, count]) => ({
      status,
      label: JOB_STATUS_LABELS[status] || status.replace(/_/g, ' '),
      count,
    }))
    .sort((a, b) => b.count - a.count);

  let avgCompletionHours = 0;
  if (completionSamples.length) {
    const totalHours = completionSamples.reduce((sum, job) => {
      const hours =
        (new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) / 3600000;
      return sum + (Number.isFinite(hours) && hours >= 0 ? hours : 0);
    }, 0);
    avgCompletionHours = totalHours / completionSamples.length;
  }

  const createdCounts = Object.fromEntries(monthKeys.map((key) => [key, 0]));
  for (const job of createdInRange) {
    const key = monthKey(job.createdAt);
    if (createdCounts[key] !== undefined) createdCounts[key] += 1;
  }
  const completedCounts = Object.fromEntries(monthKeys.map((key) => [key, 0]));
  for (const job of completedInRange) {
    const key = monthKey(job.completedAt);
    if (completedCounts[key] !== undefined) completedCounts[key] += 1;
  }

  const monthly = monthKeys.map((key) => ({
    month: monthLabel(key),
    monthKey: key,
    total: createdCounts[key] || 0,
    completed: completedCounts[key] || 0,
    inspections: completedCounts[key] || 0,
  }));

  let avgReviewHours = 0;
  if (reviewSamples.length) {
    const totalHours = reviewSamples.reduce((sum, report) => {
      const hours =
        (new Date(report.reviewedAt).getTime() - new Date(report.submittedAt).getTime()) /
        3600000;
      return sum + (Number.isFinite(hours) && hours >= 0 ? hours : 0);
    }, 0);
    avgReviewHours = totalHours / reviewSamples.length;
  }

  const inspectorRows = (inspectors || [])
    .map((inspector) => {
      const assigned = inspector.jobsAssigned || 0;
      const completed = inspector.jobsCompleted || 0;
      const reportsSubmitted = inspector.reportsSubmitted || 0;
      const completionRate = inspector.productivity?.completionRate ?? 0;
      return {
        id: inspector.id,
        name: inspector.name,
        assigned,
        completed,
        reportsSubmitted,
        completionRate,
        rankScore: completed * 1000 + reportsSubmitted * 10 + completionRate,
      };
    })
    .sort((a, b) => b.rankScore - a.rankScore)
    .map((row, index) => ({
      id: row.id,
      name: row.name,
      assigned: row.assigned,
      completed: row.completed,
      reportsSubmitted: row.reportsSubmitted,
      completionRate: row.completionRate,
      rank: index + 1,
    }));

  return {
    jobs: {
      total: totalJobs,
      byStatus,
      avgCompletionHours: Number(avgCompletionHours.toFixed(2)),
      avgCompletionLabel: formatDurationHours(avgCompletionHours),
      monthly,
    },
    inspectors: inspectorRows,
    reports: {
      approved: reportsApproved,
      rejected: reportsRejected,
      avgReviewHours: Number(avgReviewHours.toFixed(2)),
      avgReviewLabel: formatDurationHours(avgReviewHours),
    },
  };
}

module.exports = {
  getCompanyAnalytics,
};
