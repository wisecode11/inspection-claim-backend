'use strict';

const { fetchJson } = require('./http');
const { withinRadius } = require('./geo');

/**
 * NWS Local Storm Reports (LSR) — preliminary reports from spotters, emergency managers,
 * the public, etc., issued by local NWS offices within minutes/hours of a storm.
 * Served as GeoJSON by the Iowa Environmental Mesonet (IEM) LSR archive.
 */
const SOURCE = 'nws_lsr';
const IEM_URL = 'https://mesonet.agron.iastate.edu/geojson/lsr.php';

function iemStamp(date) {
  // YYYYMMDDHHMI in UTC
  return new Date(date).toISOString().replace(/[-:T]/g, '').slice(0, 12);
}

/** Maps an LSR type text to our storm type, or null for types we don't use (rain, flood, marine…). */
function lsrType(typetext) {
  const text = String(typetext || '').toUpperCase();
  if (text === 'HAIL') return 'hail';
  if (text === 'TORNADO') return 'tornado';
  if (/^(TSTM|NON-TSTM) WND (GST|DMG)$/.test(text)) return 'wind';
  return null;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Normalizes one IEM LSR GeoJSON feature; returns null when unusable. */
function normalizeFeature(feature) {
  const p = feature?.properties || {};
  const type = lsrType(p.typetext);
  if (!type) return null;
  const [longitude, latitude] = feature.geometry?.coordinates || [p.lon, p.lat];
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const magnitude = toNumber(p.magf ?? p.magnitude);
  const unit = String(p.unit || '').toLowerCase();
  const report = {
    source: SOURCE,
    evidence: 'observed',
    type,
    occurredAt: new Date(p.valid).toISOString(),
    latitude,
    longitude,
    measured: p.qualifier === 'M' ? true : p.qualifier === 'E' ? false : null,
    reporter: p.source || '',
    location: [p.city, p.county && `${p.county} Co.`, p.st || p.state].filter(Boolean).join(', '),
    remark: String(p.remark || '').slice(0, 300),
    providerEventId: [p.product_id, p.valid, latitude, longitude].join('|'),
  };

  if (type === 'hail' && magnitude != null && unit.startsWith('inch')) {
    report.hailSizeIn = magnitude;
    report.magnitudeLabel = `${magnitude.toFixed(2)}" hail`;
  } else if (type === 'wind' && magnitude != null && unit === 'mph') {
    report.windMph = magnitude;
    report.magnitudeLabel = `${Math.round(magnitude)} mph ${/GST/.test(p.typetext) ? 'gust' : 'wind'}`;
  } else {
    report.magnitudeLabel = type === 'tornado' ? 'Tornado' : 'Wind damage';
  }
  return report;
}

/**
 * LSR hail/wind/tornado reports within `radiusMiles` of the property between `start` and `end`.
 * Queries the whole US for the window (a few days is small) and filters by distance.
 */
async function fetchReports({ origin, start, end, radiusMiles }) {
  const url = `${IEM_URL}?sts=${iemStamp(start)}&ets=${iemStamp(end)}`;
  const body = await fetchJson(url, { timeoutMs: 30000 });
  const features = Array.isArray(body?.features) ? body.features : [];
  const reports = features.map(normalizeFeature).filter(Boolean);
  return {
    source: SOURCE,
    query: { url, start: new Date(start).toISOString(), end: new Date(end).toISOString(), radiusMiles },
    totalInWindow: reports.length,
    reports: withinRadius(origin, reports, radiusMiles),
  };
}

module.exports = { SOURCE, fetchReports, normalizeFeature, lsrType, iemStamp };
