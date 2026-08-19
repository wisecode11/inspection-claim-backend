'use strict';

const { Tenant } = require('../models');
const { toUserResponse } = require('./userResponse');
const { toCompanyResponse } = require('./companyResponse');

async function toSessionResponse(user, extra = {}) {
  const company = user.companyId ? await Tenant.findById(user.companyId) : null;
  return {
    user: toUserResponse(user),
    company: toCompanyResponse(company),
    ...extra,
  };
}

module.exports = { toSessionResponse };
