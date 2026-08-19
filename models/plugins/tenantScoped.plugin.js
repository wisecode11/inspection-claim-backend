'use strict';

const { Schema } = require('mongoose');

/**
 * Adds companyId to every company-owned collection.
 *
 * Isolation rule: inspectors, jobs, photos, etc. are private to one company.
 * Every query in application code MUST include companyId
 * (enforced later by request middleware, not by this plugin).
 *
 * tenantId is a virtual alias of companyId (same value).
 *
 * @param {import('mongoose').Schema} schema
 * @param {{ optional?: boolean }} [options]
 */
function tenantScopedPlugin(schema, options = {}) {
  const optional = Boolean(options.optional);

  schema.add({
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: optional ? false : true,
      index: true,
      default: optional ? null : undefined,
    },
  });

  schema.virtual('tenantId')
    .get(function getTenantId() {
      return this.companyId;
    })
    .set(function setTenantId(value) {
      this.companyId = value;
    });
}

module.exports = tenantScopedPlugin;
