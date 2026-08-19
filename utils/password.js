'use strict';

const bcrypt = require('bcryptjs');

async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

async function comparePassword(plain, passwordHash) {
  return bcrypt.compare(plain, passwordHash);
}

module.exports = { hashPassword, comparePassword };
