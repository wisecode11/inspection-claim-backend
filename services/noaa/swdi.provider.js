'use strict';

const { fetchJson } = require('./http');
const { bboxAround, withinRadius } = require('./geo');

/**
 * NCEI Severe Weather Data Inventory (SWDI) — `nx3hail`: NEXRAD Level III hail-index
 * signatures. Each row is one radar scan's estimate for a storm cell: maximum estimated
 * hail size (inches), probability of hail and of severe hail. These are radar ESTIMATES,
 * not ground observations.
 *
 * Notes from testing the live service:
 * - `center`/`radius` parameters are ignored for this dataset (results come back nationwide),
 *   so we query with `bbox` and then filter by true distance.
 * - Date ranges are YYYYMMDD:YYYYMMDD and must stay within 31 days per request.
 */
const SOURCE = 'ncei_swdi_nx3hail';
const BASE_URL = 'https://www.ncei.noaa.gov/swdiws/json/nx3hail';

function ymd(date) {
  return new Date(date).toISOString().slice(0, 10).replace(/-/g, '');
}

/** Parses "POINT (lon lat)". */
function parsePoint(shape) {
  const match = /POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i.exec(String(shape || ''));
  if (!match) return null;
  return { longitude: Number(match[1]), latitude: Number(match[2]) };
}

function normalizeRow(row) {
  const point = parsePoint(row?.SHAPE);
  if (!point) return null;
  const maxSize = Number(row.MAXSIZE);
  const prob = Number(row.PROB);
  const sevProb = Number(row.SEVPROB);
  return {
    source: SOURCE,
    evidence: 'radar_estimated',
    type: 'hail',
    occurredAt: new Date(row.ZTIME).toISOString(),
    latitude: point.latitude,
    longitude: point.longitude,
    hailSizeIn: Number.isFinite(maxSize) ? maxSize : null,
    magnitudeLabel: Number.isFinite(maxSize) ? `${maxSize.toFixed(2)}" est. max hail` : 'Hail signature',
    probability: Number.isFinite(prob) ? prob : null,
    severeProbability: Number.isFinite(sevProb) ? sevProb : null,
    radar: row.WSR_ID || '',
    providerEventId: [row.WSR_ID, row.CELL_ID, row.ZTIME].join('|'),
  };
}

async function fetchDetections({ origin, start, end, radiusMiles }) {
  const box = bboxAround(origin, radiusMiles);
  const bbox = [box.minLon, box.minLat, box.maxLon, box.maxLat].map((v) => v.toFixed(4)).join(',');
  // SWDI's end date is exclusive at day granularity — add a day so the window's last day is included.
  const endPlusDay = new Date(new Date(end).getTime() + 24 * 60 * 60 * 1000);
  const url = `${BASE_URL}/${ymd(start)}:${ymd(endPlusDay)}?bbox=${bbox}`;
  const body = await fetchJson(url, { timeoutMs: 30000 });
  if (body?.error) throw new Error(`SWDI: ${body.error}`);
  const rows = Array.isArray(body?.result) ? body.result : [];

  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const detections = rows
    .map(normalizeRow)
    .filter(Boolean)
    .filter((d) => {
      const t = new Date(d.occurredAt).getTime();
      return t >= startMs && t <= endMs;
    });

  return {
    source: SOURCE,
    query: { url, start: new Date(start).toISOString(), end: new Date(end).toISOString(), radiusMiles },
    totalInWindow: detections.length,
    detections: withinRadius(origin, detections, radiusMiles),
  };
}

module.exports = { SOURCE, fetchDetections, normalizeRow, parsePoint };
