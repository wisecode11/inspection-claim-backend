'use strict';

const zlib = require('zlib');

/**
 * Minimal GRIB2 reader for NOAA MRMS products: one message, a regular lat/lon grid
 * (grid template 3.0) and PNG-packed data (data representation template 5.41).
 * That is exactly what MRMS publishes on AWS (verified against MESH_Max_1440min files):
 * a 7000 × 3500 grid at 0.01°, data as a 16-bit grayscale PNG, value = (R + X·2^E) / 10^D.
 */

function readSections(buf) {
  if (buf.toString('ascii', 0, 4) !== 'GRIB' || buf[7] !== 2) {
    throw new Error('Not a GRIB2 message');
  }
  const sections = {};
  let offset = 16;
  while (offset < buf.length - 4) {
    if (buf.toString('ascii', offset, offset + 4) === '7777') break;
    const length = buf.readUInt32BE(offset);
    const number = buf[offset + 4];
    sections[number] = buf.subarray(offset, offset + length);
    offset += length;
  }
  return sections;
}

/** Signed GRIB2 integers use a sign bit, not two's complement. */
function signed32(buf, at) {
  const raw = buf.readUInt32BE(at);
  return raw & 0x80000000 ? -(raw & 0x7fffffff) : raw;
}
function signed16(buf, at) {
  const raw = buf.readUInt16BE(at);
  return raw & 0x8000 ? -(raw & 0x7fff) : raw;
}

/** Normalizes a GRIB2 longitude (0..360 micro-degrees) to −180..180 degrees. */
function lon180(microDegrees) {
  const deg = microDegrees / 1e6;
  return deg > 180 ? deg - 360 : deg;
}

/** Parses the grid, packing parameters and PNG payload of a single-message GRIB2 file. */
function parse(buf) {
  const s = readSections(buf);
  const s3 = s[3];
  const s5 = s[5];
  const s7 = s[7];
  if (!s3 || !s5 || !s7) throw new Error('GRIB2 message is missing sections');
  if (s3.readUInt16BE(12) !== 0) throw new Error('Only lat/lon grids (template 3.0) are supported');
  if (s5.readUInt16BE(9) !== 41) throw new Error('Only PNG packing (template 5.41) is supported');

  const grid = {
    ni: s3.readUInt32BE(30),
    nj: s3.readUInt32BE(34),
    la1: signed32(s3, 46) / 1e6,
    lo1: lon180(s3.readUInt32BE(50)),
    la2: signed32(s3, 55) / 1e6,
    lo2: lon180(s3.readUInt32BE(59)),
    di: s3.readUInt32BE(63) / 1e6,
    dj: s3.readUInt32BE(67) / 1e6,
    scanMode: s3[71],
  };
  if (grid.scanMode !== 0) throw new Error(`Unsupported GRIB2 scan mode ${grid.scanMode}`);

  const packing = {
    reference: s5.readFloatBE(11),
    binaryScale: signed16(s5, 15),
    decimalScale: signed16(s5, 17),
    bits: s5[19],
  };
  return { grid, packing, png: s7.subarray(5) };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Decodes rows [rowStart, rowEnd) and columns [colStart, colEnd) of a 16-bit grayscale,
 * non-interlaced PNG. Rows are unfiltered in order (each depends on the previous one), but
 * only the requested window is kept, so the full CONUS image never sits in memory as values.
 */
function decodePngWindow(png, { rowStart, rowEnd, colStart, colEnd }) {
  let p = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (p < png.length) {
    const length = png.readUInt32BE(p);
    const type = png.toString('ascii', p + 4, p + 8);
    if (type === 'IHDR') {
      width = png.readUInt32BE(p + 8);
      height = png.readUInt32BE(p + 12);
      const bitDepth = png[p + 16];
      const colorType = png[p + 17];
      const interlace = png[p + 20];
      if (bitDepth !== 16 || colorType !== 0 || interlace !== 0) {
        throw new Error(`Unsupported PNG (depth ${bitDepth}, color ${colorType}, interlace ${interlace})`);
      }
    } else if (type === 'IDAT') {
      idat.push(png.subarray(p + 8, p + 8 + length));
    } else if (type === 'IEND') {
      break;
    }
    p += 12 + length;
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 2;
  const stride = width * bpp;
  const cols = colEnd - colStart;
  const out = new Uint16Array((rowEnd - rowStart) * cols);
  let prev = Buffer.alloc(stride);
  let cur = Buffer.alloc(stride);

  for (let y = 0; y < Math.min(rowEnd, height); y++) {
    const base = y * (stride + 1);
    const filter = raw[base];
    for (let x = 0; x < stride; x++) {
      const v = raw[base + 1 + x];
      const left = x >= bpp ? cur[x - bpp] : 0;
      const up = prev[x];
      const upLeft = x >= bpp ? prev[x - bpp] : 0;
      let value;
      switch (filter) {
        case 0: value = v; break;
        case 1: value = v + left; break;
        case 2: value = v + up; break;
        case 3: value = v + ((left + up) >> 1); break;
        case 4: value = v + paeth(left, up, upLeft); break;
        default: throw new Error(`Bad PNG filter ${filter}`);
      }
      cur[x] = value & 0xff;
    }
    if (y >= rowStart) {
      const rowOut = (y - rowStart) * cols;
      for (let c = 0; c < cols; c++) {
        const at = (colStart + c) * bpp;
        out[rowOut + c] = (cur[at] << 8) | cur[at + 1];
      }
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return out;
}

/**
 * Reads the values inside a lat/lon box from an MRMS GRIB2 file.
 * Returns the cropped grid with cell-centre coordinates of its top-left cell.
 */
function readWindow(buf, { west, south, east, north }) {
  const { grid, packing, png } = parse(buf);
  const col = (lon) => Math.round((lon - grid.lo1) / grid.di);
  const row = (lat) => Math.round((grid.la1 - lat) / grid.dj);
  const colStart = Math.max(0, col(west));
  const colEnd = Math.min(grid.ni, col(east) + 1);
  const rowStart = Math.max(0, row(north));
  const rowEnd = Math.min(grid.nj, row(south) + 1);
  if (colEnd <= colStart || rowEnd <= rowStart) throw new Error('Requested area is outside the MRMS grid');

  const rawValues = decodePngWindow(png, { rowStart, rowEnd, colStart, colEnd });
  const scale = 2 ** packing.binaryScale;
  const divisor = 10 ** packing.decimalScale;
  const values = new Float32Array(rawValues.length);
  for (let i = 0; i < rawValues.length; i++) {
    values[i] = (packing.reference + rawValues[i] * scale) / divisor;
  }

  return {
    nx: colEnd - colStart,
    ny: rowEnd - rowStart,
    lat0: grid.la1 - rowStart * grid.dj, // centre of the first (northernmost) row
    lon0: grid.lo1 + colStart * grid.di, // centre of the first (westernmost) column
    dLat: grid.dj,
    dLon: grid.di,
    values,
  };
}

module.exports = { parse, readWindow, decodePngWindow };
