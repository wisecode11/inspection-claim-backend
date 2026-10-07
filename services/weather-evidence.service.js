'use strict';

const lsr = require('./noaa/lsr.provider');
const spc = require('./noaa/spc.provider');
const swdi = require('./noaa/swdi.provider');
const stormEvents = require('./noaa/storm-events');
const mrms = require('./noaa/mrms.provider');
const swath = require('./noaa/swath');

/**
 * Weather evidence for a property + date of loss, built from NOAA sources and labelled by
 * strength of evidence:
 *
 *   observed         — NWS Local Storm Reports (SPC reports as fallback): someone saw/measured it
 *   radar_estimated  — SWDI NEXRAD hail signatures: radar algorithm estimate
 *   model_indicated  — Open-Meteo weather model only (supporting; never "verified")
 *   none             — sources answered, nothing found
 *   unavailable      — live NOAA sources could not be reached
 *
 * Plus official history (NCEI Storm Events, ingested locally) for the years before the loss.
 * The whole result is stored as the verification snapshot so a report can be reproduced.
 */
// v2: MRMS MESH hail swath + estimated hail size at the property.
const EVIDENCE_VERSION = 2;
/** Smallest MESH (inches) treated as radar evidence of hail. */
const MESH_EVIDENCE_IN = 0.5;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_STORED = { observed: 100, radar: 200, history: 200 };

const SOURCE_NAMES = {
  [lsr.SOURCE]: 'NWS Local Storm Reports (via Iowa Environmental Mesonet)',
  [spc.SOURCE]: 'NOAA Storm Prediction Center storm reports',
  [swdi.SOURCE]: 'NOAA NCEI SWDI — NEXRAD Level III hail signatures',
  [stormEvents.SOURCE]: 'NOAA NCEI Storm Events Database',
  [mrms.SOURCE]: 'NOAA MRMS MESH — Maximum Estimated Size of Hail (24 h max)',
  open_meteo: 'Open-Meteo historical weather model',
};

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function inches(value) {
  return `${Number(value).toFixed(2)}"`;
}

/** Date-of-loss window in UTC: whole days, widened by `windowDays` on each side. */
function lossWindow(dateOfLoss, windowDays) {
  const day = new Date(dateOfLoss);
  day.setUTCHours(0, 0, 0, 0);
  return {
    start: new Date(day.getTime() - windowDays * DAY_MS),
    end: new Date(day.getTime() + (windowDays + 1) * DAY_MS - 1000),
  };
}

function largest(items, key) {
  return items.reduce((best, item) => (item[key] != null && (!best || item[key] > best[key]) ? item : best), null);
}

function sourceEntry(id, evidence, settled, extra = {}) {
  if (settled.status === 'fulfilled') {
    return {
      id,
      name: SOURCE_NAMES[id],
      evidence,
      status: 'ok',
      query: settled.value.query,
      totalInWindow: settled.value.totalInWindow ?? null,
      ...extra,
    };
  }
  return {
    id,
    name: SOURCE_NAMES[id],
    evidence,
    status: 'error',
    error: String(settled.reason?.message || settled.reason || 'Request failed').slice(0, 300),
    ...extra,
  };
}

/** Observed reports: LSR first; SPC only if LSR fails (SPC is built from LSRs, so never both). */
async function fetchObserved(params) {
  try {
    return { primary: await lsr.fetchReports(params), fallbackError: null };
  } catch (error) {
    const fallback = await spc.fetchReports(params);
    return { primary: fallback, fallbackError: error };
  }
}

/** The evidence-level decision ladder. */
function decideLevel({ observedOk, radarOk, observed, radar, model, meshMaxIn = null }) {
  if (observed.length) return 'observed';
  if (radar.length || (meshMaxIn ?? 0) >= MESH_EVIDENCE_IN) return 'radar_estimated';
  if (model?.hailFound || model?.thunderFound) return 'model_indicated';
  if (!observedOk && !radarOk) return 'unavailable';
  return 'none';
}

function headlineFor(level, { observedHail, observedWind, observedTornado, radar, radiusMiles, mesh = null }) {
  if (level === 'observed') {
    const parts = [];
    const bigHail = largest(observedHail, 'hailSizeIn');
    if (observedHail.length) {
      parts.push(
        `${observedHail.length} hail report${observedHail.length === 1 ? '' : 's'}` +
          (bigHail ? `, largest ${inches(bigHail.hailSizeIn)} (${bigHail.distanceMiles} mi ${bigHail.direction}, ${formatDate(bigHail.occurredAt)})` : '')
      );
    }
    if (observedWind.length) {
      const bigWind = largest(observedWind, 'windMph');
      parts.push(
        `${observedWind.length} wind report${observedWind.length === 1 ? '' : 's'}` +
          (bigWind ? `, strongest ${Math.round(bigWind.windMph)} mph` : '')
      );
    }
    if (observedTornado.length) parts.push(`${observedTornado.length} tornado report${observedTornado.length === 1 ? '' : 's'}`);
    return `Observed storm reports within ${radiusMiles} mi of the property: ${parts.join('; ')}.`;
  }
  if (level === 'radar_estimated') {
    const big = largest(radar, 'hailSizeIn');
    const parts = [];
    if (big) {
      parts.push(`NEXRAD hail signatures up to ${inches(big.hailSizeIn)} (${big.distanceMiles} mi ${big.direction}, ${formatDate(big.occurredAt)})`);
    }
    if (mesh?.maxWithinRadiusIn) {
      parts.push(
        `MRMS estimated hail up to ${inches(mesh.maxWithinRadiusIn)}` +
          (mesh.atPropertyIn ? `, ${inches(mesh.atPropertyIn)} at the property` : '')
      );
    }
    return `No ground reports within ${radiusMiles} mi, but radar indicates hail nearby: ${parts.join('; ')}. Radar values are estimates, not ground measurements.`;
  }
  if (level === 'model_indicated') {
    return 'Not verified: only the weather model indicates thunderstorm/hail conditions. No observed reports or radar hail signatures were found near the property.';
  }
  if (level === 'unavailable') {
    return 'NOAA storm report and radar services could not be reached; weather evidence is incomplete.';
  }
  return `No hail, damaging-wind or tornado reports and no radar hail signatures were found within ${radiusMiles} mi for the date window.`;
}

/**
 * Builds the evidence object.
 * @param {object} args
 * @param {{latitude:number, longitude:number}} args.origin
 * @param {Date|string} args.dateOfLoss
 * @param {object} args.config  { windowDays, eventRadiusMiles, historyRadiusMiles, historyYears }
 * @param {object} [args.model] Open-Meteo summary { hailFound, thunderFound, windMph, rainIn }
 * @param {object} [args.StormEvent] mongoose model for the ingested NCEI history
 */
async function buildEvidence({ origin, dateOfLoss, config, model = null, StormEvent = null }) {
  const { start, end } = lossWindow(dateOfLoss, config.windowDays);
  const params = { origin, start, end, radiusMiles: config.eventRadiusMiles };

  const bounds = swath.mapBounds(origin, config.eventRadiusMiles);
  const [observedSettled, radarSettled, historySettled, swathSettled] = await Promise.allSettled([
    fetchObserved(params),
    swdi.fetchDetections(params),
    StormEvent
      ? stormEvents.queryHistory(StormEvent, {
          origin,
          until: end,
          years: config.historyYears,
          radiusMiles: config.historyRadiusMiles,
        })
      : Promise.reject(new Error('Storm Events history is not configured')),
    // MRMS swath: daily 24 h max grids over the loss window, cropped to the map area.
    mrms.fetchMeshMax({ bounds, start, end }).then(async (result) => ({
      ...(await swath.buildSwath(result.grid, { origin, radiusMiles: config.eventRadiusMiles })),
      files: result.files,
      missing: result.missing,
    })),
  ]);
  const swathResult = swathSettled.status === 'fulfilled' ? swathSettled.value : null;

  const observedResult = observedSettled.status === 'fulfilled' ? observedSettled.value.primary : null;
  const observed = observedResult?.reports || [];
  const radar = radarSettled.status === 'fulfilled' ? radarSettled.value.detections : [];
  const history = historySettled.status === 'fulfilled' ? historySettled.value : null;

  const observedHail = observed.filter((r) => r.type === 'hail');
  const observedWind = observed.filter((r) => r.type === 'wind');
  const observedTornado = observed.filter((r) => r.type === 'tornado');

  const level = decideLevel({
    observedOk: observedSettled.status === 'fulfilled',
    radarOk: radarSettled.status === 'fulfilled',
    observed,
    radar,
    model,
    meshMaxIn: swathResult?.maxWithinRadiusIn ?? null,
  });

  const sources = [];
  if (observedSettled.status === 'fulfilled') {
    const { primary, fallbackError } = observedSettled.value;
    if (fallbackError) {
      sources.push({ id: lsr.SOURCE, name: SOURCE_NAMES[lsr.SOURCE], evidence: 'observed', status: 'error', error: String(fallbackError.message).slice(0, 300) });
    }
    sources.push(sourceEntry(primary.source, 'observed', { status: 'fulfilled', value: primary }));
  } else {
    sources.push(sourceEntry(lsr.SOURCE, 'observed', observedSettled));
  }
  sources.push(sourceEntry(swdi.SOURCE, 'radar_estimated', radarSettled));
  sources.push(
    swathResult
      ? {
          id: mrms.SOURCE,
          name: SOURCE_NAMES[mrms.SOURCE],
          evidence: 'radar_estimated',
          status: 'ok',
          files: swathResult.files.map((f) => f.day),
          ...(swathResult.missing.length ? { error: `No data for ${swathResult.missing.map((m) => m.day).join(', ')}` } : {}),
        }
      : sourceEntry(mrms.SOURCE, 'radar_estimated', swathSettled)
  );
  if (history) {
    sources.push({
      id: stormEvents.SOURCE,
      name: SOURCE_NAMES[stormEvents.SOURCE],
      evidence: 'official_record',
      status: history.coverageThrough ? 'ok' : 'not_ingested',
      query: history.query,
      coverageThrough: history.coverageThrough,
      ...(history.coverageThrough ? {} : { error: 'Storm Events history has not been ingested (npm run ingest:storm-events)' }),
    });
  } else {
    sources.push(sourceEntry(stormEvents.SOURCE, 'official_record', historySettled));
  }
  if (model) {
    sources.push({ id: 'open_meteo', name: SOURCE_NAMES.open_meteo, evidence: 'model_indicated', status: 'ok' });
  }

  const nearestBy = (items) => items[0] || null; // lists are nearest-first

  return {
    version: EVIDENCE_VERSION,
    generatedAt: new Date().toISOString(),
    query: {
      latitude: origin.latitude,
      longitude: origin.longitude,
      dateOfLoss: new Date(dateOfLoss).toISOString(),
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      eventRadiusMiles: config.eventRadiusMiles,
      historyRadiusMiles: config.historyRadiusMiles,
      historyYears: config.historyYears,
    },
    level,
    headline: headlineFor(level, {
      observedHail,
      observedWind,
      observedTornado,
      radar,
      radiusMiles: config.eventRadiusMiles,
      mesh: swathResult,
    }),
    hail: {
      observed: {
        count: observedHail.length,
        maxSizeIn: largest(observedHail, 'hailSizeIn')?.hailSizeIn ?? null,
        nearest: nearestBy(observedHail),
      },
      radar: {
        count: radar.length,
        maxSizeIn: largest(radar, 'hailSizeIn')?.hailSizeIn ?? null,
        nearest: nearestBy(radar),
      },
      mesh: swathResult
        ? {
            atPropertyIn: swathResult.atPropertyIn,
            maxWithinRadiusIn: swathResult.maxWithinRadiusIn,
            maxWithinRadiusAt: swathResult.maxWithinRadiusAt,
          }
        : null,
    },
    // Hail swath polygons (MRMS MESH bands, lon/lat) and the map box they were cut to.
    swath: swathResult
      ? {
          source: mrms.SOURCE,
          bounds,
          aspect: swath.MAP_ASPECT,
          thresholdsIn: swathResult.thresholdsIn,
          bands: swathResult.bands,
          resolutionDeg: swathResult.resolutionDeg,
          days: swathResult.files.map((f) => f.day),
        }
      : null,
    wind: {
      observed: {
        count: observedWind.length,
        maxMph: largest(observedWind, 'windMph')?.windMph ?? null,
        nearest: nearestBy(observedWind),
      },
    },
    tornado: { observed: { count: observedTornado.length, nearest: nearestBy(observedTornado) } },
    observedReports: observed.slice(0, MAX_STORED.observed),
    radarDetections: radar.slice(0, MAX_STORED.radar),
    history: history
      ? {
          years: config.historyYears,
          radiusMiles: config.historyRadiusMiles,
          since: history.query.since,
          until: history.query.until,
          coverageThrough: history.coverageThrough,
          counts: history.counts,
          totalEvents: history.events.length,
          events: history.events.slice(0, MAX_STORED.history),
        }
      : null,
    model: model
      ? {
          hailCodeFound: Boolean(model.hailFound),
          thunderFound: Boolean(model.thunderFound),
          windMph: model.windMph ?? null,
          rainIn: model.rainIn ?? null,
        }
      : null,
    sources,
  };
}

module.exports = {
  EVIDENCE_VERSION,
  buildEvidence,
  decideLevel,
  headlineFor,
  lossWindow,
  SOURCE_NAMES,
};
