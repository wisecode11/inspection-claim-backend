'use strict';

const EARTH_RADIUS_MILES = 3958.8;
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in miles between two { latitude, longitude } points. */
function distanceMiles(a, b) {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 16-point compass direction of `to` as seen from `from` (e.g. "NE"). */
function compassFrom(from, to) {
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return COMPASS[Math.round(((bearing + 360) % 360) / 22.5) % 16];
}

/** Bounding box (degrees) that fully contains a circle of `miles` around the point. */
function bboxAround({ latitude, longitude }, miles) {
  const dLat = miles / 69.0;
  const dLon = miles / (69.0 * Math.max(0.01, Math.cos(toRad(latitude))));
  return {
    minLon: longitude - dLon,
    minLat: latitude - dLat,
    maxLon: longitude + dLon,
    maxLat: latitude + dLat,
  };
}

/** Adds distanceMiles + direction to each item and keeps those within `radiusMiles`, nearest first. */
function withinRadius(origin, items, radiusMiles) {
  return items
    .map((item) => {
      const point = { latitude: item.latitude, longitude: item.longitude };
      return {
        ...item,
        distanceMiles: Math.round(distanceMiles(origin, point) * 10) / 10,
        direction: compassFrom(origin, point),
      };
    })
    .filter((item) => item.distanceMiles <= radiusMiles)
    .sort((a, b) => a.distanceMiles - b.distanceMiles);
}

module.exports = {
  EARTH_RADIUS_MILES,
  distanceMiles,
  compassFrom,
  bboxAround,
  withinRadius,
};
