'use strict';

const { Schema } = require('mongoose');

const addressSchema = new Schema(
  {
    line1: { type: String, trim: true, maxlength: 200, default: '' },
    line2: { type: String, trim: true, maxlength: 200, default: '' },
    city: { type: String, trim: true, maxlength: 100, default: '' },
    state: { type: String, trim: true, uppercase: true, maxlength: 50, default: '' },
    postalCode: { type: String, trim: true, maxlength: 20, default: '' },
    country: { type: String, trim: true, uppercase: true, maxlength: 2, default: 'US' },
    formatted: { type: String, trim: true, maxlength: 400, default: '' },
  },
  { _id: false }
);

module.exports = addressSchema;
