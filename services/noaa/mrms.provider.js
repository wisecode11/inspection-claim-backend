'use strict';

const zlib = require('zlib');

const { fetchBuffer } = require('./http');
const grib2 = require('./grib2');

/**
 * NOAA MRMS MESH (Maximum Estimated Size of Hail) from the NOAA Open Data archive on AWS.
 * We use the 24-hour maximum product: the file stamped D+1 00:00 UTC holds the largest
 * radar-estimated hail size in each ~1 km cell during UTC day D. Values are millimetres.
 * Radar ESTIMATES, not ground measurements.
 */
const SOURCE = 'noaa_mrms_mesh';
const BASE_URL = 'https://noaa-mrms-pds.s3.amazonaws.com/CONUS/MESH_Max_1440min_00.50';
const DAY_MS = 24 * 60 * 60 * 1000;

function ymd(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

/** URL of the 24 h max file covering UTC day `day` (stamped at the following midnight). */
function dailyMaxUrl(day) {
  const stamp = new Date(day.getTime() + DAY_MS);
  return `${BASE_URL}/${ymd(stamp)}/MRMS_MESH_Max_1440min_00.50_${ymd(stamp)}-000000.grib2.gz`;
}

/** UTC days (midnights) touched by [start, end]. */
function daysIn(start, end) {
  const first = new Date(start);
  first.setUTCHours(0, 0, 0, 0);
  const days = [];
  for (let t = first.getTime(); t <= new Date(end).getTime(); t += DAY_MS) days.push(new Date(t));
  return days;
}

/**
 * Maximum MESH per cell inside `bounds` over the days of the loss window.
 * Days whose file doesn't exist yet (today) or is missing are skipped and reported.
 */
async function fetchMeshMax({ bounds, start, end, now = new Date() }) {
  const files = [];
  const missing = [];
  let combined = null;

  for (const day of daysIn(start, end)) {
    const url = dailyMaxUrl(day);
    if (day.getTime() + DAY_MS > now.getTime()) {
      missing.push({ day: day.toISOString().slice(0, 10), reason: 'day not complete yet' });
      continue;
    }
    let buffer;
    try {
      buffer = zlib.gunzipSync(await fetchBuffer(url, { timeoutMs: 60000 }));
    } catch (error) {
      missing.push({ day: day.toISOString().slice(0, 10), reason: String(error.message).slice(0, 120) });
      continue;
    }
    const window = grib2.readWindow(buffer, bounds);
    files.push({ day: day.toISOString().slice(0, 10), url });
    if (!combined) {
      combined = window;
    } else {
      for (let i = 0; i < combined.values.length; i++) {
        if (window.values[i] > combined.values[i]) combined.values[i] = window.values[i];
      }
    }
  }

  if (!combined) {
    throw new Error(`No MRMS MESH files available for the loss window (${missing.map((m) => m.day).join(', ')})`);
  }
  return { source: SOURCE, grid: combined, files, missing };
}

module.exports = { SOURCE, fetchMeshMax, dailyMaxUrl, daysIn };
