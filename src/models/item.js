const { DataTypes, Model } = require('sequelize');
const bcrypt = require('bcryptjs');

// "  The Red  Wallet " and "the red wallet" should count as the same answer.
const normalizeAnswer = (answer) => String(answer).trim().toLowerCase().replace(/\s+/g, ' ');

module.exports = (sequelize) => {
  class Item extends Model {
    static associate(models) {
      Item.belongsTo(models.User, { foreignKey: 'user_id', as: 'owner' });
      Item.belongsTo(models.Category, { foreignKey: 'category_id', as: 'category' });
      Item.hasMany(models.ItemImage, { foreignKey: 'item_id', as: 'images' });
      Item.hasMany(models.Claim, { foreignKey: 'item_id', as: 'claims' });
    }

    static hashAnswer(answer) {
      return bcrypt.hash(normalizeAnswer(answer), 10);
    }

    checkAnswer(answer) {
      if (!this.secret_answer_hash) return Promise.resolve(false);
      return bcrypt.compare(normalizeAnswer(answer), this.secret_answer_hash);
    }

    isOpen() {
      return this.status === 'open';
    }
  }

  Item.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      category_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      type: { type: DataTypes.ENUM('lost', 'found'), allowNull: false },
      title: { type: DataTypes.STRING(120), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      event_date: { type: DataTypes.DATEONLY, allowNull: false },
      area_name: { type: DataTypes.STRING(150), allowNull: false },
      latitude: { type: DataTypes.DECIMAL(10, 7), allowNull: false },
      longitude: { type: DataTypes.DECIMAL(10, 7), allowNull: false },
      secret_question: { type: DataTypes.STRING(255), allowNull: true },
      secret_answer_hash: { type: DataTypes.STRING(255), allowNull: true },
      status: {
        type: DataTypes.ENUM('open', 'claimed', 'returned', 'closed'),
        allowNull: false,
        defaultValue: 'open',
      },
      is_hidden: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      hidden_reason: { type: DataTypes.STRING(500), allowNull: true },
    },
    { sequelize, modelName: 'Item', tableName: 'items' },
  );

  return Item;
};
