const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Notification extends Model {
    static associate(models) {
      Notification.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    }

    toJSON() {
      return {
        id: this.id,
        type: this.type,
        title: this.title,
        body: this.body,
        data: this.data || {},
        is_read: Boolean(this.read_at),
        createdAt: this.createdAt,
      };
    }
  }

  Notification.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      type: { type: DataTypes.STRING(40), allowNull: false },
      title: { type: DataTypes.STRING(150), allowNull: false },
      body: { type: DataTypes.STRING(500), allowNull: false },
      data: { type: DataTypes.JSON, allowNull: true },
      read_at: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, modelName: 'Notification', tableName: 'notifications' },
  );

  return Notification;
};
