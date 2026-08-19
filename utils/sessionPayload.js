'use strict';

const { Tenant } = require('../models');
const { toUserResponse } = require('./userResponse');
const { toCompanyResponse } = require('./companyResponse');

async function toSessionResponse(user, extra = {}) {
  const company = user.companyId ? await Tenant.findById(user.companyId) : null;
  const payload = {
    user: toUserResponse(user),
    company: toCompanyResponse(company),
    ...extra,
  };

  if (payload.tokens && payload.tokens.accessToken) {
    payload.token = payload.tokens.accessToken;
  }

  return payload;
}

module.exports = { toSessionResponse };
