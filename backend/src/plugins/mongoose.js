const fp = require('fastify-plugin');
const mongoose = require('mongoose');
const config = require('../config');

async function mongoosePlugin(fastify) {
  mongoose.set('strictQuery', true);
  mongoose.set('bufferCommands', false); // fail fast instead of buffering ops while disconnected

  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 3000 });
    fastify.log.info(`MongoDB connected: ${config.mongoUri}`);
  } catch (err) {
    fastify.log.error({ err }, 'MongoDB connection failed — server continues, DB calls will fail until it recovers.');
  }

  mongoose.connection.on('disconnected', () => {
    fastify.log.warn('MongoDB disconnected');
  });

  fastify.decorate('mongoose', mongoose);

  fastify.addHook('onClose', async () => {
    await mongoose.disconnect();
  });
}

module.exports = fp(mongoosePlugin, { name: 'mongoose-plugin' });
