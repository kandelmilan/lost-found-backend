const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class ItemImage extends Model {
    static associate(models) {
      ItemImage.belongsTo(models.Item, { foreignKey: 'item_id', as: 'item' });
    }
  }

  ItemImage.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      item_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      storage_key: { type: DataTypes.STRING(255), allowNull: false },
      url: { type: DataTypes.STRING(500), allowNull: false },
      width: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      height: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    { sequelize, modelName: 'ItemImage', tableName: 'item_images' },
  );

  return ItemImage;
};
