require('dotenv').config({ quiet: true });

const required = [
  'DB_HOST',
  'DB_NAME',
  'DB_USER',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'SESSION_SECRET',
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

const path = require('path');
const os = require('os');

const nodeEnv = process.env.NODE_ENV || 'development';

module.exports = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: Number(process.env.PORT) || 5050,
  // Render sets RENDER_EXTERNAL_URL (e.g. https://lost-found-api.onrender.com) automatically.
  appUrl: (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 5050}`).replace(/\/+$/, ''),

  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    name: nodeEnv === 'test' ? process.env.DB_NAME_TEST || `${process.env.DB_NAME}_test` : process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
    refreshExpiresDays: Number(process.env.JWT_REFRESH_EXPIRES_DAYS) || 30,
  },

  sessionSecret: process.env.SESSION_SECRET,

  storage: {
    driver: process.env.STORAGE_DRIVER || 'local',
    cloudinary: {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      apiSecret: process.env.CLOUDINARY_API_SECRET,
      folder: process.env.CLOUDINARY_FOLDER || 'lost-found',
    },
    // Tests write to a temp folder so they never touch real uploads.
    uploadDir:
      nodeEnv === 'test'
        ? path.join(os.tmpdir(), 'lost-found-test-uploads')
        : path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads')),
  },

  corsOrigins: (process.env.CORS_ORIGINS || '*').split(',').map((o) => o.trim()),
  swaggerEnabled: process.env.SWAGGER_ENABLED === 'true',
};
