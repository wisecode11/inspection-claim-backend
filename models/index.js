'use strict';

/**
 * Model registry — require this file once after mongoose.connect().
 *
 * ACCESS FLOW
 *   1. User signup (company_admin, pending_setup)
 *   2. User creates Company (Tenant) → ownerId set, company status pending_subscription
 *   3. User buys Subscription → company status trial/active → operational access
 *   4. Company admin creates Inspector (User with companyId) + 24h email login Invite
 *   5. Company admin creates Job (address geocoded) and assigns inspector
 *   6. Inspector sees only jobs where assignedTo = self AND companyId = own company
 *
 * TENANCY
 *   Shared database, companyId on every company-owned document.
 *   Platform-only collections: Plan, PlatformSettings, StormEvent.
 *   Hybrid (platform OR company): User, Checklist, ReportTemplate, CodeCitation, AuditLog.
 *
 * EMBED vs REFERENCE
 *   Embed: address, branding, hits, annotations, checklist steps, template sections.
 *   Reference: photos, reports, jobs, users (unbounded / independently queried).
 *   Snapshot: inspection.checklistSnapshot, report.brandingSnapshot / templateSnapshot.
 *
 * RELATIONSHIP MAP
 *
 *   Plan 1 ──< Tenant 1 ──< User
 *                │ 1
 *                ├──< Invite
 *                ├── 1 Subscription ──> Plan
 *                ├──< Invoice
 *                ├──< Customer 1 ──< Property 1 ──< Job
 *                ├──< Checklist
 *                ├──< ReportTemplate ──< CodeCitation
 *                ├──< CanvassArea ──> StormEvent
 *                ├──< UsageRecord
 *                └──< Device
 *
 *   Job 1 ──< Inspection 1 ──< Elevation 1 ──< TestSquare (hits embedded)
 *         │                ├──< CollateralItem
 *         │                ├──< Photo
 *         │                ├──  WeatherVerification
 *         │                └──< Report 1 ──< ReportShare
 *         └──> CanvassArea / StormEvent (optional)
 *
 *   RefreshToken ──> User
 *   AuditLog ──> User / Tenant (optional)
 */

const { Plan, Subscription, Invoice } = require('./Subscription');
const { Tenant, PlatformSettings, UsageRecord } = require('./Tenant');
const { User, Invite, Device, RefreshToken } = require('./User');
const { Customer, Property } = require('./Customer');
const { Job, Inspection, Elevation, TestSquare, CollateralItem } = require('./Job');
const { Photo } = require('./Photo');
const { WeatherVerification, StormEvent, CanvassArea } = require('./Weather');
const { Report, ReportShare, ReportTemplate } = require('./Report');
const { Checklist, CodeCitation } = require('./Checklist');
const { AuditLog } = require('./Audit');
const enums = require('./enums');

const models = {
  Plan,
  Tenant,
  User,
  Invite,
  Subscription,
  Invoice,
  RefreshToken,
  Device,
  PlatformSettings,
  Customer,
  Property,
  Job,
  Inspection,
  Elevation,
  TestSquare,
  CollateralItem,
  Photo,
  WeatherVerification,
  Report,
  ReportShare,
  Checklist,
  ReportTemplate,
  CodeCitation,
  StormEvent,
  CanvassArea,
  UsageRecord,
  AuditLog,
};

module.exports = {
  ...models,
  models,
  enums,
};
