'use strict';

/**
 * Business logic + database access live here.
 * Controllers call services; services use models.
 */

const authService = require('./auth.service');
const userService = require('./user.service');
const companyService = require('./company.service');
const subscriptionService = require('./subscription.service');
const customerService = require('./customer.service');
const jobService = require('./job.service');
const photoService = require('./photo.service');
const weatherService = require('./weather.service');
const reportService = require('./report.service');
const checklistService = require('./checklist.service');
const auditService = require('./audit.service');

module.exports = {
  authService,
  userService,
  companyService,
  subscriptionService,
  customerService,
  jobService,
  photoService,
  weatherService,
  reportService,
  checklistService,
  auditService,
};
