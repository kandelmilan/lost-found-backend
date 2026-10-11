const { Sequelize } = require('sequelize');
const env = require('../config/env');
const dbConfig = require('../config/database')[env.nodeEnv];

const sequelize = new Sequelize(dbConfig.database, dbConfig.username, dbConfig.password, dbConfig);

const models = {
  User: require('./user')(sequelize),
  RefreshToken: require('./refreshToken')(sequelize),
  Category: require('./category')(sequelize),
  Item: require('./item')(sequelize),
  ItemImage: require('./itemImage')(sequelize),
  Claim: require('./claim')(sequelize),
  Message: require('./message')(sequelize),
  Notification: require('./notification')(sequelize),
  Report: require('./report')(sequelize),
  AdminLog: require('./adminLog')(sequelize),
  Session: require('./session')(sequelize),
};

Object.values(models).forEach((model) => {
  if (typeof model.associate === 'function') model.associate(models);
});

module.exports = { sequelize, Sequelize, ...models };
