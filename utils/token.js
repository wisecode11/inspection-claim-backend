'use strict';

const jwt = require('jsonwebtoken');

function signToken(user) {
  return jwt.sign(
    {
      sub: String(user._id),
      role: user.role,
      companyId: user.companyId ? String(user.companyId) : null,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = { signToken, verifyToken };
