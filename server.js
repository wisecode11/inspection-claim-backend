'use strict';

require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');

const PORT = Number(process.env.PORT) || 8000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is missing in .env');
}

async function connectMongo() {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is missing in .env');
  }

  await mongoose.connect(MONGODB_URI);
  console.log('MongoDB connected');
}

async function startServer() {
  await connectMongo();

  require('./models');
  await require('./utils/repairClientUuidIndexes')(mongoose);
  await require('./utils/repairTenantIndexes')(mongoose);
  console.log('Client uuid and tenant indexes repaired');

  const app = express();
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });
  app.use(express.json());
  app.use('/api', require('./routes'));

  app.get('/', (_req, res) => {
    res.json({
      server: 'connected',
      port: PORT,
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    });
  });

  app.use(require('./middlewares/error.middleware'));

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server connected on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error.message);
  process.exit(1);
});
