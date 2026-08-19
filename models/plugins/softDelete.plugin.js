'use strict';

const { Schema } = require('mongoose');

/**
 * Soft-delete: documents are hidden from default finds instead of removed.
 * Pass { withDeleted: true } on a query to include deleted rows.
 */
function softDeletePlugin(schema) {
  schema.add({
    deletedAt: { type: Date, default: null, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  });

  const applyNotDeleted = function applyNotDeleted() {
    const options = typeof this.getOptions === 'function' ? this.getOptions() : {};
    if (options.withDeleted) return;
    if (this.getFilter().deletedAt !== undefined) return;
    this.where({ deletedAt: null });
  };

  schema.pre('find', applyNotDeleted);
  schema.pre('findOne', applyNotDeleted);
  schema.pre('findOneAndUpdate', applyNotDeleted);
  schema.pre('countDocuments', applyNotDeleted);
  schema.pre('aggregate', function applyNotDeletedAggregate() {
    const options = this.options || {};
    if (options.withDeleted) return;
    this.pipeline().unshift({ $match: { deletedAt: null } });
  });

  schema.methods.softDelete = function softDelete(userId) {
    this.deletedAt = new Date();
    this.deletedBy = userId || null;
    return this.save();
  };

  schema.methods.restore = function restore() {
    this.deletedAt = null;
    this.deletedBy = null;
    return this.save();
  };
}

module.exports = softDeletePlugin;
