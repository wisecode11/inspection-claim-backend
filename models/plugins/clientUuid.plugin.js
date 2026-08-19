'use strict';

/**
 * clientUuid is an optional device id for offline sync.
 * Sparse unique indexes still treat "" and null as real keys, so a
 * second server-created customer/job hits Mongo 11000.
 * Index only real non-empty uuids, and omit the field otherwise.
 */
function clientUuidIndex() {
  return {
    unique: true,
    name: 'company_clientUuid_unique',
    partialFilterExpression: { clientUuid: { $type: 'string', $gt: '' } },
  };
}

function unsetEmptyClientUuid() {
  if (this.clientUuid == null || String(this.clientUuid).trim() === '') {
    this.clientUuid = undefined;
    if (this._doc) {
      delete this._doc.clientUuid;
    }
  }
}

function clientUuidPlugin(schema) {
  schema.pre('validate', unsetEmptyClientUuid);
  schema.pre('save', unsetEmptyClientUuid);
}

module.exports = clientUuidPlugin;
module.exports.clientUuidIndex = clientUuidIndex;
module.exports.CLIENT_UUID_INDEX_NAME = 'company_clientUuid_unique';
