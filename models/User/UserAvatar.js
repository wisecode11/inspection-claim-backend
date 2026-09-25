'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * Profile picture bytes, one per user.
 * Kept out of `users` so every auth/user query doesn't drag image data along.
 * `key` is random and regenerated on each upload: it is the public URL segment
 * (unguessable, so no auth needed to render it) and doubles as a cache-buster.
 */
const userAvatarSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    key: { type: String, required: true, unique: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true },
  },
  { timestamps: true, collection: 'user_avatars' }
);

module.exports = mongoose.models.UserAvatar || mongoose.model('UserAvatar', userAvatarSchema);
