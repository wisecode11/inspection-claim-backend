'use strict';

function toUserResponse(user) {
  return {
    id: String(user._id),
    email: user.email,
    role: user.role,
    status: user.status,
    companyId: user.companyId ? String(user.companyId) : null,
    profile: {
      firstName: user.profile?.firstName || '',
      lastName: user.profile?.lastName || '',
      phone: user.profile?.phone || '',
      avatarUrl: user.profile?.avatarUrl || '',
    },
  };
}

module.exports = { toUserResponse };
