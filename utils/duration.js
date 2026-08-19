'use strict';

const UNIT_SECONDS = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

function durationToSeconds(value, fallbackSeconds) {
  if (!value) return fallbackSeconds;
  const match = String(value).trim().match(/^(\d+)\s*([smhd])$/i);
  if (!match) return fallbackSeconds;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  return amount * UNIT_SECONDS[unit];
}

function durationFromNow(value, fallbackSeconds) {
  const seconds = durationToSeconds(value, fallbackSeconds);
  return new Date(Date.now() + seconds * 1000);
}

module.exports = { durationToSeconds, durationFromNow };
