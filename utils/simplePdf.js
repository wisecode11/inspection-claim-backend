'use strict';

/**
 * Minimal PDF writer (Helvetica). Supports optional header bar color + footer.
 */
function escapePdfText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function hexToRgb(hex) {
  const raw = String(hex || '').replace('#', '');
  if (raw.length !== 6) return { r: 0.11, g: 0.31, b: 0.45 };
  return {
    r: parseInt(raw.slice(0, 2), 16) / 255,
    g: parseInt(raw.slice(2, 4), 16) / 255,
    b: parseInt(raw.slice(4, 6), 16) / 255,
  };
}

/**
 * @param {string[]} lines
 * @param {{ primaryColor?: string, footerLines?: string[] }} [options]
 */
function buildSimplePdf(lines, options = {}) {
  const { r, g, b } = hexToRgb(options.primaryColor || '#1B4F72');
  const footerLines = Array.isArray(options.footerLines) ? options.footerLines.filter(Boolean) : [];

  const contentLines = [];
  // Brand header bar
  contentLines.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`);
  contentLines.push('0 742 612 50 re');
  contentLines.push('f');
  contentLines.push('1 1 1 rg');
  contentLines.push('BT');
  contentLines.push('/F1 14 Tf');
  contentLines.push('50 760 Td');
  const title = escapePdfText(lines[0] || 'Report');
  contentLines.push(`(${title}) Tj`);
  contentLines.push('ET');

  // Body text
  contentLines.push('0 0 0 rg');
  contentLines.push('BT');
  contentLines.push('/F1 11 Tf');
  contentLines.push('50 720 Td');
  contentLines.push('14 TL');
  lines.slice(1).forEach((line, index) => {
    const text = escapePdfText(line);
    if (index === 0) {
      contentLines.push(`(${text}) Tj`);
    } else {
      contentLines.push('T*');
      contentLines.push(`(${text}) Tj`);
    }
  });
  contentLines.push('ET');

  if (footerLines.length) {
    contentLines.push('0.45 0.45 0.45 rg');
    contentLines.push('BT');
    contentLines.push('/F1 9 Tf');
    contentLines.push('50 40 Td');
    contentLines.push('11 TL');
    footerLines.forEach((line, index) => {
      const text = escapePdfText(line);
      if (index === 0) contentLines.push(`(${text}) Tj`);
      else {
        contentLines.push('T*');
        contentLines.push(`(${text}) Tj`);
      }
    });
    contentLines.push('ET');
  }

  const stream = contentLines.join('\n');

  const objects = [];
  objects.push('1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj');
  objects.push('2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj');
  objects.push('3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj');
  objects.push(`4 0 obj<< /Length ${Buffer.byteLength(stream, 'utf8')} >>stream\n${stream}\nendstream endobj`);
  objects.push('5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj');

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${object}\n`;
  });

  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

module.exports = { buildSimplePdf };
