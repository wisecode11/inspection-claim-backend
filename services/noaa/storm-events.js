'use strict';

const zlib = require('zlib');

const { fetchBuffer, fetchText } = require('./http');
const { EARTH_RADIUS_MILES, withinRadius } = require('./geo');

/**
 * NCEI Storm Events Database — NOAA's official, NWS-verified record of storm events.
 * Published as yearly CSV files (~13 MB gzipped, ~70k rows) about 2–3 months after the
 * fact, so we ingest them into the `storm_events` collection (StormEvent model) and query
 * locally. Only hail / thunderstorm wind / high wind / tornado rows with coordinates are kept.
 *
 * Times in the file are local standard time; CZ_TIMEZONE gives the offset (e.g. "CST-6").
 * Wind MAGNITUDE is in knots; hail MAGNITUDE is in inches.
 */
const SOURCE = 'ncei_storm_events';
const INDEX_URL = 'https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/';
const KNOTS_TO_MPH = 1.15078;

const EVENT_TYPES = {
  Hail: 'hail',
  'Thunderstorm Wind': 'wind',
  'High Wind': 'wind',
  Tornado: 'tornado',
};

/** RFC 4180 CSV parser (quoted fields, escaped quotes, newlines inside quotes). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** "CST-6" → -6, "EST-5" → -5, "AKST-9" → -9. Returns null when unknown. */
function timezoneOffsetHours(cz) {
  const match = /([+-]?\d+(?:\.\d+)?)\s*$/.exec(String(cz || ''));
  return match ? Number(match[1]) : null;
}

/** Local standard time parts → UTC Date, using the row's timezone offset. */
function toUtc(yearMonth, day, hhmm, offsetHours) {
  const ym = String(yearMonth || '');
  const year = Number(ym.slice(0, 4));
  const month = Number(ym.slice(4, 6));
  const time = String(hhmm || '0').padStart(4, '0');
  if (!year || !month || !Number(day)) return null;
  const utcMs =
    Date.UTC(year, month - 1, Number(day), Number(time.slice(0, 2)), Number(time.slice(2, 4))) -
    (offsetHours || 0) * 60 * 60 * 1000;
  return new Date(utcMs);
}

/** Turns one CSV row (as an object keyed by header) into a normalized event, or null. */
function normalizeRow(r) {
  const type = EVENT_TYPES[r.EVENT_TYPE];
  if (!type) return null;
  const latitude = Number(r.BEGIN_LAT);
  const longitude = Number(r.BEGIN_LON);
  if (!r.BEGIN_LAT || !r.BEGIN_LON || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const offset = timezoneOffsetHours(r.CZ_TIMEZONE);
  const occurredAt = toUtc(r.BEGIN_YEARMONTH, r.BEGIN_DAY, r.BEGIN_TIME, offset);
  const endedAt = toUtc(r.END_YEARMONTH, r.END_DAY, r.END_TIME, offset);
  if (!occurredAt) return null;

  const magnitude = Number(r.MAGNITUDE);
  const event = {
    source: SOURCE,
    evidence: 'official_record',
    type,
    eventType: r.EVENT_TYPE,
    occurredAt: occurredAt.toISOString(),
    endedAt: endedAt ? endedAt.toISOString() : null,
    durationMinutes: endedAt ? Math.max(0, Math.round((endedAt - occurredAt) / 60000)) : null,
    latitude,
    longitude,
    location: [r.BEGIN_LOCATION, r.CZ_NAME, r.STATE].filter(Boolean).join(', '),
    providerEventId: String(r.EVENT_ID),
  };

  if (type === 'hail' && Number.isFinite(magnitude) && magnitude > 0) {
    event.hailSizeIn = magnitude;
    event.magnitudeLabel = `${magnitude.toFixed(2)}" hail`;
  } else if (type === 'wind' && Number.isFinite(magnitude) && magnitude > 0) {
    event.windMph = Math.round(magnitude * KNOTS_TO_MPH);
    const measured = /^M/.test(r.MAGNITUDE_TYPE || '');
    event.magnitudeLabel = `${event.windMph} mph ${measured ? 'measured' : 'estimated'} wind`;
  } else if (type === 'tornado') {
    event.torScale = r.TOR_F_SCALE || '';
    event.magnitudeLabel = event.torScale ? `Tornado (${event.torScale})` : 'Tornado';
  } else {
    event.magnitudeLabel = r.EVENT_TYPE;
  }
  event.remark = String(r.EVENT_NARRATIVE || '').slice(0, 500);
  event.damageProperty = r.DAMAGE_PROPERTY || '';
  return event;
}

/** Parses a whole yearly details CSV into normalized events. */
function parseDetailsCsv(text) {
  const rows = parseCsv(text);
  const header = rows.shift() || [];
  const events = [];
  for (const cols of rows) {
    if (cols.length < header.length - 1) continue;
    const obj = {};
    header.forEach((name, i) => {
      obj[name] = cols[i];
    });
    const event = normalizeRow(obj);
    if (event) events.push(event);
  }
  return events;
}

/** Latest yearly "details" file name for each year listed on the NCEI index page. */
async function listDetailFiles() {
  const html = await fetchText(INDEX_URL, { timeoutMs: 60000 });
  const files = {};
  const re = /StormEvents_details-ftp_v1\.0_d(\d{4})_c(\d{8})\.csv\.gz/g;
  let match;
  while ((match = re.exec(html))) {
    const [name, year, created] = match;
    if (!files[year] || files[year].created < created) files[year] = { name, year: Number(year), created };
  }
  return files;
}

async function downloadYear(fileName) {
  const gz = await fetchBuffer(`${INDEX_URL}${fileName}`, { timeoutMs: 300000 });
  return zlib.gunzipSync(gz).toString('utf8');
}

/** Converts a normalized event into a StormEvent upsert operation. */
function toUpsert(event, fileName) {
  return {
    updateOne: {
      filter: { provider: SOURCE, providerEventId: event.providerEventId },
      update: {
        $set: {
          provider: SOURCE,
          providerEventId: event.providerEventId,
          type: event.type,
          occurredAt: new Date(event.occurredAt),
          magnitude: event.magnitudeLabel.slice(0, 80),
          summary: event.location.slice(0, 500),
          center: { type: 'Point', coordinates: [event.longitude, event.latitude] },
          raw: {
            eventType: event.eventType,
            endedAt: event.endedAt,
            durationMinutes: event.durationMinutes,
            hailSizeIn: event.hailSizeIn ?? null,
            windMph: event.windMph ?? null,
            torScale: event.torScale ?? null,
            location: event.location,
            remark: event.remark,
            damageProperty: event.damageProperty,
            sourceFile: fileName,
          },
        },
      },
      upsert: true,
    },
  };
}

/**
 * Downloads and ingests one year into StormEvent (idempotent upserts).
 * `StormEvent` is passed in so this module stays usable without a DB connection in tests.
 */
async function ingestYear(StormEvent, file, { log = () => {} } = {}) {
  log(`Downloading ${file.name}…`);
  const text = await downloadYear(file.name);
  const events = parseDetailsCsv(text);
  log(`Parsed ${events.length} hail/wind/tornado events with coordinates for ${file.year}.`);
  const CHUNK = 1000;
  let upserted = 0;
  for (let i = 0; i < events.length; i += CHUNK) {
    const ops = events.slice(i, i + CHUNK).map((event) => toUpsert(event, file.name));
    const result = await StormEvent.bulkWrite(ops, { ordered: false });
    upserted += (result.upsertedCount || 0) + (result.modifiedCount || 0);
  }
  return { year: file.year, file: file.name, events: events.length, written: upserted };
}

/** StormEvent document → normalized event (same shape as the live providers). */
function fromDocument(doc) {
  const raw = doc.raw || {};
  const [longitude, latitude] = doc.center?.coordinates || [];
  return {
    source: SOURCE,
    evidence: 'official_record',
    type: doc.type,
    eventType: raw.eventType || doc.type,
    occurredAt: new Date(doc.occurredAt).toISOString(),
    endedAt: raw.endedAt || null,
    durationMinutes: raw.durationMinutes ?? null,
    latitude,
    longitude,
    hailSizeIn: raw.hailSizeIn ?? null,
    windMph: raw.windMph ?? null,
    torScale: raw.torScale ?? null,
    magnitudeLabel: doc.magnitude,
    location: raw.location || doc.summary || '',
    remark: raw.remark || '',
    providerEventId: doc.providerEventId,
  };
}

/** Distinct UTC calendar days per storm type. */
function countDays(events) {
  const days = { hail: new Set(), wind: new Set(), tornado: new Set() };
  for (const event of events) days[event.type]?.add(event.occurredAt.slice(0, 10));
  return { hailDays: days.hail.size, windDays: days.wind.size, tornadoDays: days.tornado.size };
}

/**
 * Official storm history around the property for the `years` before `until`.
 * Returns counts (distinct event days per type), the nearest events, and how far the
 * ingested record reaches (`coverageThrough`) so the report can state the data's limits.
 */
async function queryHistory(StormEvent, { origin, until, years, radiusMiles }) {
  const since = new Date(until);
  since.setUTCFullYear(since.getUTCFullYear() - years);

  const docs = await StormEvent.find({
    provider: SOURCE,
    occurredAt: { $gte: since, $lte: new Date(until) },
    center: {
      $geoWithin: { $centerSphere: [[origin.longitude, origin.latitude], radiusMiles / EARTH_RADIUS_MILES] },
    },
  })
    .sort({ occurredAt: -1 })
    .limit(2000)
    .lean();

  const latest = await StormEvent.findOne({ provider: SOURCE }).sort({ occurredAt: -1 }).select('occurredAt').lean();
  const events = withinRadius(origin, docs.map(fromDocument), radiusMiles).sort(
    (a, b) => new Date(b.occurredAt) - new Date(a.occurredAt)
  );

  return {
    source: SOURCE,
    query: { since: since.toISOString(), until: new Date(until).toISOString(), years, radiusMiles },
    coverageThrough: latest ? new Date(latest.occurredAt).toISOString() : null,
    counts: countDays(events),
    events,
  };
}

module.exports = {
  SOURCE,
  parseCsv,
  parseDetailsCsv,
  normalizeRow,
  timezoneOffsetHours,
  toUtc,
  listDetailFiles,
  ingestYear,
  queryHistory,
  countDays,
  fromDocument,
};
