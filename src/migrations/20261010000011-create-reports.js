'use strict';

// User reports about a post or another user, reviewed by admins.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('reports', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      reporter_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      target_type: { type: Sequelize.ENUM('item', 'user'), allowNull: false },
      // No foreign key: the report must survive if the item/user is deleted.
      target_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
      reason: {
        type: Sequelize.ENUM('spam', 'fake', 'scam', 'offensive', 'personal_info', 'other'),
        allowNull: false,
      },
      details: { type: Sequelize.TEXT, allowNull: true },
      status: { type: Sequelize.ENUM('open', 'resolved', 'dismissed'), allowNull: false, defaultValue: 'open' },
      admin_note: { type: Sequelize.STRING(500), allowNull: true },
      resolved_by: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      resolved_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('reports', ['status', 'created_at']);
    await queryInterface.addIndex('reports', ['target_type', 'target_id']);
    await queryInterface.addIndex('reports', ['reporter_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('reports');
  },
};
