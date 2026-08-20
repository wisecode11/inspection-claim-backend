'use strict';

const nodemailer = require('nodemailer');
const env = require('../config/env');
const { inspectorCredentialsEmail } = require('../utils/inspectorCredentials.email');

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

function fromHeader() {
  const address = env.mailFromAddress || env.smtpUser;
  if (env.mailFromName) {
    return `"${env.mailFromName}" <${address}>`;
  }
  return address;
}

const transport = createTransport();

async function sendMail({ to, subject, text, html }) {
  if (!transport) {
    if (env.nodeEnv !== 'production') {
      console.log(`[email skipped] to=${to} subject=${subject}\n${text}`);
    }
    return { sent: false };
  }

  await transport.sendMail({
    from: fromHeader(),
    replyTo: env.mailReplyTo || undefined,
    to,
    subject,
    text,
    html,
  });
  return { sent: true };
}

async function sendInspectorCredentials({ to, name, password, companyName }) {
  return sendMail({
    to,
    ...inspectorCredentialsEmail({ to, name, password, companyName }),
  });
}

module.exports = { sendMail, sendInspectorCredentials };
