'use strict';

const { GEOCODE_STATUSES } = require('../models/enums');

const REQUEST_MS = 8000;
const PK_HINT =
  /\b(lahore|karachi|islamabad|rawalpindi|faisalabad|multan|peshawar|quetta|sialkot|gujranwala|hyderabad|johar|punjab|sindh|balochistan|kpk|khyber)\b/i;

function displayCountry(code) {
  const value = String(code || '').trim().toUpperCase();
  if (value === 'PK' || value === 'PAKISTAN') {
    return 'Pakistan';
  }
  if (value === 'US' || value === 'USA' || value === 'UNITED STATES') {
    return 'USA';
  }
  return value;
}

function looksLikePakistan(address = {}) {
  const blob = [address.line1, address.street, address.city, address.state, address.formatted]
    .filter(Boolean)
    .join(' ');
  return PK_HINT.test(blob);
}

function resolveCountry(address = {}) {
  const explicit = String(address.country || '').trim().toUpperCase();
  if (explicit && explicit !== 'US') {
    return explicit;
  }
  if (looksLikePakistan(address)) {
    return 'PK';
  }
  return explicit;
}

function uniqueQueries(values) {
  const seen = new Set();
  return values
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .filter((value) => {
      if (!value) {
        return false;
      }
      const key = value.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function geocodeQueries(address = {}) {
  const line1 = address.line1 || address.street || '';
  const city = address.city || '';
  const state = address.state || '';
  const postal = address.postalCode || address.zip || '';
  const countryCode = resolveCountry(address);
  const countryName = displayCountry(countryCode);
  const skipUsa = countryCode === 'US' && looksLikePakistan(address);

  return uniqueQueries([
    address.formatted,
    [line1, city, state, postal, skipUsa ? 'Pakistan' : countryName].filter(Boolean).join(', '),
    [line1, city, state, skipUsa ? 'Pakistan' : countryName].filter(Boolean).join(', '),
    [line1, city, countryName === 'USA' && !skipUsa ? '' : countryName || 'Pakistan'].filter(Boolean).join(', '),
    [line1, city].filter(Boolean).join(', '),
    line1,
  ]);
}

function formatAddress(address = {}) {
  const queries = geocodeQueries(address);
  return queries[0] || '';
}

function preferredProviders() {
  const forced = String(process.env.GEOCODE_PROVIDER || 'auto').toLowerCase();
  const googleKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_GEOCODING_API_KEY;
  const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN;
  const available = [];

  if (forced === 'google' && googleKey) {
    return ['google'];
  }
  if (forced === 'mapbox' && mapboxToken) {
    return ['mapbox'];
  }
  if (forced === 'nominatim') {
    return ['nominatim'];
  }

  if (googleKey) {
    available.push('google');
  }
  if (mapboxToken) {
    available.push('mapbox');
  }
  available.push('nominatim');
  return available;
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_MS),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && (body.error_message || body.message);
    throw new Error(message || `Geocode HTTP ${response.status}`);
  }
  return body;
}

async function geocodeGoogle(query) {
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_GEOCODING_API_KEY;
  const url =
    'https://maps.googleapis.com/maps/api/geocode/json?address=' +
    `${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`;
  const body = await fetchJson(url);

  if (body.status !== 'OK' || !body.results || !body.results[0]) {
    throw new Error(body.error_message || body.status || 'Google returned no results');
  }

  const first = body.results[0];
  return {
    latitude: first.geometry.location.lat,
    longitude: first.geometry.location.lng,
    formattedAddress: first.formatted_address || query,
    placeId: first.place_id || '',
    provider: 'google',
  };
}

async function geocodeMapbox(query) {
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  const url =
    'https://api.mapbox.com/geocoding/v5/mapbox.places/' +
    `${encodeURIComponent(query)}.json?limit=1&access_token=${encodeURIComponent(token)}`;
  const body = await fetchJson(url);
  const first = body.features && body.features[0];
  if (!first || !Array.isArray(first.center) || first.center.length < 2) {
    throw new Error('Mapbox returned no results');
  }

  return {
    latitude: first.center[1],
    longitude: first.center[0],
    formattedAddress: first.place_name || query,
    placeId: first.id || '',
    provider: 'mapbox',
  };
}

async function geocodeNominatim(query, countryCode) {
  const agent = process.env.GEOCODE_USER_AGENT || 'RoofCheck/1.0 (job-geocoding)';
  const country = countryCode && countryCode !== 'US' ? `&countrycodes=${encodeURIComponent(countryCode.toLowerCase())}` : '';
  const url =
    'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' +
    `${encodeURIComponent(query)}${country}`;
  const body = await fetchJson(url, {
    'User-Agent': agent,
    Accept: 'application/json',
  });
  const first = Array.isArray(body) ? body[0] : null;
  if (!first || first.lat == null || first.lon == null) {
    throw new Error('OpenStreetMap returned no results');
  }

  return {
    latitude: Number(first.lat),
    longitude: Number(first.lon),
    formattedAddress: first.display_name || query,
    placeId: first.place_id ? String(first.place_id) : '',
    provider: 'nominatim',
  };
}

function isValidCoord(latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

async function geocodeAddress(address) {
  const queries = geocodeQueries(address);
  if (!queries.length) {
    return { ok: false, error: 'Address is empty', provider: '' };
  }

  const countryCode = resolveCountry(address);
  const errors = [];

  for (const query of queries) {
    for (const name of preferredProviders()) {
      try {
        const result =
          name === 'nominatim'
            ? await geocodeNominatim(query, countryCode)
            : await (name === 'google' ? geocodeGoogle(query) : geocodeMapbox(query));
        if (!isValidCoord(result.latitude, result.longitude)) {
          throw new Error('Provider returned invalid coordinates');
        }
        return { ok: true, ...result };
      } catch (error) {
        errors.push(`${name}: ${error.message}`);
      }
    }
  }

  return {
    ok: false,
    error: errors[0] || 'Geocoding failed',
    provider: preferredProviders()[0] || '',
  };
}

function applyGeocodeResult(doc, result) {
  if (!doc) {
    return doc;
  }

  if (result.ok) {
    doc.applyGeocode(result);
    if (result.formattedAddress && doc.address) {
      doc.address.formatted = result.formattedAddress;
    }
    return doc;
  }

  doc.geocode.status = GEOCODE_STATUSES.FAILED;
  doc.geocode.error = result.error || 'Geocoding failed';
  doc.geocode.provider = result.provider || doc.geocode.provider;
  doc.geocode.geocodedAt = new Date();
  return doc;
}

function needsGeocode(doc) {
  if (!doc || !doc.geocode) {
    return true;
  }
  if (doc.geocode.latitude != null && doc.geocode.longitude != null) {
    return false;
  }
  return true;
}

async function geocodeAndSave(docs, address) {
  const list = (Array.isArray(docs) ? docs : [docs]).filter(
    (doc) => doc && typeof doc.applyGeocode === 'function' && typeof doc.save === 'function'
  );
  const pending = list.filter(needsGeocode);
  if (!pending.length) {
    return list[0];
  }

  const result = await geocodeAddress(address || pending[0].address);
  await Promise.all(
    pending.map(async (doc) => {
      applyGeocodeResult(doc, result);
      await doc.save();
    })
  );
  return list[0];
}

module.exports = {
  formatAddress,
  geocodeAddress,
  applyGeocodeResult,
  geocodeAndSave,
  isValidCoord,
};
