'use strict';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolveBranding(company = {}) {
  const branding = company.branding || {};
  const contact = company.contact || {};
  const address = contact.address || {};
  const displayName = branding.companyDisplayName || company.name || 'Your company';
  const footerText = branding.footerText || branding.letterheadNote || '';
  const addressLine = [address.line1, address.city, address.state, address.postalCode]
    .filter(Boolean)
    .join(', ');

  return {
    displayName,
    tagline: branding.tagline || '',
    primaryColor: branding.primaryColor || '#1B4F72',
    accentColor: branding.accentColor || '#E07A3D',
    logoUrl: branding.logoUrl || '',
    footerText,
    email: contact.email || '',
    phone: contact.phone || '',
    website: contact.website || '',
    addressLine,
  };
}

function brandedReportShareEmail({
  to,
  recipientName,
  company,
  reportTitle,
  jobNumber,
  pdfUrl,
  shareUrl,
}) {
  const brand = resolveBranding(company);
  const name = escapeHtml(recipientName || 'Customer');
  const workspace = escapeHtml(brand.displayName);
  const title = escapeHtml(reportTitle || 'Roof Assessment Report');
  const job = escapeHtml(jobNumber || '');
  const link = escapeHtml(pdfUrl || shareUrl || '');
  const footer = escapeHtml(brand.footerText);
  const contactBits = [brand.phone, brand.email, brand.website, brand.addressLine]
    .filter(Boolean)
    .map(escapeHtml)
    .join(' · ');
  const logoBlock = brand.logoUrl && !brand.logoUrl.startsWith('data:')
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${workspace}" style="max-height:40px;max-width:160px;display:block;" />`
    : `<div style="width:36px;height:36px;background:${escapeHtml(brand.accentColor)};border-radius:8px;text-align:center;line-height:36px;color:#fff;font-weight:700;">${escapeHtml(brand.displayName.slice(0, 1))}</div>`;

  const text = [
    `Hi ${recipientName || 'Customer'},`,
    '',
    `${brand.displayName} shared a report with you.`,
    reportTitle ? `Report: ${reportTitle}` : '',
    jobNumber ? `Job: ${jobNumber}` : '',
    '',
    `View / download: ${pdfUrl || shareUrl || ''}`,
    '',
    brand.footerText || '',
    contactBits.replace(/ · /g, ' | '),
  ].filter(Boolean).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#eef1f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #dde3ea;">
        <tr>
          <td style="background:${escapeHtml(brand.primaryColor)};padding:22px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td>${logoBlock}</td>
              <td style="padding-left:12px;color:#ffffff;">
                <div style="font-size:18px;font-weight:700;">${workspace}</div>
                <div style="font-size:12px;opacity:0.85;padding-top:2px;">${escapeHtml(brand.tagline || 'Customer report')}</div>
              </td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;color:#1b2430;">
            <p style="margin:0 0 12px;font-size:16px;">Hi ${name},</p>
            <p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:#445060;">
              <strong>${workspace}</strong> shared <strong>${title}</strong>${job ? ` for job ${job}` : ''} with you.
            </p>
            ${link ? `<p style="margin:0 0 20px;"><a href="${link}" style="display:inline-block;background:${escapeHtml(brand.accentColor)};color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">View report PDF</a></p>` : ''}
            <p style="margin:0;font-size:13px;color:#6b7785;">If the button does not work, copy this link:<br/>${link}</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f7f9fb;padding:16px 28px;border-top:1px solid #e4e9ef;font-size:12px;color:#8a94a0;">
            ${footer ? `<div style="margin-bottom:6px;">${footer}</div>` : ''}
            <div>${contactBits || workspace}</div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return {
    subject: `${brand.displayName}: ${reportTitle || 'Your inspection report'}`,
    text,
    html,
  };
}

function brandedInspectorCredentialsEmail({ to, name, password, company }) {
  const brand = resolveBranding(company);
  const displayName = escapeHtml(name || 'Inspector');
  const workspace = escapeHtml(brand.displayName);
  const email = escapeHtml(to);
  const pass = escapeHtml(password);
  const footer = escapeHtml(brand.footerText);
  const logoBlock = brand.logoUrl && !brand.logoUrl.startsWith('data:')
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${workspace}" style="max-height:36px;max-width:140px;display:block;" />`
    : `<div style="width:36px;height:36px;background:${escapeHtml(brand.accentColor)};border-radius:8px;text-align:center;line-height:36px;color:#fff;font-weight:700;">${escapeHtml(brand.displayName.slice(0, 1))}</div>`;

  const text = [
    `Hi ${name || 'Inspector'},`,
    '',
    `${brand.displayName} created an inspector account for you.`,
    `Email: ${to}`,
    `Password: ${password}`,
    '',
    brand.footerText || '',
  ].filter(Boolean).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#eef1f4;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;background:#eef1f4;"><tr><td align="center">
    <table width="560" style="max-width:560px;width:100%;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #dde3ea;">
      <tr><td style="background:${escapeHtml(brand.primaryColor)};padding:22px 28px;">
        <table cellpadding="0" cellspacing="0"><tr>
          <td>${logoBlock}</td>
          <td style="padding-left:12px;color:#fff;">
            <div style="font-size:18px;font-weight:700;">${workspace}</div>
            <div style="font-size:12px;opacity:0.85;">Inspector mobile access</div>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:28px;color:#1b2430;">
        <p>Hi ${displayName},</p>
        <p style="color:#445060;font-size:14px;line-height:1.55;"><strong>${workspace}</strong> added you as a field inspector. Use the mobile app with:</p>
        <div style="background:#f7f9fb;border:1px solid #e4e9ef;border-radius:10px;padding:16px;">
          <div style="font-size:11px;text-transform:uppercase;color:#6b7785;font-weight:700;">Email</div>
          <div style="padding:6px 0 14px;">${email}</div>
          <div style="font-size:11px;text-transform:uppercase;color:#6b7785;font-weight:700;">Password</div>
          <div style="font-family:Consolas,Monaco,monospace;">${pass}</div>
        </div>
      </td></tr>
      <tr><td style="background:#f7f9fb;padding:16px 28px;border-top:1px solid #e4e9ef;font-size:12px;color:#8a94a0;">
        ${footer || `Sent by ${workspace}`}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  return {
    subject: `${brand.displayName} added you as an inspector`,
    text,
    html,
  };
}

module.exports = {
  resolveBranding,
  brandedReportShareEmail,
  brandedInspectorCredentialsEmail,
};
