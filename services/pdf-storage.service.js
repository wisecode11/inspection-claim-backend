'use strict';

/**
 * Report PDF bytes live in GridFS (bucket `report_pdfs`), not inside report documents.
 * That keeps reports small (MongoDB caps a document at 16 MB; base64 adds ~33%) and lets
 * superseded PDFs be kept as history instead of being overwritten.
 */

const crypto = require('crypto');
const mongoose = require('mongoose');

const BUCKET_NAME = 'report_pdfs';
/** Stored in `report.pdf.bucket` so readers know where the bytes are. */
const GRIDFS_BUCKET = `gridfs:${BUCKET_NAME}`;

function bucket() {
  if (!mongoose.connection?.db) {
    throw new Error('Database is not connected');
  }
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: BUCKET_NAME });
}

/**
 * Store a PDF and return the `storageFile` fields for `report.pdf`.
 * @param {Buffer} buffer
 * @param {{ fileName: string, reportId: string, companyId: string, source: string }} meta
 */
async function savePdf(buffer, meta) {
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  const upload = bucket().openUploadStream(meta.fileName, {
    contentType: 'application/pdf',
    metadata: {
      reportId: String(meta.reportId),
      companyId: String(meta.companyId),
      source: meta.source,
      checksum,
    },
  });

  await new Promise((resolve, reject) => {
    upload.once('finish', resolve);
    upload.once('error', reject);
    upload.end(buffer);
  });

  return {
    bucket: GRIDFS_BUCKET,
    key: String(upload.id),
    mimeType: 'application/pdf',
    sizeBytes: buffer.length,
    checksum,
    originalFileName: meta.fileName,
  };
}

/** Read a stored PDF back into memory. */
async function readPdf(fileKey) {
  if (!mongoose.isValidObjectId(fileKey)) {
    throw new Error('Invalid PDF file key');
  }
  const chunks = [];
  const stream = bucket().openDownloadStream(new mongoose.Types.ObjectId(fileKey));
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function isGridFsFile(file) {
  return Boolean(file && file.bucket === GRIDFS_BUCKET && file.key);
}

module.exports = { savePdf, readPdf, isGridFsFile, GRIDFS_BUCKET, BUCKET_NAME };
