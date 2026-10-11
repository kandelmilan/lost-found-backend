const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class AdminLog extends Model {
    static associate(models) {
      AdminLog.belongsTo(models.User, { foreignKey: 'admin_id', as: 'admin' });
    }

    static record(req, action, { targetType = null, targetId = null, details = null } = {}) {
      return AdminLog.create({
        admin_id: req.session?.adminId ?? null,
        action,
        target_type: targetType,
        target_id: targetId,
        details,
        ip: req.ip,
      });
    }
  }

  AdminLog.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      admin_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      action: { type: DataTypes.STRING(60), allowNull: false },
      target_type: { type: DataTypes.STRING(40), allowNull: true },
      target_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      details: { type: DataTypes.JSON, allowNull: true },
      ip: { type: DataTypes.STRING(45), allowNull: true },
    },
    { sequelize, modelName: 'AdminLog', tableName: 'admin_logs' },
  );

  return AdminLog;
};
