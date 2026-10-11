const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class RefreshToken extends Model {
    static associate(models) {
      RefreshToken.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    }

    isActive() {
      return !this.revoked_at && this.expires_at > new Date();
    }
  }

  RefreshToken.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      token_hash: { type: DataTypes.STRING(128), allowNull: false, unique: true },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      revoked_at: { type: DataTypes.DATE, allowNull: true },
      user_agent: { type: DataTypes.STRING(255), allowNull: true },
    },
    { sequelize, modelName: 'RefreshToken', tableName: 'refresh_tokens' },
  );

  return RefreshToken;
};
