'use strict';

/**
 * HTTP handlers only — validate request, call a service, return response.
 * No database calls here.
 */

const authController = require('./auth.controller');
const userController = require('./user.controller');
const companyController = require('./company.controller');
const subscriptionController = require('./subscription.controller');
const customerController = require('./customer.controller');
const jobController = require('./job.controller');
const photoController = require('./photo.controller');
const weatherController = require('./weather.controller');
const reportController = require('./report.controller');
const checklistController = require('./checklist.controller');
const auditController = require('./audit.controller');

module.exports = {
  authController,
  userController,
  companyController,
  subscriptionController,
  customerController,
  jobController,
  photoController,
  weatherController,
  reportController,
  checklistController,
  auditController,
};
