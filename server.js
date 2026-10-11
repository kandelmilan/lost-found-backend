const http = require('http');
const env = require('./src/config/env');
const logger = require('./src/config/logger');
const app = require('./src/app');
const { sequelize } = require('./src/models');
const { initSocket, closeSocket } = require('./src/socket');

const server = http.createServer(app);
initSocket(server);

async function start() {
  try {
    await sequelize.authenticate();
    logger.info(`Database connected (${env.db.name})`);
  } catch (err) {
    logger.error(`Database connection failed: ${err.message}`);
    process.exit(1);
  }

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${env.port} is already in use. Stop the other server (Ctrl + C) or find it with: lsof -i :${env.port}`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(env.port, () => {
    logger.info(`Server running on ${env.appUrl} [${env.nodeEnv}]`);
    if (env.swaggerEnabled) logger.info(`API docs:  ${env.appUrl}/api-docs`);
    logger.info(`Admin:     ${env.appUrl}/admin`);
  });
}

function shutdown(signal) {
  logger.info(`${signal} received, shutting down...`);
  server.close(async () => {
    await closeSocket();
    await sequelize.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection', { reason }));

start();
