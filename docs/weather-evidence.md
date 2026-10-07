# Weather Evidence (NOAA)

How the backend verifies a storm for a job's date of loss and property. The result feeds the
"Verified Weather Data" and "Weather History" pages of the Evidence Package PDF. The end-to-end
PDF flow is documented in the mobile repo (`docs/pdf-generation-flow.md`).

## Sources

| Source | Module | Evidence type | What it gives | Notes |
|---|---|---|---|---|
| NWS Local Storm Reports (via Iowa Environmental Mesonet) | `services/noaa/lsr.provider.js` | **Observed** | Hail size, wind speed, tornado reports with time, location, reporter type, measured/estimated | Preliminary, available within hours. Includes sub-severe hail (½", ¾"). Primary observed source |
| SPC storm reports | `services/noaa/spc.provider.js` | **Observed** | National filtered list (hail ≥ 1") | **Fallback only**, used when IEM is unreachable (SPC is built from LSRs, so never both). Fetched one file at a time: SPC drops parallel connections |
| NCEI SWDI `nx3hail` | `services/noaa/swdi.provider.js` | **Radar-estimated** | NEXRAD hail signatures: estimated max size, probability, severe probability | `center/radius` is ignored by the service, so we query by `bbox` and filter by distance |
| NOAA MRMS MESH (`MESH_Max_1440min`) | `services/noaa/mrms.provider.js`, `grib2.js`, `swath.js` | **Radar-estimated** | ~1 km hail size grid (24 h max): swath polygons for the PDF map, hail at the property, max within radius | Public AWS bucket `noaa-mrms-pds`. The D+1 `00:00Z` file covers day D. GRIB2 template 5.41 (PNG) decoded in-house, map window only. Contoured with `d3-contour` at 0.5/0.75/1/1.5/2/2.5" |
| NCEI Storm Events Database | `services/noaa/storm-events.js` | **Official record** | Verified history: event type, magnitude, begin/end time (duration) | Published ~2–3 months late. **Ingested** into `storm_events`, then queried locally. Zone-based events without coordinates (e.g. "High Wind") are skipped |
| Open-Meteo | `services/weather.service.js` | **Model-indicated** | Weather codes, wind, rain | Supporting context only; never makes an event "verified" |

## Decision ladder

`services/weather-evidence.service.js` → `decideLevel`:

1. Any observed hail/wind/tornado report within `WEATHER_EVENT_RADIUS_MILES` → **`observed`** (match).
2. Else any radar hail signature (SWDI) or MRMS MESH ≥ 0.5" within the radius → **`radar_estimated`** (match).
3. Else the weather model shows hail or thunderstorm codes → **`model_indicated`** (inconclusive, "Not verified").
4. Else, if the live sources answered → **`none`** (mismatch). If they all failed → **`unavailable`** (no data).

The search window is the date of loss ± `WEATHER_WINDOW_DAYS` (whole UTC days).

## Stored snapshot

Each lookup is saved as a `WeatherVerification`:
- `provider: 'noaa'`.
- `snapshot.evidence`: the full evidence object, versioned, with query, level, headline,
  hail/wind/tornado summaries, nearest-first report and detection lists, history counts and
  events, and a per-source status. Version 2 adds `hail.mesh` (at property, max within radius)
  and `swath` (bounds, thresholds, MultiPolygon bands in lon/lat).
- The Open-Meteo values stay alongside in `snapshot`.

Older records without `snapshot.evidence` are refreshed automatically on the next `GET` or verify.

API responses (`GET /api/weather/jobs/:jobId`, `POST /api/weather/verify`) now include `evidence`.
`GET /api/maps/swath-base?west&south&east&north&width` returns Esri imagery, roads and labels
layers (data URIs) for the swath bounds; the app overlays the polygons as SVG.
The legacy `summary` keys are kept, with evidence-based wording, so older app builds still render.

## Configuration (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `WEATHER_WINDOW_DAYS` | 1 | Days searched on each side of the date of loss |
| `WEATHER_EVENT_RADIUS_MILES` | 10 | Radius for storm reports and radar detections |
| `WEATHER_HISTORY_RADIUS_MILES` | 5 | Radius for official storm history |
| `WEATHER_HISTORY_YEARS` | 3 | Length of official history |
| `WEATHER_CACHE_TTL_HOURS` | 24 | How long a lookup is reused before refreshing |

## Storm Events ingestion

```bash
npm run ingest:storm-events              # last WEATHER_HISTORY_YEARS years + current year
npm run ingest:storm-events -- 2023 2024 # specific years
```

- Downloads NCEI's yearly `StormEvents_details` CSV (~13 MB gzipped each), keeps hail /
  thunderstorm wind / tornado rows with coordinates (about 31k per year), and upserts them by
  `EVENT_ID`.
- Safe to re-run. NCEI republishes files as late records arrive, so **schedule it monthly**
  (e.g. cron).
- Until it has run, history is reported as "not available" and the evidence source status is
  `not_ingested`.

## Tests

```bash
npm test
```

Unit tests (`tests/noaa.test.js`) cover parsing for every source, timezone and knots conversion,
the decision ladder, the LSR → SPC fallback, MRMS file naming and swath contouring. They need no network or database.

## Not implemented yet

- **Wind swath:** NOAA has no wind swath grid; wind is shown as report markers.
- **HailTrace:** blocked on written approval for forensic use.
