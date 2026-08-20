'use strict';

const { Job, Report, User, Tenant } = require('../models');
const { JOB_STATUSES, USER_ROLES, USER_STATUSES } = require('../models/enums');
const HttpError = require('../utils/httpError');

const ACTIVE_JOB_STATUSES = [
  JOB_STATUSES.ASSIGNED,
  JOB_STATUSES.IN_PROGRESS,
  JOB_STATUSES.REOPENED,
];

const COMPLETED_JOB_STATUSES = [
  JOB_STATUSES.COMPLETED,
];

function formatRelativeTime(date) {
  if (!date) return '';
  const ms = Date.now() - new Date(date).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

function actorName(user) {
  if (!user) return 'Team';
  const name = `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim();
  return name || user.email || 'Team';
}

async function getCompanyDashboard(user) {
  if (!user.companyId) {
    throw new HttpError(400, 'Create a company first');
  }

  const companyId = user.companyId;
  const company = await Tenant.findById(companyId).select('name');

  const [
    totalJobs,
    activeJobs,
    completedJobs,
    pendingReviews,
    totalInspectors,
    activeInspectors,
    reportsSubmitted,
    reportsApproved,
    completionSamples,
    recentJobs,
  ] = await Promise.all([
    Job.countDocuments({ companyId }),
    Job.countDocuments({ companyId, status: { $in: ACTIVE_JOB_STATUSES } }),
    Job.countDocuments({ companyId, status: { $in: COMPLETED_JOB_STATUSES } }),
    Job.countDocuments({ companyId, status: JOB_STATUSES.SUBMITTED }),
    User.countDocuments({ companyId, role: USER_ROLES.INSPECTOR }),
    User.countDocuments({
      companyId,
      role: USER_ROLES.INSPECTOR,
      status: USER_STATUSES.ACTIVE,
    }),
    Report.countDocuments({
      companyId,
      status: { $in: ['submitted', 'under_review', 'approved', 'draft', 'ready', 'generating', 'queued'] },
    }),
    Report.countDocuments({ companyId, status: 'approved' }),
    Job.find({
      companyId,
      status: { $in: COMPLETED_JOB_STATUSES },
      startedAt: { $ne: null },
      completedAt: { $ne: null },
    })
      .select('startedAt completedAt')
      .limit(200)
      .lean(),
    Job.find({ companyId })
      .sort({ updatedAt: -1 })
      .limit(12)
      .populate('assignedTo', 'email profile')
      .select('jobNumber status updatedAt assignedTo')
      .lean(),
  ]);

  let avgJobCompletionHours = 0;
  if (completionSamples.length) {
    const totalHours = completionSamples.reduce((sum, job) => {
      const hours =
        (new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) / 3600000;
      return sum + (Number.isFinite(hours) && hours >= 0 ? hours : 0);
    }, 0);
    avgJobCompletionHours = totalHours / completionSamples.length;
  }

  const avgDays = avgJobCompletionHours / 24;
  const avgJobCompletionTime =
    avgJobCompletionHours <= 0
      ? '—'
      : avgDays >= 1
        ? `${avgDays.toFixed(1)} days`
        : `${avgJobCompletionHours.toFixed(1)} hrs`;

  const recentActivity = recentJobs.map((job) => {
    let tone = 'in_progress';
    if (job.status === JOB_STATUSES.REVIEW_REQUIRED) tone = 'pending';
    else if (COMPLETED_JOB_STATUSES.includes(job.status)) tone = 'completed';
    else if (job.status === JOB_STATUSES.CANCELLED) tone = 'cancelled';
    else if (job.status === JOB_STATUSES.DRAFT) tone = 'draft';

    return {
      id: String(job._id),
      actor: actorName(job.assignedTo),
      action: 'updated job',
      target: job.jobNumber || 'Job',
      time: formatRelativeTime(job.updatedAt),
      tone,
      status: job.status,
    };
  });

  const firstName = user.profile?.firstName || 'there';

  return {
    greetingName: firstName,
    companyName: company?.name || 'Your company',
    overview: {
      totalJobs,
      activeJobs,
      completedJobs,
      pendingReviews,
      totalInspectors,
      activeInspectors,
      reportsSubmitted,
      reportsApproved,
      avgJobCompletionTime,
      avgJobCompletionHours: Number(avgJobCompletionHours.toFixed(2)),
    },
    recentActivity,
  };
}

module.exports = { getCompanyDashboard };
