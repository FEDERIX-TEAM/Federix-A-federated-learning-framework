require('dotenv').config();

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  host: process.env.HOST || '0.0.0.0',

  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/federix_central',
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev_access_secret_change_me',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret_change_me',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  internalServiceToken: process.env.INTERNAL_SERVICE_TOKEN || 'dev_internal_service_token_change_me',
  flServerIps: (process.env.FL_SERVER_ALLOWED_IPS || '127.0.0.1,::1,::ffff:127.0.0.1')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  signedUrl: {
    secret: process.env.SIGNED_URL_SECRET || 'dev_signed_url_secret_change_me',
    defaultTtlSeconds: 600, // 10 minutes, per spec for model downloads
  },

  supportedSdkVersions: (process.env.SUPPORTED_SDK_VERSIONS || '1.0.0,1.1.0').split(','),
  serverTimezone: process.env.SERVER_TIMEZONE || 'Asia/Kolkata',
  maxUpdateSizeMb: parseInt(process.env.MAX_UPDATE_SIZE_MB || '256', 10),

  buildInfo: {
    apiVersion: 'v1',
    build: process.env.BUILD_ID || 'dev-local',
  },
};
