'use strict';

/**
 * One-off: move report PDFs stored inline as base64 (`templateSnapshot.pdfBase64`) into
 * GridFS (`report_pdfs`). Safe to re-run — only reports that still have inline bytes are
 * touched, and the inline copy is removed only after the GridFS write succeeds.
 *
 *   npm run migrate:report-pdfs            # migrate
 *   npm run migrate:report-pdfs -- --dry   # count only
 */

require('dotenv').config();

const mongoose = require('mongoose');
const env = require('../config/env');
const pdfStorage = require('../services/pdf-storage.service');

async function main() {
  const dryRun = process.argv.includes('--dry');
  await mongoose.connect(env.mongodbUri);

  // Native collection: bypass tenant-scoping hooks for this maintenance task.
  const reports = mongoose.connection.db.collection('reports');
  const cursor = reports.find(
    { 'templateSnapshot.pdfBase64': { $exists: true, $ne: '' } },
    { projection: { companyId: 1, pdf: 1, pdfSource: 1, templateSnapshot: 1 } }
  );

  let migrated = 0;
  let failed = 0;
  for await (const report of cursor) {
    const source = report.pdfSource || report.templateSnapshot?.source || '';
    if (dryRun) {
      migrated += 1;
      continue;
    }
    try {
      const buffer = Buffer.from(report.templateSnapshot.pdfBase64, 'base64');
      const stored = await pdfStorage.savePdf(buffer, {
        fileName: report.pdf?.originalFileName || `report-${report._id}.pdf`,
        reportId: report._id,
        companyId: report.companyId,
        source,
      });
      await reports.updateOne(
        { _id: report._id },
        {
          $set: {
            'pdf.bucket': stored.bucket,
            'pdf.key': stored.key,
            'pdf.sizeBytes': stored.sizeBytes,
            'pdf.checksum': stored.checksum,
            pdfSource: source,
          },
          $unset: { 'templateSnapshot.pdfBase64': '' },
        }
      );
      migrated += 1;
    } catch (error) {
      failed += 1;
      console.error(`Report ${report._id}: ${error.message}`);
    }
  }

  console.log(
    dryRun
      ? `${migrated} report(s) still have inline PDFs.`
      : `Migrated ${migrated} report PDF(s) to GridFS${failed ? `, ${failed} failed (left inline)` : ''}.`
  );
  await mongoose.disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
