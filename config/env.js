'use strict';

require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is missing in .env`);
  }
  return value;
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 8000,
  mongodbUri: required('MONGODB_URI'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  platformAdminEmail: process.env.PLATFORM_ADMIN_EMAIL || 'jordan@roofclaim.io',
  platformAdminPassword: process.env.PLATFORM_ADMIN_PASSWORD || 'password',
  weatherProvider: process.env.WEATHER_PROVIDER || 'open_meteo',
  weatherWindowDays: Number(process.env.WEATHER_WINDOW_DAYS) || 1,
  weatherCacheTtlHours: Number(process.env.WEATHER_CACHE_TTL_HOURS) || 24,
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: Number(process.env.SMTP_PORT) || 587,
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: (process.env.SMTP_PASS || '').replace(/\s+/g, ''),
  mailFromName: process.env.EMAIL_FROM_NAME || 'RoofClaim',
  mailFromAddress: process.env.EMAIL_FROM || process.env.MAIL_FROM || process.env.SMTP_USER || '',
  mailReplyTo: process.env.EMAIL_REPLY_TO || '',
  googleClientIds: String(process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
};
