const { DataTypes, Model } = require('sequelize');

// Admin website sessions, read/written by connect-session-sequelize.
module.exports = (sequelize) => {
  class Session extends Model {}

  Session.init(
    {
      sid: { type: DataTypes.STRING(64), primaryKey: true },
      expires: { type: DataTypes.DATE, allowNull: true },
      data: { type: DataTypes.TEXT, allowNull: true },
    },
    { sequelize, modelName: 'Session', tableName: 'sessions' },
  );

  return Session;
};
