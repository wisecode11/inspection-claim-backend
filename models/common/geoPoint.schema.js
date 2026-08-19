'use strict';

const { Schema } = require('mongoose');

/** GeoJSON Point — pair with a 2dsphere index on the parent path. */
const geoPointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: {
      type: [Number],
      validate: {
        validator(value) {
          if (!value || value.length === 0) return true;
          return value.length === 2 && value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90;
        },
        message: 'coordinates must be [longitude, latitude]',
      },
      default: undefined,
    },
  },
  { _id: false }
);

module.exports = geoPointSchema;
