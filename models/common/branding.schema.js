'use strict';

const { Schema } = require('mongoose');

const brandingSchema = new Schema(
  {
    logoUrl: { type: String, trim: true, default: '' },
    logoStorageKey: { type: String, trim: true, default: '' },
    primaryColor: { type: String, trim: true, default: '#1B4F72' },
    secondaryColor: { type: String, trim: true, default: '#F4D03F' },
    accentColor: { type: String, trim: true, default: '#FFFFFF' },
    companyDisplayName: { type: String, trim: true, maxlength: 160, default: '' },
    tagline: { type: String, trim: true, maxlength: 200, default: '' },
    letterheadNote: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { _id: false }
);

module.exports = brandingSchema;
