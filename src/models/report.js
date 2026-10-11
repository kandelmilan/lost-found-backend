const { DataTypes, Model } = require('sequelize');

const REASONS = ['spam', 'fake', 'scam', 'offensive', 'personal_info', 'other'];

module.exports = (sequelize) => {
  class Report extends Model {
    static associate(models) {
      Report.belongsTo(models.User, { foreignKey: 'reporter_id', as: 'reporter' });
      Report.belongsTo(models.User, { foreignKey: 'resolved_by', as: 'resolver' });
    }
  }

  Report.REASONS = REASONS;

  Report.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      reporter_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      target_type: { type: DataTypes.ENUM('item', 'user'), allowNull: false },
      target_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      reason: { type: DataTypes.ENUM(...REASONS), allowNull: false },
      details: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.ENUM('open', 'resolved', 'dismissed'), allowNull: false, defaultValue: 'open' },
      admin_note: { type: DataTypes.STRING(500), allowNull: true },
      resolved_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      resolved_at: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, modelName: 'Report', tableName: 'reports' },
  );

  return Report;
};
