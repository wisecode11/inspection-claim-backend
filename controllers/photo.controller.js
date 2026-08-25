'use strict';

const asyncHandler = require('../utils/asyncHandler');
const photoService = require('../services/photo.service');

const photoController = {
  uploadForJob: asyncHandler(async (req, res) => {
    const photo = await photoService.uploadJobPhoto(req.user, req.params.jobId, req.body);
    res.status(201).json({
      success: true,
      message: 'Photo uploaded',
      data: { photo },
    });
  }),

  downloadFile: asyncHandler(async (req, res) => {
    const { buffer, mimeType, fileName } = await photoService.getPhotoBuffer(
      req.params.id,
      req.query.token
    );
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.send(buffer);
  }),
};

module.exports = photoController;
