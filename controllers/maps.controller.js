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

  /** Base layers (imagery, roads, labels) for the hail swath map in the PDF. */
  swathBase: asyncHandler(async (req, res) => {
    const map = await staticMapService.fetchSwathBaseMap(req.query);
    res.set('Cache-Control', 'private, max-age=86400');
    res.status(200).json({ success: true, message: 'Swath base map', data: { map } });
  }),
};

module.exports = mapsController;
