'use strict';

const { Router } = require('express');
const {
  authenticate,
  requireCompany,
  requireOfficeAccess,
} = require('../middlewares/auth.middleware');
const { PERMISSIONS } = require('../utils/permissions');
const reportController = require('../controllers/report.controller');

const router = Router();

router.get('/:id/pdf', reportController.downloadPdf);

router.use(authenticate, requireCompany);

router.get('/', requireOfficeAccess(PERMISSIONS.REPORTS_REVIEW), reportController.list);

router.get(
  '/jobs/:jobId/review',
  requireOfficeAccess(PERMISSIONS.REPORTS_REVIEW),
  reportController.review
);
router.get(
  '/jobs/:jobId',
  requireOfficeAccess(PERMISSIONS.REPORTS_REVIEW),
  reportController.getForJob
);
router.patch(
  '/jobs/:jobId/narrative',
  requireOfficeAccess(PERMISSIONS.REPORTS_EDIT_NARRATIVE),
  reportController.updateNarrative
);
router.post(
  '/jobs/:jobId/generate',
  requireOfficeAccess(PERMISSIONS.REPORTS_GENERATE),
  reportController.generate
);
router.post(
  '/jobs/:jobId/share',
  requireOfficeAccess(PERMISSIONS.REPORTS_SHARE),
  reportController.share
);

router.get('/:id', requireOfficeAccess(PERMISSIONS.REPORTS_REVIEW), reportController.getById);
router.post('/:id/submit', requireOfficeAccess(PERMISSIONS.REPORTS_REVIEW), reportController.submit);
router.post(
  '/:id/review',
  requireOfficeAccess(PERMISSIONS.REPORTS_REVIEW),
  reportController.startReview
);
router.post('/:id/approve', requireOfficeAccess(PERMISSIONS.REPORTS_REVIEW), reportController.approve);
router.post('/:id/reject', requireOfficeAccess(PERMISSIONS.REPORTS_REVIEW), reportController.reject);
router.post(
  '/:id/request-changes',
  requireOfficeAccess(PERMISSIONS.REPORTS_REVIEW),
  reportController.requestChanges
);
router.post('/:id/share', requireOfficeAccess(PERMISSIONS.REPORTS_SHARE), reportController.shareById);

module.exports = router;
