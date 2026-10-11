const { DataTypes, Model } = require('sequelize');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

module.exports = (sequelize) => {
  class User extends Model {
    static associate(models) {
      User.hasMany(models.RefreshToken, { foreignKey: 'user_id', as: 'refreshTokens' });
      User.hasMany(models.AdminLog, { foreignKey: 'admin_id', as: 'adminLogs' });
      User.hasMany(models.Item, { foreignKey: 'user_id', as: 'items' });
      User.hasMany(models.Claim, { foreignKey: 'claimer_id', as: 'claims' });
    }

    static hashPassword(plain) {
      return bcrypt.hash(plain, SALT_ROUNDS);
    }

    checkPassword(plain) {
      return bcrypt.compare(plain, this.password_hash);
    }

    isAdmin() {
      return this.role === 'admin';
    }

    toJSON() {
      const values = { ...this.get() };
      delete values.password_hash;
      delete values.fcm_token;
      return values;
    }
  }

  User.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
      email: {
        type: DataTypes.STRING(191),
        allowNull: true,
        unique: true,
        set(value) {
          this.setDataValue('email', value ? String(value).trim().toLowerCase() : null);
        },
      },
      phone: { type: DataTypes.STRING(20), allowNull: true, unique: true },
      password_hash: { type: DataTypes.STRING(255), allowNull: false },
      avatar_url: { type: DataTypes.STRING(500), allowNull: true },
      fcm_token: { type: DataTypes.STRING(500), allowNull: true },
      role: { type: DataTypes.ENUM('user', 'admin'), allowNull: false, defaultValue: 'user' },
      is_blocked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      is_verified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      returned_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      last_login_at: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, modelName: 'User', tableName: 'users' },
  );

  return User;
};
