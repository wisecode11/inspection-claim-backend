'use strict';

const nodemailer = require('nodemailer');
const env = require('../config/env');
const { brandedReportShareEmail, brandedInspectorCredentialsEmail } = require('../utils/brandedEmail');

function createTransport() {
  if (!env.smtpHost) {
    return null;
  }

  return nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,
    requireTLS: env.smtpPort === 587,
    auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
  });
}

function fromHeader(companyName) {
  const address = env.mailFromAddress || env.smtpUser;
  const name = companyName || env.mailFromName;
  if (name) {
    return `"${name}" <${address}>`;
  }
  return address;
}

const transport = createTransport();

async function sendMail({ to, subject, text, html, fromName }) {
  if (!transport) {
    if (env.nodeEnv !== 'production') {
      console.log(`[email skipped] to=${to} subject=${subject}\n${text}`);
    }
    return { sent: false };
  }

  await transport.sendMail({
    from: fromHeader(fromName),
    replyTo: env.mailReplyTo || undefined,
    to,
    subject,
    text,
    html,
  });
  return { sent: true };
}

async function sendInspectorCredentials({ to, name, password, companyName, company }) {
  const payload = company
    ? brandedInspectorCredentialsEmail({ to, name, password, company })
    : require('../utils/inspectorCredentials.email').inspectorCredentialsEmail({
      to,
      name,
      password,
      companyName,
    });

  return sendMail({
    to,
    ...payload,
    fromName: company?.branding?.companyDisplayName || company?.name || companyName,
  });
}

async function sendBrandedReportShare({
  to,
  recipientName,
  company,
  reportTitle,
  jobNumber,
  pdfUrl,
  shareUrl,
}) {
  const payload = brandedReportShareEmail({
    to,
    recipientName,
    company,
    reportTitle,
    jobNumber,
    pdfUrl,
    shareUrl,
  });
  return sendMail({
    to,
    ...payload,
    fromName: company?.branding?.companyDisplayName || company?.name,
  });
}

module.exports = { sendMail, sendInspectorCredentials, sendBrandedReportShare };
