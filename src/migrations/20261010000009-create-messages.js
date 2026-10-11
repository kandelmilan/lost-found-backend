'use strict';

// Chat messages. Each claim is one conversation between the claimer and the item's poster.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('messages', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      claim_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'claims', key: 'id' },
        onDelete: 'CASCADE',
      },
      sender_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      body: { type: Sequelize.TEXT, allowNull: false },
      read_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('messages', ['claim_id', 'id']);
    await queryInterface.addIndex('messages', ['claim_id', 'sender_id', 'read_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('messages');
  },
};
