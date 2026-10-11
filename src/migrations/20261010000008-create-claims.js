'use strict';

/**
 * A claim is one person's request on someone else's post, and — once accepted — the handover itself.
 *  - On a FOUND item: "This is mine" from the owner (must answer the secret question).
 *  - On a LOST item: "I found this" from a finder.
 * The item's poster accepts or rejects. After acceptance both sides agree a meeting
 * and each confirms the return; when both have confirmed the claim is completed.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('claims', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      item_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'items', key: 'id' },
        onDelete: 'CASCADE',
      },
      claimer_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      status: {
        type: Sequelize.ENUM('pending', 'accepted', 'rejected', 'cancelled', 'completed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      message: { type: Sequelize.TEXT, allowNull: true },
      answer: { type: Sequelize.STRING(100), allowNull: true },
      answer_correct: { type: Sequelize.BOOLEAN, allowNull: true },
      rejection_reason: { type: Sequelize.STRING(500), allowNull: true },
      meeting_place: { type: Sequelize.STRING(255), allowNull: true },
      meeting_at: { type: Sequelize.DATE, allowNull: true },
      meeting_notes: { type: Sequelize.STRING(500), allowNull: true },
      claimer_confirmed_at: { type: Sequelize.DATE, allowNull: true },
      poster_confirmed_at: { type: Sequelize.DATE, allowNull: true },
      decided_at: { type: Sequelize.DATE, allowNull: true },
      completed_at: { type: Sequelize.DATE, allowNull: true },
      cancelled_at: { type: Sequelize.DATE, allowNull: true },
      cancelled_by: { type: Sequelize.ENUM('claimer', 'poster', 'admin', 'system'), allowNull: true },
      cancel_reason: { type: Sequelize.STRING(500), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('claims', ['item_id', 'status']);
    await queryInterface.addIndex('claims', ['claimer_id', 'status']);
    await queryInterface.addIndex('claims', ['status', 'created_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('claims');
  },
};
