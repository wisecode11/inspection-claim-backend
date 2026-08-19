'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { durationToSeconds } = require('./duration');

function signAccessToken(user) {
  return jwt.sign(
    {
      sub: String(user._id),
      role: user.role,
      companyId: user.companyId ? String(user.companyId) : null,
      typ: 'access',
    },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
}

function verifyAccessToken(token) {
  const payload = jwt.verify(token, env.jwtSecret);
  if (payload.typ && payload.typ !== 'access') {
    throw new jwt.JsonWebTokenError('Invalid token type');
  }
  return payload;
}

function getAccessExpiresInSeconds() {
  return durationToSeconds(env.jwtExpiresIn, 15 * 60);
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  getAccessExpiresInSeconds,
  signToken: signAccessToken,
  verifyToken: verifyAccessToken,
};
