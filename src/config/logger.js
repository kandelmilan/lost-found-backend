const path = require('path');
const winston = require('winston');
const env = require('./env');

const logDir = path.resolve(__dirname, '..', '..', 'logs');

const logger = winston.createLogger({
  level: env.isProduction ? 'info' : 'debug',
  silent: env.isTest,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.Console({
      format: env.isProduction
        ? winston.format.json()
        : winston.format.combine(winston.format.colorize(), winston.format.simple()),
    }),
  ],
});

if (env.isProduction) {
  logger.add(new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' }));
  logger.add(new winston.transports.File({ filename: path.join(logDir, 'combined.log') }));
}

module.exports = logger;
