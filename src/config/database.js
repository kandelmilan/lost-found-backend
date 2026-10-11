// Used by both the app (models/index.js) and sequelize-cli (migrations / seeders).
require('dotenv').config({ quiet: true });

// Hosted MySQL (Aiven, TiDB, PlanetScale...) needs TLS. DB_SSL_CA is the provider's CA
// certificate — paste the PEM text, or the same text base64-encoded.
function sslOptions() {
  if (process.env.DB_SSL !== 'true') return undefined;
  const raw = (process.env.DB_SSL_CA || '').trim();
  if (!raw) return { ssl: { rejectUnauthorized: true } };
  const ca = raw.includes('BEGIN CERTIFICATE') ? raw.replace(/\\n/g, '\n') : Buffer.from(raw, 'base64').toString('utf8');
  return { ssl: { ca, rejectUnauthorized: true } };
}

const base = {
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD || null,
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  dialect: 'mysql',
  dialectOptions: sslOptions(),
  timezone: '+00:00',
  define: {
    underscored: true,
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
  },
  migrationStorageTableName: 'sequelize_meta',
  seederStorage: 'sequelize',
  seederStorageTableName: 'sequelize_seeds',
};

module.exports = {
  development: {
    ...base,
    database: process.env.DB_NAME,
    logging: false,
  },
  test: {
    ...base,
    database: process.env.DB_NAME_TEST || `${process.env.DB_NAME}_test`,
    logging: false,
  },
  production: {
    ...base,
    database: process.env.DB_NAME,
    logging: false,
    pool: { max: 10, min: 0, acquire: 30000, idle: 10000 },
  },
};
