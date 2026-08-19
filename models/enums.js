'use strict';

/**
 * Centralized enumerations for the Roof Inspection & Claims platform.
 * Keep string values stable — they are stored in MongoDB documents.
 */

const USER_ROLES = Object.freeze({
  PLATFORM_ADMIN: 'platform_admin',
  COMPANY_ADMIN: 'company_admin',
  INSPECTOR: 'inspector',
  OFFICE_STAFF: 'office_staff',
});

const USER_STATUSES = Object.freeze({
  PENDING_SETUP: 'pending_setup',
  INVITED: 'invited',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  DEACTIVATED: 'deactivated',
});

const TENANT_STATUSES = Object.freeze({
  PENDING_SUBSCRIPTION: 'pending_subscription',
  TRIAL: 'trial',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  SUSPENDED: 'suspended',
  CANCELLED: 'cancelled',
});

const GEOCODE_STATUSES = Object.freeze({
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
});

const INVITE_PURPOSES = Object.freeze({
  INSPECTOR_LOGIN: 'inspector_login',
  STAFF_INVITE: 'staff_invite',
});

const INVITE_TTL_HOURS = 24;

const SUBSCRIPTION_STATUSES = Object.freeze({
  TRIALING: 'trialing',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  UNPAID: 'unpaid',
  CANCELLED: 'cancelled',
  INCOMPLETE: 'incomplete',
});

const BILLING_INTERVALS = Object.freeze({
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
});

const INVOICE_STATUSES = Object.freeze({
  DRAFT: 'draft',
  OPEN: 'open',
  PAID: 'paid',
  VOID: 'void',
  UNCOLLECTIBLE: 'uncollectible',
});

const INVITE_STATUSES = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
});

const JOB_TYPES = Object.freeze({
  INSPECTION: 'inspection',
  CLAIM: 'claim',
  CANVASS: 'canvass',
});

const JOB_STATUSES = Object.freeze({
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  IN_PROGRESS: 'in_progress',
  PENDING_SYNC: 'pending_sync',
  COMPLETED: 'completed',
  SUBMITTED: 'submitted',
  CANCELLED: 'cancelled',
});

const JOB_SOURCES = Object.freeze({
  CANVASS: 'canvass',
  REFERRAL: 'referral',
  INBOUND: 'inbound',
  REPEAT: 'repeat',
  OTHER: 'other',
});

const CLAIM_STATUSES = Object.freeze({
  NOT_FILED: 'not_filed',
  FILED: 'filed',
  ADJUSTER_REVIEW: 'adjuster_review',
  APPROVED: 'approved',
  DENIED: 'denied',
  CLOSED: 'closed',
});

const INSPECTION_STATUSES = Object.freeze({
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  SUBMITTED: 'submitted',
});

const ELEVATION_SIDES = Object.freeze({
  NORTH: 'north',
  SOUTH: 'south',
  EAST: 'east',
  WEST: 'west',
  NORTHEAST: 'northeast',
  NORTHWEST: 'northwest',
  SOUTHEAST: 'southeast',
  SOUTHWEST: 'southwest',
  FRONT: 'front',
  REAR: 'rear',
  OTHER: 'other',
});

const ROOF_COVERING_TYPES = Object.freeze({
  ASPHALT_SHINGLE: 'asphalt_shingle',
  ARCHITECTURAL_SHINGLE: 'architectural_shingle',
  METAL: 'metal',
  TILE: 'tile',
  SLATE: 'slate',
  WOOD_SHAKE: 'wood_shake',
  TPO: 'tpo',
  EPDM: 'epdm',
  MODIFIED_BITUMEN: 'modified_bitumen',
  OTHER: 'other',
});

const DAMAGE_TYPES = Object.freeze({
  HAIL_HIT: 'hail_hit',
  BRUISING: 'bruising',
  WIND_CREASE: 'wind_crease',
  SPATTER: 'spatter',
  GRANULE_LOSS: 'granule_loss',
  LIFTED_SHINGLE: 'lifted_shingle',
  MISSING_SHINGLE: 'missing_shingle',
  CRACK: 'crack',
  PUNCTURE: 'puncture',
  OTHER: 'other',
});

const COLLATERAL_TYPES = Object.freeze({
  HVAC: 'hvac',
  GUTTER: 'gutter',
  DOWNSPOUT: 'downspout',
  SKYLIGHT: 'skylight',
  WINDOW: 'window',
  SIDING: 'siding',
  SCREEN: 'screen',
  VEHICLE: 'vehicle',
  FENCE: 'fence',
  DECK: 'deck',
  OTHER: 'other',
});

const PHOTO_SUBJECT_TYPES = Object.freeze({
  INSPECTION: 'inspection',
  ELEVATION: 'elevation',
  TEST_SQUARE: 'test_square',
  COLLATERAL: 'collateral',
  PROPERTY: 'property',
  OVERVIEW: 'overview',
});

const PHOTO_STATUSES = Object.freeze({
  LOCAL: 'local',
  UPLOADING: 'uploading',
  SYNCED: 'synced',
  FAILED: 'failed',
});

const CUSTODY_EVENTS = Object.freeze({
  CAPTURED: 'captured',
  ANNOTATED: 'annotated',
  UPLOADED: 'uploaded',
  INCLUDED_IN_REPORT: 'included_in_report',
  EXPORTED: 'exported',
});

const WEATHER_MATCH_STATUSES = Object.freeze({
  MATCH: 'match',
  MISMATCH: 'mismatch',
  INCONCLUSIVE: 'inconclusive',
  NO_DATA: 'no_data',
});

const WEATHER_EVENT_TYPES = Object.freeze({
  HAIL: 'hail',
  WIND: 'wind',
  TORNADO: 'tornado',
  RAIN: 'rain',
});

const REPORT_STATUSES = Object.freeze({
  QUEUED: 'queued',
  GENERATING: 'generating',
  READY: 'ready',
  FAILED: 'failed',
});

const SHARE_CHANNELS = Object.freeze({
  LINK: 'link',
  EMAIL: 'email',
  WHATSAPP: 'whatsapp',
});

const TEMPLATE_SCOPES = Object.freeze({
  PLATFORM: 'platform',
  TENANT: 'tenant',
});

const CHECKLIST_STEP_TYPES = Object.freeze({
  BOOLEAN: 'boolean',
  TEXT: 'text',
  NUMBER: 'number',
  SELECT: 'select',
  MULTISELECT: 'multiselect',
  PHOTO: 'photo',
  SECTION: 'section',
});

const STORM_TYPES = Object.freeze({
  HAIL: 'hail',
  WIND: 'wind',
  TORNADO: 'tornado',
});

const CANVASS_AREA_STATUSES = Object.freeze({
  PLANNED: 'planned',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  ARCHIVED: 'archived',
});

const AUDIT_ACTIONS = Object.freeze({
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LOGIN: 'login',
  LOGOUT: 'logout',
  IMPERSONATE_START: 'impersonate_start',
  IMPERSONATE_END: 'impersonate_end',
  SUSPEND: 'suspend',
  RESTORE: 'restore',
  BILLING_CHANGE: 'billing_change',
  REPORT_GENERATE: 'report_generate',
  REPORT_SHARE: 'report_share',
});

const DEVICE_PLATFORMS = Object.freeze({
  IOS: 'ios',
  ANDROID: 'android',
  WEB: 'web',
});

module.exports = {
  USER_ROLES,
  USER_STATUSES,
  TENANT_STATUSES,
  GEOCODE_STATUSES,
  INVITE_PURPOSES,
  INVITE_TTL_HOURS,
  SUBSCRIPTION_STATUSES,
  BILLING_INTERVALS,
  INVOICE_STATUSES,
  INVITE_STATUSES,
  JOB_TYPES,
  JOB_STATUSES,
  JOB_SOURCES,
  CLAIM_STATUSES,
  INSPECTION_STATUSES,
  ELEVATION_SIDES,
  ROOF_COVERING_TYPES,
  DAMAGE_TYPES,
  COLLATERAL_TYPES,
  PHOTO_SUBJECT_TYPES,
  PHOTO_STATUSES,
  CUSTODY_EVENTS,
  WEATHER_MATCH_STATUSES,
  WEATHER_EVENT_TYPES,
  REPORT_STATUSES,
  SHARE_CHANNELS,
  TEMPLATE_SCOPES,
  CHECKLIST_STEP_TYPES,
  STORM_TYPES,
  CANVASS_AREA_STATUSES,
  AUDIT_ACTIONS,
  DEVICE_PLATFORMS,
};
