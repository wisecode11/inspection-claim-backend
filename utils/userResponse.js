'use strict';

function toUserResponse(user) {
  return {
    id: String(user._id),
    email: user.email,
    role: user.role,
    status: user.status,
    companyId: user.companyId ? String(user.companyId) : null,
    permissions: Array.isArray(user.permissions) ? user.permissions : [],
    profile: {
      firstName: user.profile?.firstName || '',
      lastName: user.profile?.lastName || '',
      phone: user.profile?.phone || '',
      avatarUrl: user.profile?.avatarUrl || '',
      licenseNumber: user.profile?.licenseNumber || '',
      certifications: (user.profile?.certifications || []).map((cert) => ({
        name: cert.name || '',
        issuer: cert.issuer || '',
        number: cert.number || '',
        issuedAt: cert.issuedAt || null,
        expiresAt: cert.expiresAt || null,
      })),
    },
  };
}

module.exports = { toUserResponse };
