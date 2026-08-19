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
  const existing = await User.findOne({ email });

  if (existing) {
    console.log(`Platform admin already exists: ${email}`);
    await mongoose.disconnect();
    process.exit(0);
    return;
  }

  await User.create({
    email,
    passwordHash: await hashPassword(env.platformAdminPassword),
    role: USER_ROLES.PLATFORM_ADMIN,
    status: USER_STATUSES.ACTIVE,
    profile: {
      firstName: 'Jordan',
      lastName: 'Diaz',
    },
  });

  console.log(`Platform admin created: ${email}`);
  await mongoose.disconnect();
  process.exit(0);
}

seedPlatformAdmin().catch((error) => {
  console.error('Seed failed:', error.message);
  process.exit(1);
});
