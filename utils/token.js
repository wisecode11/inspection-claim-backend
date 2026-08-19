'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

function durationToSeconds(value, fallbackSeconds) {
  if (value == null || value === '') return fallbackSeconds;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = String(value).trim().match(/^(\d+)([smhd])$/i);
  if (!match) return fallbackSeconds;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
  return amount * multipliers[unit];
}

function accessExpiresInSeconds() {
  return durationToSeconds(process.env.JWT_EXPIRES_IN, 7 * 24 * 60 * 60);
}

function refreshExpiresInSeconds() {
  return durationToSeconds(process.env.JWT_REFRESH_EXPIRES_IN, 30 * 24 * 60 * 60);
}

function signToken(user) {
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return jwt.sign(
    {
      sub: String(user._id),
      role: user.role,
      companyId: user.companyId ? String(user.companyId) : null,
    },
    process.env.JWT_SECRET,
    { expiresIn }
  );
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

function hashRefreshToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

function createRefreshTokenValue() {
  const raw = crypto.randomBytes(48).toString('base64url');
  return { raw, hash: hashRefreshToken(raw) };
}

function toTokenResponse(accessToken, refreshToken) {
  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: accessExpiresInSeconds(),
  };
}

module.exports = {
  signToken,
  verifyToken,
  hashRefreshToken,
  createRefreshTokenValue,
  accessExpiresInSeconds,
  refreshExpiresInSeconds,
  toTokenResponse,
};
