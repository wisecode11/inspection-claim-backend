'use strict';

function isMissingNamespace(error) {
  return error?.code === 26 || /ns does not exist/i.test(error?.message || '');
}

async function repairTenantIndexes(mongoose) {
  const Tenant = mongoose.models.Tenant;
  if (!Tenant) return;

  const col = Tenant.collection;
  let indexes = [];
  try {
    indexes = await col.indexes();
  } catch (error) {
    if (!isMissingNamespace(error)) throw error;
    return;
  }

  for (const idx of indexes) {
    const key = idx.key || {};
    if (key['billing.stripeCustomerId'] === 1 && idx.name !== 'billing.stripeCustomerId_unique') {
      await col.dropIndex(idx.name).catch((error) => {
        if (error.code !== 27 && !isMissingNamespace(error)) throw error;
      });
    }
  }

  await col.updateMany(
    { $or: [{ 'billing.stripeCustomerId': '' }, { 'billing.stripeCustomerId': null }] },
    { $unset: { 'billing.stripeCustomerId': 1 } }
  );

  await Tenant.createIndexes();
}

module.exports = repairTenantIndexes;
