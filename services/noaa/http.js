'use strict';

const DEFAULT_TIMEOUT_MS = 20000;
const USER_AGENT = 'RoofCheck-WeatherEvidence/1.0';

async function request(url, timeoutMs) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs || DEFAULT_TIMEOUT_MS),
  });
  return response;
}

/** GET a URL and return the body as text. 404 resolves to null (e.g. no SPC file for a day). */
async function fetchText(url, { timeoutMs, allowNotFound = false } = {}) {
  const response = await request(url, timeoutMs);
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
  }
  return response.text();
}

async function fetchJson(url, options) {
  const text = await fetchText(url, options);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${new URL(url).host}`);
  }
}

async function fetchBuffer(url, { timeoutMs } = {}) {
  const response = await request(url, timeoutMs);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

module.exports = { fetchText, fetchJson, fetchBuffer };
