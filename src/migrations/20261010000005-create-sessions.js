'use strict';

// Stores admin website login sessions (used by connect-session-sequelize).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('sessions', {
      sid: { type: Sequelize.STRING(64), primaryKey: true },
      expires: { type: Sequelize.DATE, allowNull: true },
      data: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('sessions', ['expires']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('sessions');
  },
};
