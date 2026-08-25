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

  // Stripe webhooks require the raw body for signature verification.
  app.post(
    '/api/stripe/webhook',
    express.raw({ type: 'application/json' }),
    require('./controllers/stripe.controller').webhook
  );

  app.use(express.json({ limit: '50mb' }));
  app.use('/api', require('./routes'));

  app.get('/', (_req, res) => {
    res.json({
      server: 'connected',
      port: env.port,
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      stripe: env.stripeSecretKey ? 'configured' : 'missing',
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
