'use strict';

const { Router } = require('express');

const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const companyRoutes = require('./company.routes');
const tenantRoutes = require('./tenant.routes');
const subscriptionRoutes = require('./subscription.routes');
const billingRoutes = require('./billing.routes');
const dashboardRoutes = require('./dashboard.routes');
const customerRoutes = require('./customer.routes');
const jobRoutes = require('./job.routes');
const photoRoutes = require('./photo.routes');
const weatherRoutes = require('./weather.routes');
const mapsRoutes = require('./maps.routes');
const reportRoutes = require('./report.routes');
const checklistRoutes = require('./checklist.routes');
const templateRoutes = require('./template.routes');
const analyticsRoutes = require('./analytics.routes');
const auditRoutes = require('./audit.routes');

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/companies', companyRoutes);
router.use('/tenants', tenantRoutes);
router.use('/subscriptions', subscriptionRoutes);
router.use('/billing', billingRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/customers', customerRoutes);
router.use('/jobs', jobRoutes);
router.use('/photos', photoRoutes);
router.use('/weather', weatherRoutes);
router.use('/maps', mapsRoutes);
router.use('/reports', reportRoutes);
router.use('/checklists', checklistRoutes);
router.use('/templates', templateRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/audit', auditRoutes);

module.exports = router;
