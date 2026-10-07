'use strict';

const { fetchText } = require('./http');
const { withinRadius } = require('./geo');

/**
 * SPC (Storm Prediction Center) daily storm reports — the filtered national list built from
 * NWS Local Storm Reports. Used as a fallback when the IEM LSR feed is unavailable.
 *
 * One "SPC day" runs 12Z on day D to 11:59Z on day D+1. Times are UTC (HHMM).
 * Hail size is in hundredths of an inch (100 = 1.00"). Wind speed is mph or "UNK".
 * The Comments column is unquoted and may contain commas, so it is everything after column 7.
 */
const SOURCE = 'spc_reports';
const BASE_URL = 'https://www.spc.noaa.gov/climo/reports';
const FILES = [
  { suffix: 'hail', type: 'hail' },
  { suffix: 'wind', type: 'wind' },
  { suffix: 'torn', type: 'tornado' },
];
const DAY_MS = 24 * 60 * 60 * 1000;

function yymmdd(date) {
  return new Date(date).toISOString().slice(2, 10).replace(/-/g, '');
}

/** SPC report days (UTC midnight dates) whose 12Z–12Z span overlaps [start, end]. */
function spcDaysFor(start, end) {
  const first = new Date(new Date(start).getTime() - 12 * 60 * 60 * 1000);
  first.setUTCHours(0, 0, 0, 0);
  const last = new Date(new Date(end).getTime() - 12 * 60 * 60 * 1000);
  last.setUTCHours(0, 0, 0, 0);
  const days = [];
  for (let t = first.getTime(); t <= last.getTime(); t += DAY_MS) days.push(new Date(t));
  return days;
}

/** Report time: HHMM ≥ 1200 belongs to day D, earlier times to D+1 (UTC). */
function spcTimestamp(day, hhmm) {
  const text = String(hhmm || '').padStart(4, '0');
  const hours = Number(text.slice(0, 2));
  const minutes = Number(text.slice(2, 4));
  const base = new Date(day.getTime() + (hours < 12 ? DAY_MS : 0));
  base.setUTCHours(hours, minutes, 0, 0);
  return base;
}

/** Parses one SPC CSV file into normalized reports. */
function parseCsv(text, day, type) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim());
  const reports = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    if (cols.length < 7) continue;
    const [time, magnitude, location, county, state, lat, lon] = cols;
    const comments = cols.slice(7).join(',').trim();
    const latitude = Number(lat);
    const longitude = Number(lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

    const occurredAt = spcTimestamp(day, time);
    const report = {
      source: SOURCE,
      evidence: 'observed',
      type,
      occurredAt: occurredAt.toISOString(),
      latitude,
      longitude,
      measured: null,
      reporter: '',
      location: [location, county && `${county} Co.`, state].filter(Boolean).join(', '),
      remark: comments.slice(0, 300),
      providerEventId: [yymmdd(day), type, time, latitude, longitude].join('|'),
    };
    const value = Number(magnitude);
    if (type === 'hail' && Number.isFinite(value)) {
      report.hailSizeIn = value / 100;
      report.magnitudeLabel = `${(value / 100).toFixed(2)}" hail`;
    } else if (type === 'wind' && Number.isFinite(value)) {
      report.windMph = value;
      report.magnitudeLabel = `${Math.round(value)} mph wind`;
    } else if (type === 'tornado') {
      report.torScale = magnitude && magnitude !== 'UNK' ? magnitude : '';
      report.magnitudeLabel = report.torScale ? `Tornado (${report.torScale})` : 'Tornado';
    } else {
      report.magnitudeLabel = type === 'wind' ? 'Wind damage' : type;
    }
    reports.push(report);
  }
  return reports;
}

/** SPC resets connections under parallel load, so files are fetched one at a time with one retry. */
async function fetchCsv(url) {
  try {
    return await fetchText(url, { allowNotFound: true });
  } catch {
    return fetchText(url, { allowNotFound: true });
  }
}

async function fetchReports({ origin, start, end, radiusMiles }) {
  const days = spcDaysFor(start, end);
  const urls = [];
  const batches = [];
  for (const day of days) {
    for (const { suffix, type } of FILES) {
      const url = `${BASE_URL}/${yymmdd(day)}_rpts_${suffix}.csv`;
      urls.push(url);
      const text = await fetchCsv(url);
      batches.push(text ? parseCsv(text, day, type) : []);
    }
  }
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const reports = batches
    .flat()
    .filter((r) => {
      const t = new Date(r.occurredAt).getTime();
      return t >= startMs && t <= endMs;
    });
  return {
    source: SOURCE,
    query: { urls, start: new Date(start).toISOString(), end: new Date(end).toISOString(), radiusMiles },
    totalInWindow: reports.length,
    reports: withinRadius(origin, reports, radiusMiles),
  };
}

module.exports = { SOURCE, fetchReports, parseCsv, spcDaysFor, spcTimestamp, yymmdd };
