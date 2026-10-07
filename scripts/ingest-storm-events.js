'use strict';

/**
 * Ingests NOAA NCEI Storm Events (official storm history) into the storm_events collection.
 *
 * Usage:
 *   npm run ingest:storm-events            → the last WEATHER_HISTORY_YEARS years + the current year
 *   npm run ingest:storm-events -- 2023 2024
 *
 * Safe to re-run: rows are upserted by NCEI EVENT_ID. NCEI republishes yearly files as late
 * records arrive (the current year lags ~2–3 months), so run it monthly, e.g. from cron.
 */
require('dotenv').config();

const mongoose = require('mongoose');
const env = require('../config/env');
const { StormEvent } = require('../models');
const stormEvents = require('../services/noaa/storm-events');

function yearsToIngest(args) {
  const requested = args.map(Number).filter((year) => year >= 1950 && year <= 2100);
  if (requested.length) return requested;
  const current = new Date().getUTCFullYear();
  const years = [];
  for (let year = current - env.weatherHistoryYears; year <= current; year++) years.push(year);
  return years;
}

async function ingest() {
  await mongoose.connect(env.mongodbUri);
  await StormEvent.createIndexes();

  const years = yearsToIngest(process.argv.slice(2));
  console.log(`Storm Events ingest — years: ${years.join(', ')}`);
  const files = await stormEvents.listDetailFiles();

  for (const year of years) {
    const file = files[year];
    if (!file) {
      console.log(`  ${year}: no file published yet — skipped`);
      continue;
    }
    const started = Date.now();
    const result = await stormEvents.ingestYear(StormEvent, file, { log: (line) => console.log(`  ${line}`) });
    console.log(
      `  ${year}: ${result.events} events, ${result.written} inserted/updated from ${result.file} (${Math.round((Date.now() - started) / 1000)}s)`
    );
  }

  const latest = await StormEvent.findOne({ provider: stormEvents.SOURCE }).sort({ occurredAt: -1 }).lean();
  console.log(`Coverage through: ${latest ? latest.occurredAt.toISOString().slice(0, 10) : 'n/a'}`);

  await mongoose.disconnect();
  process.exit(0);
}

ingest().catch(async (error) => {
  console.error('Storm Events ingest failed:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
