'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('users', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      name: { type: Sequelize.STRING(100), allowNull: false },
      email: { type: Sequelize.STRING(191), allowNull: true, unique: true },
      phone: { type: Sequelize.STRING(20), allowNull: true, unique: true },
      password_hash: { type: Sequelize.STRING(255), allowNull: false },
      avatar_url: { type: Sequelize.STRING(500), allowNull: true },
      fcm_token: { type: Sequelize.STRING(500), allowNull: true },
      role: { type: Sequelize.ENUM('user', 'admin'), allowNull: false, defaultValue: 'user' },
      is_blocked: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      is_verified: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      returned_count: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      last_login_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('users', ['role']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('users');
  },
};
