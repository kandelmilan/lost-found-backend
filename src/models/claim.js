const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Claim extends Model {
    static associate(models) {
      Claim.belongsTo(models.Item, { foreignKey: 'item_id', as: 'item' });
      Claim.belongsTo(models.User, { foreignKey: 'claimer_id', as: 'claimer' });
      Claim.hasMany(models.Message, { foreignKey: 'claim_id', as: 'messages' });
    }

    // Is the claim still in play (blocks a second claim by the same person)?
    isActive() {
      return this.status === 'pending' || this.status === 'accepted';
    }
  }

  Claim.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      item_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      claimer_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      status: {
        type: DataTypes.ENUM('pending', 'accepted', 'rejected', 'cancelled', 'completed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      message: { type: DataTypes.TEXT, allowNull: true },
      answer: { type: DataTypes.STRING(100), allowNull: true },
      answer_correct: { type: DataTypes.BOOLEAN, allowNull: true },
      rejection_reason: { type: DataTypes.STRING(500), allowNull: true },
      meeting_place: { type: DataTypes.STRING(255), allowNull: true },
      meeting_at: { type: DataTypes.DATE, allowNull: true },
      meeting_notes: { type: DataTypes.STRING(500), allowNull: true },
      claimer_confirmed_at: { type: DataTypes.DATE, allowNull: true },
      poster_confirmed_at: { type: DataTypes.DATE, allowNull: true },
      decided_at: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      cancelled_at: { type: DataTypes.DATE, allowNull: true },
      cancelled_by: { type: DataTypes.ENUM('claimer', 'poster', 'admin', 'system'), allowNull: true },
      cancel_reason: { type: DataTypes.STRING(500), allowNull: true },
    },
    { sequelize, modelName: 'Claim', tableName: 'claims' },
  );

  return Claim;
};
