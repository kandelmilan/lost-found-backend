const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Message extends Model {
    static associate(models) {
      Message.belongsTo(models.Claim, { foreignKey: 'claim_id', as: 'claim' });
      Message.belongsTo(models.User, { foreignKey: 'sender_id', as: 'sender' });
    }
  }

  Message.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      claim_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      sender_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      body: { type: DataTypes.TEXT, allowNull: false },
      read_at: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, modelName: 'Message', tableName: 'messages' },
  );

  return Message;
};
