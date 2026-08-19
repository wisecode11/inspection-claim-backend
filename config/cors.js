'use strict';

const env = require('./env');

module.exports = {
  origin: env.corsOrigin.split(',').map((item) => item.trim()),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
