'use strict';

const { Router } = require('express');

const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const companyRoutes = require('./company.routes');
const subscriptionRoutes = require('./subscription.routes');
const customerRoutes = require('./customer.routes');
const jobRoutes = require('./job.routes');
const photoRoutes = require('./photo.routes');
const weatherRoutes = require('./weather.routes');
const reportRoutes = require('./report.routes');
const checklistRoutes = require('./checklist.routes');
const auditRoutes = require('./audit.routes');

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/companies', companyRoutes);
router.use('/subscriptions', subscriptionRoutes);
router.use('/customers', customerRoutes);
router.use('/jobs', jobRoutes);
router.use('/photos', photoRoutes);
router.use('/weather', weatherRoutes);
router.use('/reports', reportRoutes);
router.use('/checklists', checklistRoutes);
router.use('/audit', auditRoutes);

module.exports = router;
