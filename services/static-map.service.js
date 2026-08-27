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

module.exports = {
  fetchStaticMapImage,
  ALLOWED_TYPES,
};
