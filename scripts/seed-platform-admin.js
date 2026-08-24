'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const env = require('../config/env');
const { hashPassword } = require('../utils/password');

async function seedPlatformAdmin() {
  await mongoose.connect(env.mongodbUri);
  require('../models');

  const { User } = require('../models');
  const { USER_ROLES, USER_STATUSES } = require('../models/enums');

  const email = env.platformAdminEmail.toLowerCase().trim();
  const passwordHash = await hashPassword(env.platformAdminPassword);

  const existing = await User.findOne({ email });

  if (existing) {
    existing.passwordHash = passwordHash;
    existing.role = USER_ROLES.PLATFORM_ADMIN;
    existing.status = USER_STATUSES.ACTIVE;
    existing.companyId = undefined;
    if (!existing.profile?.firstName) {
      existing.profile = {
        ...(existing.profile || {}),
        firstName: existing.profile?.firstName || 'Super',
        lastName: existing.profile?.lastName || 'Admin',
      };
    }
    await existing.save();
    console.log(`Platform admin updated: ${email}`);
  } else {
    await User.create({
      email,
      passwordHash,
      role: USER_ROLES.PLATFORM_ADMIN,
      status: USER_STATUSES.ACTIVE,
      profile: {
        firstName: 'Super',
        lastName: 'Admin',
      },
    });
    console.log(`Platform admin created: ${email}`);
  }

  // Remove legacy seed email if it differs from the configured admin.
  const legacyEmail = 'jordan@roofclaim.io';
  if (email !== legacyEmail) {
    const removed = await User.deleteOne({
      email: legacyEmail,
      role: USER_ROLES.PLATFORM_ADMIN,
    });
    if (removed.deletedCount > 0) {
      console.log(`Removed legacy platform admin: ${legacyEmail}`);
    }
  }

  await mongoose.disconnect();
  process.exit(0);
}

seedPlatformAdmin().catch((error) => {
  console.error('Seed failed:', error.message);
  process.exit(1);
});
