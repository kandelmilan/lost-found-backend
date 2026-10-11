'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('item_images', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      item_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'items', key: 'id' },
        onDelete: 'CASCADE',
      },
      // Where the file lives in storage (local path today, Cloudinary public_id later).
      storage_key: { type: Sequelize.STRING(255), allowNull: false },
      url: { type: Sequelize.STRING(500), allowNull: false },
      width: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      height: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('item_images', ['item_id', 'sort_order']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('item_images');
  },
};
