'use strict';

const mongoose = require('mongoose');
const { Job, WeatherVerification } = require('../models');
const { USER_ROLES, WEATHER_MATCH_STATUSES, WEATHER_EVENT_TYPES } = require('../models/enums');
const HttpError = require('../utils/httpError');
const env = require('../config/env');

const REQUEST_MS = 10000;
const HAIL_CODES = new Set([96, 99]);
const THUNDER_CODES = new Set([95, 96, 99]);

function toYmd(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatStormDate(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatWind(mph) {
  if (mph == null || !Number.isFinite(mph)) return '—';
  return `${Math.round(mph)} mph`;
}

function formatRain(inches) {
  if (inches == null || !Number.isFinite(inches)) return '—';
  return `${inches.toFixed(2)} in`;
}

function maxNumber(values) {
  const nums = (values || []).map(Number).filter((value) => Number.isFinite(value));
  return nums.length ? Math.max(...nums) : null;
}

function addressLabel(address = {}) {
  if (address.formatted && address.formatted.trim()) {
    return address.formatted.trim();
  }
  return [address.line1, address.city, address.state, address.postalCode, address.country]
    .filter(Boolean)
    .join(', ');
}

function matchCopy(status) {
  if (status === WEATHER_MATCH_STATUSES.MATCH) {
    return {
      badgeTitle: 'Storm Date Verified',
      badgeSub: 'Weather lookup complete',
      weather: 'Storm Detected',
      stormMatch: 'Verified',
    };
  }
  if (status === WEATHER_MATCH_STATUSES.MISMATCH) {
    return {
      badgeTitle: 'No Matching Storm',
      badgeSub: 'No supporting storm found for this date and address',
      weather: 'No Storm Detected',
      stormMatch: 'Mismatch',
    };
  }
  if (status === WEATHER_MATCH_STATUSES.INCONCLUSIVE) {
    return {
      badgeTitle: 'Inconclusive',
      badgeSub: 'Some weather activity, but not a clear storm match',
      weather: 'Inconclusive',
      stormMatch: 'Inconclusive',
    };
  }
  return {
    badgeTitle: 'Weather Data Unavailable',
    badgeSub: 'Could not load historical weather for this location',
    weather: 'No Data',
    stormMatch: 'No Data',
  };
}

function decideMatch({ hailFound, thunderFound, windMph, rainIn }) {
  const wind = windMph || 0;
  const rain = rainIn || 0;

  if (hailFound || (thunderFound && (wind >= 25 || rain >= 0.25)) || wind >= 50 || rain >= 1) {
    return WEATHER_MATCH_STATUSES.MATCH;
  }
  if (thunderFound || wind >= 20 || rain >= 0.1) {
    return WEATHER_MATCH_STATUSES.INCONCLUSIVE;
  }
  return WEATHER_MATCH_STATUSES.MISMATCH;
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_MS) });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && (body.reason || body.error || body.message);
    throw new Error(message || `Weather HTTP ${response.status}`);
  }
  return body;
}

function buildOpenMeteoUrl(base, latitude, longitude, startDate, endDate) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    start_date: startDate,
    end_date: endDate,
    daily: 'weather_code,precipitation_sum,rain_sum,wind_speed_10m_max,wind_gusts_10m_max',
    hourly: 'weather_code,precipitation,rain,wind_speed_10m,wind_gusts_10m',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: 'UTC',
  });
  return `${base}?${params.toString()}`;
}

async function fetchOpenMeteo(latitude, longitude, startDate, endDate) {
  const archiveUrl = buildOpenMeteoUrl(
    'https://archive-api.open-meteo.com/v1/archive',
    latitude,
    longitude,
    startDate,
    endDate
  );

  try {
    return await fetchJson(archiveUrl);
  } catch (error) {
    const forecastUrl = buildOpenMeteoUrl(
      'https://historical-forecast-api.open-meteo.com/v1/forecast',
      latitude,
      longitude,
      startDate,
      endDate
    );
    try {
      return await fetchJson(forecastUrl);
    } catch {
      throw error;
    }
  }
}

function collectEvents(payload, dateOfLoss) {
  const hourly = payload.hourly || {};
  const times = hourly.time || [];
  const codes = hourly.weather_code || [];
  const rain = hourly.rain || hourly.precipitation || [];
  const wind = hourly.wind_gusts_10m || hourly.wind_speed_10m || [];

  const events = [];
  let hailFound = false;
  let thunderFound = false;
  let peakWind = maxNumber(payload.daily?.wind_gusts_10m_max || payload.daily?.wind_speed_10m_max);
  let peakRain = maxNumber(payload.daily?.precipitation_sum || payload.daily?.rain_sum);
  let stormAt = dateOfLoss;

  times.forEach((stamp, index) => {
    const code = Number(codes[index]);
    const rainIn = Number(rain[index]);
    const windMph = Number(wind[index]);
    const occurredAt = new Date(stamp);

    if (HAIL_CODES.has(code)) {
      hailFound = true;
      thunderFound = true;
      stormAt = occurredAt;
      events.push({
        occurredAt,
        type: WEATHER_EVENT_TYPES.HAIL,
        magnitude: `WMO ${code}`,
        distanceMiles: 0,
        sourceEventId: stamp,
        raw: { weatherCode: code },
      });
    } else if (THUNDER_CODES.has(code)) {
      thunderFound = true;
      stormAt = occurredAt;
      events.push({
        occurredAt,
        type: WEATHER_EVENT_TYPES.WIND,
        magnitude: Number.isFinite(windMph) ? `${Math.round(windMph)} mph` : '',
        distanceMiles: 0,
        sourceEventId: stamp,
        raw: { weatherCode: code },
      });
    }

    if (Number.isFinite(windMph) && (peakWind == null || windMph > peakWind)) {
      peakWind = windMph;
    }
    if (Number.isFinite(rainIn) && (peakRain == null || rainIn > peakRain)) {
      peakRain = rainIn;
    }
  });

  if (peakWind != null) {
    events.push({
      occurredAt: stormAt || dateOfLoss,
      type: WEATHER_EVENT_TYPES.WIND,
      magnitude: formatWind(peakWind),
      distanceMiles: 0,
      sourceEventId: 'peak_wind',
    });
  }
  if (peakRain != null) {
    events.push({
      occurredAt: stormAt || dateOfLoss,
      type: WEATHER_EVENT_TYPES.RAIN,
      magnitude: formatRain(peakRain),
      distanceMiles: 0,
      sourceEventId: 'peak_rain',
    });
  }

  return { events, hailFound, thunderFound, peakWind, peakRain, stormAt };
}

function toWeatherResponse(doc) {
  const data = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const copy = matchCopy(data.matchStatus);
  const hailEvent = (data.events || []).find((event) => event.type === WEATHER_EVENT_TYPES.HAIL);
  const windEvent = (data.events || []).find((event) => event.type === WEATHER_EVENT_TYPES.WIND);
  const rainEvent = (data.events || []).find((event) => event.type === WEATHER_EVENT_TYPES.RAIN);
  const snapshot = data.snapshot || {};

  return {
    id: String(data._id),
    jobId: String(data.jobId),
    provider: data.provider,
    matchStatus: data.matchStatus,
    dateOfLoss: data.dateOfLoss,
    lookedUpAt: data.lookedUpAt,
    address: data.address,
    location: data.location,
    mismatchNote: data.mismatchNote || '',
    summary: {
      badgeTitle: copy.badgeTitle,
      badgeSub: data.mismatchNote || copy.badgeSub,
      stormDate: formatStormDate(snapshot.stormAt || data.dateOfLoss),
      weather: copy.weather,
      hail: hailEvent ? 'Hail Event Found' : copy.weather === 'No Data' ? '—' : 'No Hail Event',
      wind: windEvent?.magnitude || formatWind(snapshot.windMph),
      rain: rainEvent?.magnitude || formatRain(snapshot.rainIn),
      stormMatch: copy.stormMatch,
    },
    events: data.events || [],
  };
}

async function findJobForUser(user, jobId) {
  if (!mongoose.isValidObjectId(jobId)) {
    throw new HttpError(400, 'Valid jobId is required');
  }

  const filter = { _id: jobId, companyId: user.companyId };
  if (user.role === USER_ROLES.INSPECTOR) {
    filter.assignedTo = user._id;
  }

  const job = await Job.findOne(filter);
  if (!job) {
    throw new HttpError(404, 'Job not found');
  }
  return job;
}

function jobCoordinates(job) {
  const latitude = job.geocode?.latitude ?? job.latitude;
  const longitude = job.geocode?.longitude ?? job.longitude;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return null;
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return { latitude, longitude };
}

async function lookupOpenMeteo(job) {
  const coords = jobCoordinates(job);
  const dateOfLoss = job.claim?.dateOfLoss;
  if (!coords) {
    throw new Error('Job has no geocoded coordinates');
  }
  if (!dateOfLoss) {
    throw new Error('Job has no date of loss');
  }

  const windowDays = Math.max(0, env.weatherWindowDays);
  const startDate = toYmd(addUtcDays(dateOfLoss, -windowDays));
  const endDate = toYmd(addUtcDays(dateOfLoss, windowDays));
  const payload = await fetchOpenMeteo(coords.latitude, coords.longitude, startDate, endDate);
  const collected = collectEvents(payload, dateOfLoss);
  const matchStatus = decideMatch({
    hailFound: collected.hailFound,
    thunderFound: collected.thunderFound,
    windMph: collected.peakWind,
    rainIn: collected.peakRain,
  });

  return {
    provider: 'open_meteo',
    matchStatus,
    events: collected.events,
    snapshot: {
      startDate,
      endDate,
      stormAt: collected.stormAt,
      hailFound: collected.hailFound,
      thunderFound: collected.thunderFound,
      windMph: collected.peakWind,
      rainIn: collected.peakRain,
      daily: payload.daily || {},
    },
    mismatchNote:
      matchStatus === WEATHER_MATCH_STATUSES.MATCH
        ? 'Historical weather lookup complete'
        : matchStatus === WEATHER_MATCH_STATUSES.MISMATCH
          ? 'No hail, thunderstorm, or high wind found for this date window'
          : '',
    location: { type: 'Point', coordinates: [coords.longitude, coords.latitude] },
  };
}

async function saveVerification(job, user, lookup, errorMessage) {
  const record = await WeatherVerification.create({
    companyId: job.companyId,
    jobId: job._id,
    propertyId: job.propertyId || null,
    lookedUpAt: new Date(),
    dateOfLoss: job.claim.dateOfLoss,
    address: job.address,
    location: lookup?.location,
    provider: lookup?.provider || env.weatherProvider,
    matchStatus: lookup?.matchStatus || WEATHER_MATCH_STATUSES.NO_DATA,
    mismatchNote: errorMessage || lookup?.mismatchNote || '',
    events: lookup?.events || [],
    snapshot: lookup?.snapshot,
    createdBy: user._id,
  });

  return toWeatherResponse(record);
}

function isFresh(record, dateOfLoss) {
  if (!record) return false;
  if (toYmd(record.dateOfLoss) !== toYmd(dateOfLoss)) return false;
  const ageMs = Date.now() - new Date(record.lookedUpAt).getTime();
  return ageMs < env.weatherCacheTtlHours * 60 * 60 * 1000;
}

async function verifyForJob(user, jobId, { force = false } = {}) {
  const job = await findJobForUser(user, jobId);
  if (!job.claim?.dateOfLoss) {
    throw new HttpError(400, 'This job has no date of loss');
  }
  if (!jobCoordinates(job)) {
    throw new HttpError(400, 'Job address has not been geocoded yet');
  }

  if (!force) {
    const existing = await WeatherVerification.findOne({
      companyId: user.companyId,
      jobId: job._id,
    }).sort({ lookedUpAt: -1 });
    if (isFresh(existing, job.claim.dateOfLoss)) {
      return toWeatherResponse(existing);
    }
  }

  try {
    const lookup = await lookupOpenMeteo(job);
    return saveVerification(job, user, lookup);
  } catch (error) {
    return saveVerification(job, user, null, error.message || 'Weather lookup failed');
  }
}

async function getForJob(user, jobId) {
  const job = await findJobForUser(user, jobId);
  const existing = await WeatherVerification.findOne({
    companyId: user.companyId,
    jobId: job._id,
  }).sort({ lookedUpAt: -1 });

  if (existing) {
    return toWeatherResponse(existing);
  }
  return verifyForJob(user, jobId);
}

module.exports = {
  verifyForJob,
  getForJob,
  toWeatherResponse,
};
