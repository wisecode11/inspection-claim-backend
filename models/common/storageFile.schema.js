'use strict';

const { Schema } = require('mongoose');

const storageFileSchema = new Schema(
  {
    bucket: { type: String, trim: true, default: '' },
    key: { type: String, trim: true, default: '' },
    url: { type: String, trim: true, default: '' },
    thumbnailUrl: { type: String, trim: true, default: '' },
    mimeType: { type: String, trim: true, default: '' },
    sizeBytes: { type: Number, min: 0, default: 0 },
    checksum: { type: String, trim: true, default: '' },
    originalFileName: { type: String, trim: true, maxlength: 255, default: '' },
  },
  { _id: false }
);

module.exports = storageFileSchema;
