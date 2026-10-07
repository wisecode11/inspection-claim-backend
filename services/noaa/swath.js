'use strict';

const { compassFrom, distanceMiles } = require('./geo');

/**
 * Hail swath polygons from an MRMS MESH grid: contour bands at fixed hail sizes, plus the
 * estimated size at the property and the largest size within the search radius.
 */
const MM_PER_INCH = 25.4;
/** Band floors in inches; a band covers "≥ this size". */
const THRESHOLDS_IN = [0.5, 0.75, 1, 1.5, 2, 2.5];
/** Map shape used by the PDF (width / height) and how far past the radius it shows. */
const MAP_ASPECT = 2.2;
const MAP_MARGIN = 1.25;

function round5(value) {
  return Math.round(value * 1e5) / 1e5;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Lat/lon box for the swath map: the search radius plus a margin vertically, widened to
 * the map's aspect ratio. The same box is used to crop MRMS and to request base imagery.
 */
function mapBounds(origin, radiusMiles) {
  const halfHeightMiles = radiusMiles * MAP_MARGIN;
  const halfWidthMiles = halfHeightMiles * MAP_ASPECT;
  const dLat = halfHeightMiles / 69.0;
  const dLon = halfWidthMiles / (69.0 * Math.cos((origin.latitude * Math.PI) / 180));
  return {
    west: round5(origin.longitude - dLon),
    south: round5(origin.latitude - dLat),
    east: round5(origin.longitude + dLon),
    north: round5(origin.latitude + dLat),
  };
}

/** Grid cell (row, col) containing a point, or null when outside. */
function cellOf(grid, point) {
  const row = Math.round((grid.lat0 - point.latitude) / grid.dLat);
  const col = Math.round((point.longitude - grid.lon0) / grid.dLon);
  if (row < 0 || col < 0 || row >= grid.ny || col >= grid.nx) return null;
  return { row, col };
}

/**
 * Builds swath bands and hail-size statistics.
 * @param {object} grid      cropped MRMS grid (values in mm, row 0 = north)
 * @param {object} options   { origin, radiusMiles }
 */
async function buildSwath(grid, { origin, radiusMiles }) {
  const { contours } = await import('d3-contour');

  const inches = new Float64Array(grid.values.length);
  for (let i = 0; i < grid.values.length; i++) {
    inches[i] = grid.values[i] > 0 ? grid.values[i] / MM_PER_INCH : 0;
  }

  // d3 treats cell i as spanning [i, i + 1]; cell centres are at i + 0.5.
  const west = grid.lon0 - grid.dLon / 2;
  const north = grid.lat0 + grid.dLat / 2;
  const toLonLat = ([x, y]) => [round5(west + x * grid.dLon), round5(north - y * grid.dLat)];

  const bands = contours()
    .size([grid.nx, grid.ny])
    .thresholds(THRESHOLDS_IN)
    .smooth(true)(Array.from(inches))
    .filter((band) => band.coordinates.length > 0)
    .map((band) => ({
      minIn: band.value,
      geometry: {
        type: 'MultiPolygon',
        coordinates: band.coordinates.map((polygon) => polygon.map((ring) => ring.map(toLonLat))),
      },
    }));

  // Size at the property: the cell containing it.
  const home = cellOf(grid, origin);
  const atPropertyIn = home ? round2(inches[home.row * grid.nx + home.col]) : null;

  // Largest size whose cell centre lies within the search radius.
  let maxIn = 0;
  let maxAt = null;
  for (let row = 0; row < grid.ny; row++) {
    for (let col = 0; col < grid.nx; col++) {
      const value = inches[row * grid.nx + col];
      if (value <= maxIn) continue;
      const point = { latitude: grid.lat0 - row * grid.dLat, longitude: grid.lon0 + col * grid.dLon };
      if (distanceMiles(origin, point) <= radiusMiles) {
        maxIn = value;
        maxAt = point;
      }
    }
  }

  return {
    thresholdsIn: THRESHOLDS_IN,
    bands,
    atPropertyIn,
    maxWithinRadiusIn: maxIn > 0 ? round2(maxIn) : null,
    maxWithinRadiusAt: maxAt
      ? {
          distanceMiles: Math.round(distanceMiles(origin, maxAt) * 10) / 10,
          direction: compassFrom(origin, maxAt),
        }
      : null,
    resolutionDeg: grid.dLat,
  };
}

module.exports = { THRESHOLDS_IN, MAP_ASPECT, mapBounds, buildSwath, cellOf };
