'use strict';

const { User } = require('../models');
const HttpError = require('../utils/httpError');
const { USER_STATUSES } = require('../models/enums');
const { verifyAccessToken } = require('../utils/token');

async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      throw new HttpError(401, 'Login required');
    }

    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);
    if (!user) {
      throw new HttpError(401, 'User not found');
    }
    if (user.status === USER_STATUSES.SUSPENDED || user.status === USER_STATUSES.DEACTIVATED) {
      throw new HttpError(403, 'Account is not active');
    }

    req.user = user;
    req.auth = {
      id: String(user._id),
      role: user.role,
      companyId: user.companyId ? String(user.companyId) : null,
    };
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return next(new HttpError(401, 'Invalid or expired token'));
    }
    next(error);
  }
}

function optionalAuthenticate(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return next();
  }
  return authenticate(req, res, next);
}

function requireRoles(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new HttpError(403, 'Not allowed for this role'));
    }
    next();
  };
}

function requireCompany(req, _res, next) {
  if (!req.user.companyId) {
    return next(new HttpError(400, 'Create a company first'));
  }
  next();
}

module.exports = { authenticate, optionalAuthenticate, requireRoles, requireCompany };
