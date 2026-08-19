'use strict';

const { RefreshToken, User } = require('../models');
const HttpError = require('../utils/httpError');
const { signAccessToken, getAccessExpiresInSeconds } = require('../utils/token');
const {
  hashRefreshToken,
  createRefreshTokenValue,
  getRefreshExpiresAt,
} = require('../utils/refreshToken');

function toTokenResponse(accessToken, refreshToken) {
  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: getAccessExpiresInSeconds(),
  };
}

async function issueTokenPair(user, meta = {}) {
  const refreshToken = createRefreshTokenValue();

  await RefreshToken.create({
    userId: user._id,
    tokenHash: hashRefreshToken(refreshToken),
    deviceId: meta.deviceId || '',
    platform: meta.platform,
    userAgent: meta.userAgent || '',
    ip: meta.ip || '',
    expiresAt: getRefreshExpiresAt(),
    companyId: user.companyId || null,
  });

  return toTokenResponse(signAccessToken(user), refreshToken);
}

async function rotateRefreshToken(rawToken, meta = {}) {
  const tokenHash = hashRefreshToken(rawToken);
  const stored = await RefreshToken.findOne({
    tokenHash,
    revokedAt: null,
  });

  if (!stored || stored.expiresAt.getTime() <= Date.now()) {
    throw new HttpError(401, 'Invalid or expired refresh token');
  }

  stored.revokedAt = new Date();
  await stored.save();

  const user = await User.findById(stored.userId);
  if (!user) {
    throw new HttpError(401, 'User not found');
  }

  return issueTokenPair(user, {
    deviceId: meta.deviceId || stored.deviceId,
    platform: meta.platform || stored.platform,
    userAgent: meta.userAgent || stored.userAgent,
    ip: meta.ip || stored.ip,
  });
}

async function revokeRefreshToken(rawToken) {
  if (!rawToken) return;
  const stored = await RefreshToken.findOne({
    tokenHash: hashRefreshToken(rawToken),
    revokedAt: null,
  });
  if (!stored) return;
  stored.revokedAt = new Date();
  await stored.save();
}

async function revokeAllUserTokens(userId) {
  await RefreshToken.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

module.exports = {
  issueTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
};
