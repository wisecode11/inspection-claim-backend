'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const env = require('../config/env');

const PLANS = [
  {
    name: 'Starter',
    slug: 'starter',
    description: 'For small roofing crews getting claim files in order.',
    pricing: { monthlyAmount: 149, yearlyAmount: 1490, currency: 'USD', perSeat: true },
    trialDays: 14,
    limits: { seats: 5, inspectionsPerMonth: 500, storageGb: 20, photosPerInspection: 80, reportsPerMonth: 500 },
    features: {
      weatherVerification: true,
      stormMap: false,
      customTemplates: false,
      customChecklists: false,
      analytics: false,
      whatsappShare: true,
      prioritySupport: false,
    },
    sortOrder: 1,
  },
  {
    name: 'Pro',
    slug: 'pro',
    description: 'Branding, weather checks, and room for a growing team.',
    pricing: { monthlyAmount: 499, yearlyAmount: 4990, currency: 'USD', perSeat: true },
    trialDays: 14,
    limits: { seats: 15, inspectionsPerMonth: 2500, storageGb: 100, photosPerInspection: 120, reportsPerMonth: 2500 },
    features: {
      weatherVerification: true,
      stormMap: true,
      customTemplates: true,
      customChecklists: true,
      analytics: true,
      whatsappShare: true,
      prioritySupport: true,
    },
    sortOrder: 2,
  },
  {
    name: 'Enterprise',
    slug: 'enterprise',
    description: 'Unlimited volume with audit controls and dedicated support.',
    pricing: { monthlyAmount: 1499, yearlyAmount: 14990, currency: 'USD', perSeat: true },
    trialDays: 14,
    limits: { seats: 60, inspectionsPerMonth: 0, storageGb: 500, photosPerInspection: 200, reportsPerMonth: 0 },
    features: {
      weatherVerification: true,
      stormMap: true,
      customTemplates: true,
      customChecklists: true,
      analytics: true,
      whatsappShare: true,
      prioritySupport: true,
    },
    sortOrder: 3,
  },
];

async function seedPlans() {
  await mongoose.connect(env.mongodbUri);
  require('../models');
  const { Plan } = require('../models');

  for (const plan of PLANS) {
    await Plan.findOneAndUpdate(
      { slug: plan.slug },
      { $set: { ...plan, isPublic: true, isActive: true } },
      { upsert: true, new: true }
    );
    console.log(`Plan ready: ${plan.name}`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

seedPlans().catch((error) => {
  console.error('Plan seed failed:', error.message);
  process.exit(1);
});
