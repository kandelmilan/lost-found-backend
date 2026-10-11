const { sequelize } = require('../../models');

async function health(req, res) {
  let database = 'up';
  try {
    await sequelize.authenticate();
  } catch {
    database = 'down';
  }

  const healthy = database === 'up';
  res.status(healthy ? 200 : 503).json({
    success: healthy,
    message: healthy ? 'Service is healthy' : 'Service is degraded',
    data: {
      status: healthy ? 'ok' : 'degraded',
      database,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
}

module.exports = { health };
