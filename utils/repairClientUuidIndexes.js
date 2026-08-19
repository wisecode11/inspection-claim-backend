'use strict';

const MODEL_NAMES = [
  'Customer',
  'Property',
  'Job',
  'Inspection',
  'Elevation',
  'TestSquare',
  'CollateralItem',
  'Photo',
  'Report',
];

async function repairClientUuidIndexes(mongoose) {
  for (const name of MODEL_NAMES) {
    const Model = mongoose.models[name];
    if (!Model) {
      continue;
    }

    const col = Model.collection;
    const indexes = await col.indexes();
    for (const idx of indexes) {
      const key = idx.key || {};
      const isClientUuidIndex =
        Object.keys(key).length === 2 && key.companyId === 1 && key.clientUuid === 1;
      if (isClientUuidIndex) {
        await col.dropIndex(idx.name).catch((error) => {
          if (error.code !== 27) {
            throw error;
          }
        });
      }
    }

    await col.updateMany(
      { $or: [{ clientUuid: '' }, { clientUuid: null }] },
      { $unset: { clientUuid: 1 } }
    );

    await Model.createIndexes();
  }
}

module.exports = repairClientUuidIndexes;
