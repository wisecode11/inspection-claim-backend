'use strict';

const crypto = require('crypto');

const { UserAvatar } = require('../models');
const HttpError = require('../utils/httpError');
const { toUserResponse } = require('../utils/userResponse');

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_KEY_RE = /^[a-f0-9]{32}$/;
const AVATAR_PATH_PREFIX = '/api/avatars/';

/** Sniff the real format from the file header rather than trusting the client's mimeType. */
function detectImageMime(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

async function updateMyProfile(user, payload) {
  user.profile.firstName = payload.firstName;
  user.profile.lastName = payload.lastName;
  user.profile.phone = payload.phone;
  user.profile.licenseNumber = payload.licenseNumber;
  user.updatedBy = user._id;
  await user.save();
  return { user: toUserResponse(user) };
}

async function setMyAvatar(user, payload) {
  const buffer = Buffer.from(payload.base64, 'base64');
  if (!buffer.length) {
    throw new HttpError(400, 'Invalid image data');
  }
  if (buffer.length > AVATAR_MAX_BYTES) {
    throw new HttpError(413, 'Profile photo must be 2 MB or smaller');
  }

  const mimeType = detectImageMime(buffer);
  if (!mimeType) {
    throw new HttpError(400, 'Profile photo must be a JPEG, PNG or WebP image');
  }

  const key = crypto.randomBytes(16).toString('hex');
  await UserAvatar.findOneAndUpdate(
    { userId: user._id },
    { userId: user._id, key, mimeType, size: buffer.length, data: buffer },
    { upsert: true, setDefaultsOnInsert: true }
  );

  user.profile.avatarUrl = `${AVATAR_PATH_PREFIX}${key}`;
  user.updatedBy = user._id;
  await user.save();
  return { user: toUserResponse(user) };
}

async function removeMyAvatar(user) {
  await UserAvatar.deleteOne({ userId: user._id });
  // Also clears an external (e.g. Google) picture — "remove" means no photo at all.
  if (user.profile.avatarUrl) {
    user.profile.avatarUrl = '';
    user.updatedBy = user._id;
    await user.save();
  }
  return { user: toUserResponse(user) };
}

async function getAvatarByKey(key) {
  if (!AVATAR_KEY_RE.test(String(key || ''))) {
    throw new HttpError(404, 'Avatar not found');
  }
  const avatar = await UserAvatar.findOne({ key });
  if (!avatar) {
    throw new HttpError(404, 'Avatar not found');
  }
  return { buffer: avatar.data, mimeType: avatar.mimeType };
}

module.exports = {
  updateMyProfile,
  setMyAvatar,
  removeMyAvatar,
  getAvatarByKey,
};
