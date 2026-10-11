'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('items', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      category_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'categories', key: 'id' },
        onDelete: 'RESTRICT',
      },
      type: { type: Sequelize.ENUM('lost', 'found'), allowNull: false },
      title: { type: Sequelize.STRING(120), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      event_date: { type: Sequelize.DATEONLY, allowNull: false },
      area_name: { type: Sequelize.STRING(150), allowNull: false },
      latitude: { type: Sequelize.DECIMAL(10, 7), allowNull: false },
      longitude: { type: Sequelize.DECIMAL(10, 7), allowNull: false },
      secret_question: { type: Sequelize.STRING(255), allowNull: true },
      secret_answer_hash: { type: Sequelize.STRING(255), allowNull: true },
      status: {
        type: Sequelize.ENUM('open', 'claimed', 'returned', 'closed'),
        allowNull: false,
        defaultValue: 'open',
      },
      is_hidden: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      hidden_reason: { type: Sequelize.STRING(500), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('items', ['type', 'status', 'is_hidden', 'created_at'], { name: 'items_feed' });
    await queryInterface.addIndex('items', ['category_id']);
    await queryInterface.addIndex('items', ['user_id']);
    await queryInterface.addIndex('items', ['latitude', 'longitude'], { name: 'items_location' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('items');
  },
};
