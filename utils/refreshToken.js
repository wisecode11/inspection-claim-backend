'use strict';

const crypto = require('crypto');
const env = require('../config/env');
const { durationFromNow } = require('./duration');

function hashRefreshToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function createRefreshTokenValue() {
  return crypto.randomBytes(48).toString('hex');
}

function getRefreshExpiresAt() {
  return durationFromNow(env.jwtRefreshExpiresIn, 30 * 24 * 60 * 60);
}

module.exports = {
  hashRefreshToken,
  createRefreshTokenValue,
  getRefreshExpiresAt,
};
