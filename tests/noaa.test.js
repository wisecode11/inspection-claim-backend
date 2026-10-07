'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const geo = require('../services/noaa/geo');
const lsr = require('../services/noaa/lsr.provider');
const spc = require('../services/noaa/spc.provider');
const swdi = require('../services/noaa/swdi.provider');
const stormEvents = require('../services/noaa/storm-events');
const evidence = require('../services/weather-evidence.service');
const mrms = require('../services/noaa/mrms.provider');
const swath = require('../services/noaa/swath');

const DALLAS = { latitude: 32.7767, longitude: -96.797 };
const FORT_WORTH = { latitude: 32.7555, longitude: -97.3308 };

test('geo: distance and compass direction', () => {
  const miles = geo.distanceMiles(DALLAS, FORT_WORTH);
  assert.ok(miles > 30 && miles < 32, `Dallas→Fort Worth should be ~31 mi, got ${miles}`);
  assert.equal(geo.compassFrom(DALLAS, FORT_WORTH), 'W');
  assert.equal(geo.compassFrom(DALLAS, { latitude: 33.2, longitude: -96.797 }), 'N');

  const box = geo.bboxAround(DALLAS, 10);
  assert.ok(box.minLat < DALLAS.latitude && box.maxLat > DALLAS.latitude);
  const within = geo.withinRadius(DALLAS, [{ ...FORT_WORTH, id: 'fw' }, { ...DALLAS, id: 'here' }], 10);
  assert.deepEqual(within.map((x) => x.id), ['here']);
});

test('lsr: normalizes hail, wind and ignores other report types', () => {
  const hail = lsr.normalizeFeature({
    geometry: { type: 'Point', coordinates: [-102.41, 34.84] },
    properties: {
      typetext: 'HAIL', magf: 1.75, unit: 'Inch', valid: '2024-05-28T20:30:00Z', qualifier: 'M',
      source: 'Trained Spotter', city: '1 NNW Hereford', county: 'Deaf Smith', st: 'TX', product_id: 'P1',
    },
  });
  assert.equal(hail.type, 'hail');
  assert.equal(hail.hailSizeIn, 1.75);
  assert.equal(hail.measured, true);
  assert.equal(hail.evidence, 'observed');
  assert.equal(hail.magnitudeLabel, '1.75" hail');

  const gust = lsr.normalizeFeature({
    geometry: { coordinates: [-96.8, 32.8] },
    properties: { typetext: 'TSTM WND GST', magf: 75, unit: 'MPH', valid: '2024-05-28T11:08:00Z', qualifier: 'M' },
  });
  assert.equal(gust.type, 'wind');
  assert.equal(gust.windMph, 75);

  assert.equal(lsr.normalizeFeature({ geometry: { coordinates: [0, 0] }, properties: { typetext: 'RAIN' } }), null);
  assert.equal(lsr.lsrType('MARINE TSTM WIND'), null);
  assert.equal(lsr.iemStamp(new Date('2024-05-28T12:05:00Z')), '202405281205');
});

test('spc: report day spans 12Z–12Z and comments may contain commas', () => {
  const day = new Date('2024-05-27T00:00:00Z');
  assert.equal(spc.spcTimestamp(day, '2123').toISOString(), '2024-05-27T21:23:00.000Z');
  assert.equal(spc.spcTimestamp(day, '0005').toISOString(), '2024-05-28T00:05:00.000Z');

  const days = spc.spcDaysFor(new Date('2024-05-27T00:00:00Z'), new Date('2024-05-28T23:59:59Z'));
  assert.deepEqual(days.map((d) => d.toISOString().slice(0, 10)), ['2024-05-26', '2024-05-27', '2024-05-28']);

  const csv = 'Time,Size,Location,County,State,Lat,Lon,Comments\n2123,175,4 NE Cockrell Hill,Dallas,TX,32.77,-96.84,Golf ball hail, roof damage, photos. (FWD)\n';
  const [report] = spc.parseCsv(csv, day, 'hail');
  assert.equal(report.hailSizeIn, 1.75);
  assert.equal(report.remark, 'Golf ball hail, roof damage, photos. (FWD)');
  assert.equal(report.occurredAt, '2024-05-27T21:23:00.000Z');
});

test('swdi: parses radar hail signature rows', () => {
  assert.deepEqual(swdi.parsePoint('POINT (-96.818 32.966)'), { longitude: -96.818, latitude: 32.966 });
  const row = swdi.normalizeRow({
    PROB: '100', SEVPROB: '60', MAXSIZE: '1.25', WSR_ID: 'KFWS', CELL_ID: 'J1',
    ZTIME: '2024-05-28T10:54:12Z', SHAPE: 'POINT (-96.8997 32.8681)',
  });
  assert.equal(row.evidence, 'radar_estimated');
  assert.equal(row.hailSizeIn, 1.25);
  assert.equal(row.severeProbability, 60);
  assert.equal(row.radar, 'KFWS');
});

test('storm events: CSV quoting, timezone and knots conversion', () => {
  const rows = stormEvents.parseCsv('a,b\n"x, y","line1\nline2"\n"say ""hi""",2\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'line1\nline2'], ['say "hi"', '2']]);

  assert.equal(stormEvents.timezoneOffsetHours('CST-6'), -6);
  assert.equal(stormEvents.timezoneOffsetHours('AKST-9'), -9);
  // 20:33 CST (UTC-6) → 02:33Z next day
  assert.equal(stormEvents.toUtc('202404', '30', '2033', -6).toISOString(), '2024-05-01T02:33:00.000Z');

  const wind = stormEvents.normalizeRow({
    EVENT_TYPE: 'Thunderstorm Wind', BEGIN_LAT: '34.3444', BEGIN_LON: '-98.983',
    BEGIN_YEARMONTH: '202404', BEGIN_DAY: '30', BEGIN_TIME: '2033',
    END_YEARMONTH: '202404', END_DAY: '30', END_TIME: '2048', CZ_TIMEZONE: 'CST-6',
    MAGNITUDE: '55.00', MAGNITUDE_TYPE: 'MG', EVENT_ID: '1174463',
  });
  assert.equal(wind.windMph, 63);
  assert.equal(wind.durationMinutes, 15);
  assert.equal(wind.evidence, 'official_record');

  // Zone-based rows without coordinates can't be placed on a map → skipped.
  assert.equal(stormEvents.normalizeRow({ EVENT_TYPE: 'High Wind', BEGIN_LAT: '', BEGIN_LON: '' }), null);
  assert.equal(stormEvents.normalizeRow({ EVENT_TYPE: 'Flood', BEGIN_LAT: '1', BEGIN_LON: '1' }), null);

  const counts = stormEvents.countDays([
    { type: 'hail', occurredAt: '2024-05-27T21:19:00Z' },
    { type: 'hail', occurredAt: '2024-05-27T21:23:00Z' },
    { type: 'hail', occurredAt: '2023-06-01T10:00:00Z' },
    { type: 'wind', occurredAt: '2024-05-28T11:08:00Z' },
  ]);
  assert.deepEqual(counts, { hailDays: 2, windDays: 1, tornadoDays: 0 });
});

test('evidence: decision ladder never calls model-only data verified', () => {
  const base = { observedOk: true, radarOk: true, observed: [], radar: [], model: null };
  assert.equal(evidence.decideLevel({ ...base, observed: [{}] }), 'observed');
  assert.equal(evidence.decideLevel({ ...base, radar: [{}] }), 'radar_estimated');
  assert.equal(evidence.decideLevel({ ...base, model: { hailFound: true } }), 'model_indicated');
  assert.equal(evidence.decideLevel(base), 'none');
  assert.equal(evidence.decideLevel({ ...base, observedOk: false, radarOk: false }), 'unavailable');

  const w = evidence.lossWindow(new Date('2024-05-27T00:00:00Z'), 1);
  assert.equal(w.start.toISOString(), '2024-05-26T00:00:00.000Z');
  assert.equal(w.end.toISOString(), '2024-05-28T23:59:59.000Z');
});

test('evidence: falls back to SPC when LSR fails and records each source', async (t) => {
  const report = {
    source: 'spc_reports', evidence: 'observed', type: 'hail', hailSizeIn: 1.75, magnitudeLabel: '1.75" hail',
    occurredAt: '2024-05-27T21:23:00.000Z', distanceMiles: 3.2, direction: 'WSW', providerEventId: 'x',
  };
  t.mock.method(lsr, 'fetchReports', async () => { throw new Error('IEM down'); });
  t.mock.method(spc, 'fetchReports', async () => ({ source: 'spc_reports', query: {}, totalInWindow: 1, reports: [report] }));
  t.mock.method(swdi, 'fetchDetections', async () => ({ source: 'ncei_swdi_nx3hail', query: {}, totalInWindow: 0, detections: [] }));
  t.mock.method(mrms, 'fetchMeshMax', async () => { throw new Error('MRMS offline'); });
  t.mock.method(stormEvents, 'queryHistory', async () => ({
    query: { since: '2021-05-28T00:00:00.000Z', until: '2024-05-28T23:59:59.000Z' },
    coverageThrough: '2026-06-30T00:00:00.000Z',
    counts: { hailDays: 4, windDays: 2, tornadoDays: 0 },
    events: [],
  }));

  const result = await evidence.buildEvidence({
    origin: DALLAS,
    dateOfLoss: '2024-05-27T00:00:00Z',
    config: { windowDays: 1, eventRadiusMiles: 10, historyRadiusMiles: 5, historyYears: 3 },
    model: { hailFound: true, windMph: 40, rainIn: 0.5 },
    StormEvent: {},
  });

  assert.equal(result.level, 'observed');
  assert.equal(result.hail.observed.maxSizeIn, 1.75);
  assert.match(result.headline, /1 hail report, largest 1\.75" \(3\.2 mi WSW/);
  assert.equal(result.history.counts.hailDays, 4);
  const statuses = Object.fromEntries(result.sources.map((s) => [s.id, s.status]));
  assert.deepEqual(statuses, {
    nws_lsr: 'error',
    spc_reports: 'ok',
    ncei_swdi_nx3hail: 'ok',
    noaa_mrms_mesh: 'error',
    ncei_storm_events: 'ok',
    open_meteo: 'ok',
  });
  assert.equal(result.swath, null);
});

test('evidence: MRMS hail alone makes the level radar-estimated', () => {
  const base = { observedOk: true, radarOk: true, observed: [], radar: [], model: null };
  assert.equal(evidence.decideLevel({ ...base, meshMaxIn: 0.75 }), 'radar_estimated');
  assert.equal(evidence.decideLevel({ ...base, meshMaxIn: 0.25 }), 'none');
});

test('mrms: daily 24 h max file is stamped at the following midnight', () => {
  assert.equal(
    mrms.dailyMaxUrl(new Date('2026-07-03T00:00:00Z')),
    'https://noaa-mrms-pds.s3.amazonaws.com/CONUS/MESH_Max_1440min_00.50/20260704/MRMS_MESH_Max_1440min_00.50_20260704-000000.grib2.gz'
  );
  const days = mrms.daysIn(new Date('2026-07-02T00:00:00Z'), new Date('2026-07-04T23:59:59Z'));
  assert.deepEqual(days.map((d) => d.toISOString().slice(0, 10)), ['2026-07-02', '2026-07-03', '2026-07-04']);
});

test('swath: contour bands, size at property and max within radius', async () => {
  // 5×5 grid at 0.01° centred on the property; a 1.2" core at the centre, 0.6" ring around it.
  const origin = { latitude: 34, longitude: -84 };
  const ring = 0.6 * 25.4;
  const core = 1.2 * 25.4;
  const values = new Float32Array([
    -1, -1, -1, -1, -1,
    -1, ring, ring, ring, -1,
    -1, ring, core, ring, -1,
    -1, ring, ring, ring, -1,
    -1, -1, -1, -1, -1,
  ]);
  const grid = { nx: 5, ny: 5, lat0: 34.02, lon0: -84.02, dLat: 0.01, dLon: 0.01, values };
  const result = await swath.buildSwath(grid, { origin, radiusMiles: 10 });

  assert.equal(result.atPropertyIn, 1.2);
  assert.equal(result.maxWithinRadiusIn, 1.2);
  assert.deepEqual(result.bands.map((b) => b.minIn), [0.5, 0.75, 1]);
  const [lon, lat] = result.bands[0].geometry.coordinates[0][0][0];
  assert.ok(lon > -84.03 && lon < -83.97 && lat > 33.97 && lat < 34.03, 'polygon is placed around the property');

  const box = swath.mapBounds(origin, 10);
  assert.ok(box.west < origin.longitude && box.east > origin.longitude);
  const widthMiles = (box.east - box.west) * 69 * Math.cos((origin.latitude * Math.PI) / 180);
  const heightMiles = (box.north - box.south) * 69;
  assert.ok(Math.abs(widthMiles / heightMiles - swath.MAP_ASPECT) < 0.01);
});
