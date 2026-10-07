'use strict';

const HttpError = require('../utils/httpError');

const ALLOWED_TYPES = new Set(['roadmap', 'satellite']);

function parseCoords(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new HttpError(400, 'Valid latitude and longitude are required');
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new HttpError(400, 'Coordinates out of range');
  }
  return { lat, lng };
}

function buildGoogleUrl(lat, lng, maptype) {
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_GEOCODING_API_KEY;
  if (!key) return null;

  const params = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: '19',
    size: '640x400',
    scale: '2',
    maptype,
    key,
  });

  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

function buildMapboxUrl(lat, lng, maptype) {
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) return null;

  const style = maptype === 'satellite' ? 'mapbox/satellite-streets-v12' : 'mapbox/streets-v12';
  return (
    `https://api.mapbox.com/styles/v1/${style}/static/${lng},${lat},18,0/640x400@2x` +
    `?access_token=${encodeURIComponent(token)}`
  );
}

/** Free fallback when Google/Mapbox keys are not configured (centered on property). */
function buildFallbackUrl(lat, lng, maptype) {
  const pad = 0.0012;
  const layer =
    maptype === 'satellite'
      ? 'World_Imagery'
      : 'World_Street_Map';
  const params = new URLSearchParams({
    bbox: `${lng - pad},${lat - pad},${lng + pad},${lat + pad}`,
    bboxSR: '4326',
    imageSR: '4326',
    size: '640,400',
    format: 'jpg',
    f: 'image',
  });
  return `https://services.arcgisonline.com/ArcGIS/rest/services/${layer}/MapServer/export?${params.toString()}`;
}

async function fetchImage(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'RoofCheck/1.0 (inspection evidence package)' },
  });
  if (!response.ok) {
    throw new HttpError(502, `Static map provider failed (${response.status})`);
  }

  const contentType = response.headers.get('content-type') || 'image/png';
  if (!contentType.startsWith('image/')) {
    throw new HttpError(502, 'Static map provider returned a non-image response');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, contentType };
}

async function fetchStaticMapImage({ latitude, longitude, maptype = 'roadmap' }) {
  const type = String(maptype || 'roadmap').toLowerCase();
  if (!ALLOWED_TYPES.has(type)) {
    throw new HttpError(400, 'maptype must be roadmap or satellite');
  }

  const { lat, lng } = parseCoords(latitude, longitude);
  const candidates = [
    buildGoogleUrl(lat, lng, type),
    buildMapboxUrl(lat, lng, type),
    buildFallbackUrl(lat, lng, type),
  ].filter(Boolean);

  let lastError = null;
  for (const url of candidates) {
    try {
      return await fetchImage(url);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new HttpError(502, 'Could not generate static map');
}

// ---------------------------------------------------------------------------
// Swath map base: satellite imagery + roads + place labels for an exact lat/lon box,
// in Web Mercator, so the PDF can draw hail swath polygons on top in the same projection.
// ---------------------------------------------------------------------------

const EARTH_RADIUS_M = 6378137;
const ESRI_BASE = 'https://services.arcgisonline.com/ArcGIS/rest/services';
const SWATH_LAYERS = [
  { id: 'imagery', service: 'World_Imagery', format: 'jpg' },
  { id: 'roads', service: 'Reference/World_Transportation', format: 'png8' },
  { id: 'labels', service: 'Reference/World_Boundaries_and_Places', format: 'png8' },
];
const MAX_SPAN_DEG = 3;

function toMercator(lon, lat) {
  const rad = Math.PI / 180;
  return {
    x: EARTH_RADIUS_M * lon * rad,
    y: EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + (lat * rad) / 2)),
  };
}

function parseBounds({ west, south, east, north }) {
  const box = { west: Number(west), south: Number(south), east: Number(east), north: Number(north) };
  if (!Object.values(box).every(Number.isFinite)) {
    throw new HttpError(400, 'west, south, east and north are required');
  }
  if (box.west >= box.east || box.south >= box.north) {
    throw new HttpError(400, 'Bounds must satisfy west < east and south < north');
  }
  if (box.east - box.west > MAX_SPAN_DEG || box.north - box.south > MAX_SPAN_DEG) {
    throw new HttpError(400, `Bounds may span at most ${MAX_SPAN_DEG}°`);
  }
  if (box.south < -85 || box.north > 85 || box.west < -180 || box.east > 180) {
    throw new HttpError(400, 'Bounds out of range');
  }
  return box;
}

/**
 * Fetches the three base layers for a bounding box. Height follows the box's Mercator
 * aspect ratio, so any lon/lat → pixel projection over the same box lines up exactly.
 */
async function fetchSwathBaseMap(query) {
  const box = parseBounds(query);
  const width = Math.min(1600, Math.max(400, Math.round(Number(query.width) || 1200)));
  const sw = toMercator(box.west, box.south);
  const ne = toMercator(box.east, box.north);
  const height = Math.round((width * (ne.y - sw.y)) / (ne.x - sw.x));
  const bbox = [sw.x, sw.y, ne.x, ne.y].map((v) => v.toFixed(2)).join(',');

  const layers = await Promise.all(
    SWATH_LAYERS.map(async (layer) => {
      const params = new URLSearchParams({
        bbox,
        bboxSR: '3857',
        imageSR: '3857',
        size: `${width},${height}`,
        format: layer.format,
        transparent: 'true',
        f: 'image',
      });
      const { buffer, contentType } = await fetchImage(`${ESRI_BASE}/${layer.service}/MapServer/export?${params}`);
      return { id: layer.id, dataUri: `data:${contentType};base64,${buffer.toString('base64')}` };
    })
  );

  return {
    bounds: box,
    width,
    height,
    layers,
    attribution: 'Base map: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  };
}

module.exports = {
  fetchStaticMapImage,
  fetchSwathBaseMap,
  ALLOWED_TYPES,
};
