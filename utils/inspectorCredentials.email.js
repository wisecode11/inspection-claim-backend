'use strict';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inspectorCredentialsEmail({ to, name, password, companyName }) {
  const displayName = escapeHtml(name || 'Inspector');
  const workspace = escapeHtml(companyName || 'your company');
  const email = escapeHtml(to);
  const pass = escapeHtml(password);

  const text = [
    `Hi ${name || 'Inspector'},`,
    '',
    `${companyName || 'Your company'} created a RoofClaim inspector account for you.`,
    'Sign in on the RoofClaim inspector mobile app with:',
    '',
    `Email: ${to}`,
    `Password: ${password}`,
    '',
    'The company web workspace is for admins only. Change this password after you first sign in.',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Your RoofClaim inspector account</title>
</head>
<body style="margin:0;padding:0;background:#eef1f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #dde3ea;">
          <tr>
            <td style="background:#1b365d;padding:22px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:36px;height:36px;background:#e07a3d;border-radius:8px;text-align:center;vertical-align:middle;color:#ffffff;font-size:16px;font-weight:700;">R</td>
                  <td style="padding-left:12px;color:#ffffff;">
                    <div style="font-size:18px;font-weight:700;letter-spacing:0.2px;">RoofClaim</div>
                    <div style="font-size:12px;color:#c5d3e3;padding-top:2px;">Inspector mobile access</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px;color:#1b2430;">
              <p style="margin:0 0 12px;font-size:16px;">Hi ${displayName},</p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#445060;">
                <strong style="color:#1b2430;">${workspace}</strong> added you as a field inspector.
                Use the RoofClaim <strong>mobile app</strong> with the login below. The web workspace is for company admins only.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f9fb;border:1px solid #e4e9ef;border-radius:10px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7785;font-weight:700;">Email</div>
                    <div style="font-size:15px;color:#1b2430;padding:6px 0 14px;word-break:break-all;">${email}</div>
                    <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7785;font-weight:700;">Password</div>
                    <div style="font-size:15px;color:#1b2430;padding:6px 0 0;font-family:Consolas,Monaco,monospace;">${pass}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 28px;">
              <p style="margin:0;font-size:13px;line-height:1.5;color:#6b7785;">
                Change this password after you first sign in. If you did not expect this account, contact your company admin.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f7f9fb;padding:16px 28px;border-top:1px solid #e4e9ef;font-size:12px;color:#8a94a0;">
              Sent by RoofClaim for ${workspace}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    subject: `${companyName || 'RoofClaim'} added you as a RoofClaim inspector`,
    text,
    html,
  };
}

module.exports = { inspectorCredentialsEmail };
