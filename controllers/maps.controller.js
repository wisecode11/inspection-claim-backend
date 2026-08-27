'use strict';

const asyncHandler = require('../utils/asyncHandler');
const staticMapService = require('../services/static-map.service');

const mapsController = {
  staticMap: asyncHandler(async (req, res) => {
    const { latitude, longitude, maptype } = req.query;
    const { buffer, contentType } = await staticMapService.fetchStaticMapImage({
      latitude,
      longitude,
      maptype,
    });

    res.set('Cache-Control', 'private, max-age=3600');
    res.set('Content-Type', contentType);
    res.status(200).send(buffer);
  }),
};

module.exports = mapsController;
