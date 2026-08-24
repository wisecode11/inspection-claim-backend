'use strict';

const env = require('../config/env');
const HttpError = require('../utils/httpError');

let clientPromise = null;

async function getClient() {
  if (!env.googleClientIds.length) {
    throw new HttpError(503, 'Google sign-in is not configured');
  }
  if (!clientPromise) {
    clientPromise = import('google-auth-library').then(
      ({ OAuth2Client }) => new OAuth2Client()
    );
  }
  return clientPromise;
  
}

async function verifyIdToken(idToken) {
  if (!idToken) {
    throw new HttpError(400, 'Google sign-in failed');
  }

  const client = await getClient();
  let ticket;
  try {
    ticket = await client.verifyIdToken({
      idToken,
      audience: env.googleClientIds,
    });
  } catch {
    throw new HttpError(401, 'Google sign-in failed');
  }

  const payload = ticket.getPayload() || {};
  const email = String(payload.email || '').trim().toLowerCase();
  if (!email || !payload.email_verified) {
    throw new HttpError(401, 'Google email is not verified');
  }

  return {
    googleId: payload.sub,
    email,
    firstName: payload.given_name || '',
    lastName: payload.family_name || '',
    avatarUrl: payload.picture || '',
  };
}

module.exports = { verifyIdToken };
