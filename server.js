'use strict';

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const env = require('./config/env');
const corsOptions = require('./config/cors');

async function connectMongo() {
  await mongoose.connect(env.mongodbUri);
  console.log('MongoDB connected');
}

async function startServer() {
  await connectMongo();
  require('./models');
  await require('./utils/repairClientUuidIndexes')(mongoose);
  await require('./utils/repairTenantIndexes')(mongoose);
  console.log('Client uuid and tenant indexes repaired');

  const app = express();
  app.set('trust proxy', 1);
  app.use(cors(corsOptions));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', require('./routes'));

  app.get('/', (_req, res) => {
    res.json({
      server: 'connected',
      port: env.port,
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    });
  });

  app.use(require('./middlewares/error.middleware'));

  app.listen(env.port, '0.0.0.0', () => {
    console.log(`Server connected on port ${env.port}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error.message);
  process.exit(1);
});
