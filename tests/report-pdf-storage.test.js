'use strict';

/**
 * Report PDF storage (G8/G10): GridFS round-trip, history instead of overwrite,
 * legacy inline PDFs preserved. Uses a throwaway database and drops it afterwards;
 * skipped when MongoDB is not reachable. Override with MONGODB_TEST_URI.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');

const pdfStorage = require('../services/pdf-storage.service');
const reportService = require('../services/report.service');
const { Report } = require('../models');

const DB_URI =
  process.env.MONGODB_TEST_URI
  || `mongodb://localhost:27017/roofclaim_pdf_test_${crypto.randomBytes(4).toString('hex')}`;

let connected = false;

test.before(async () => {
  try {
    // autoIndex off: background index builds would recreate the database after it is dropped.
    await mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 1500, autoIndex: false });
    connected = true;
  } catch {
    connected = false;
  }
});

test.after(async () => {
  if (connected) {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  }
});

function fakePdf(label) {
  return Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`, 'latin1');
}

function newReport(extra = {}) {
  const id = () => new mongoose.Types.ObjectId();
  return new Report({
    companyId: id(),
    jobId: id(),
    inspectionId: id(),
    generatedBy: id(),
    ...extra,
  });
}

test('GridFS round-trip keeps bytes and checksum', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  const bytes = fakePdf('round-trip');
  const stored = await pdfStorage.savePdf(bytes, {
    fileName: 'a.pdf',
    reportId: 'r1',
    companyId: 'c1',
    source: 'inspector_mobile',
  });
  assert.equal(stored.bucket, pdfStorage.GRIDFS_BUCKET);
  assert.equal(stored.sizeBytes, bytes.length);
  assert.ok(pdfStorage.isGridFsFile(stored));
  const back = await pdfStorage.readPdf(stored.key);
  assert.ok(back.equals(bytes));
});

test('a resubmitted PDF moves the previous one to history (never overwritten)', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  const report = newReport();
  const first = fakePdf('first package');
  const second = fakePdf('second package');

  await reportService.storeReportPdf(report, first, {
    fileName: 'first.pdf',
    source: reportService.PDF_SOURCE.INSPECTOR,
  });
  const firstKey = report.pdf.key;
  await reportService.storeReportPdf(report, second, {
    fileName: 'second.pdf',
    source: reportService.PDF_SOURCE.INSPECTOR,
  });

  assert.equal(report.pdfHistory.length, 1);
  assert.equal(report.pdfHistory[0].file.key, firstKey);
  assert.equal(report.pdfHistory[0].source, 'inspector_mobile');
  assert.ok((await pdfStorage.readPdf(firstKey)).equals(first), 'old PDF still readable');
  assert.ok((await pdfStorage.readPdf(report.pdf.key)).equals(second));
  assert.equal(report.templateSnapshot.pdfBase64, undefined, 'no inline bytes on the report');
  assert.ok(reportService.hasInspectorPdf(report));
});

test('a legacy inline base64 PDF is preserved in GridFS history when replaced', async (t) => {
  if (!connected) return t.skip('MongoDB not reachable');
  const legacy = fakePdf('legacy inline');
  const report = newReport({
    pdf: { bucket: 'local', key: 'reports/x.pdf', originalFileName: 'legacy.pdf' },
    templateSnapshot: { pdfBase64: legacy.toString('base64'), source: 'inspector_mobile' },
  });

  await reportService.storeReportPdf(report, fakePdf('new'), {
    fileName: 'new.pdf',
    source: reportService.PDF_SOURCE.INSPECTOR,
  });

  assert.equal(report.pdfHistory.length, 1);
  const kept = await pdfStorage.readPdf(report.pdfHistory[0].file.key);
  assert.ok(kept.equals(legacy), 'legacy bytes survive in GridFS');
  assert.equal(report.templateSnapshot.pdfBase64, undefined);
});

test('hasInspectorPdf recognises new and legacy inspector packages', () => {
  assert.equal(reportService.hasInspectorPdf({ pdfSource: 'inspector_mobile' }), true);
  assert.equal(reportService.hasInspectorPdf({ templateSnapshot: { source: 'inspector_mobile' } }), true);
  assert.equal(reportService.hasInspectorPdf({ pdfSource: 'server_summary' }), false);
  assert.equal(reportService.hasInspectorPdf({}), false);
});
