'use strict';

const { Schema } = require('mongoose');

/**
 * Tracks which user created / last updated a document.
 * Combine with mongoose timestamps: true for createdAt / updatedAt.
 */
function auditFieldsPlugin(schema) {
  schema.add({
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  });
}

module.exports = auditFieldsPlugin;
