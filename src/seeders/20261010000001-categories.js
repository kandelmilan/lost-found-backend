'use strict';

const categories = [
  { name: 'Phone', slug: 'phone', icon: 'smartphone' },
  { name: 'Wallet', slug: 'wallet', icon: 'wallet' },
  { name: 'Bag', slug: 'bag', icon: 'backpack' },
  { name: 'Keys', slug: 'keys', icon: 'key' },
  { name: 'Documents', slug: 'documents', icon: 'id-card' },
  { name: 'Electronics', slug: 'electronics', icon: 'laptop' },
  { name: 'Jewelry', slug: 'jewelry', icon: 'gem' },
  { name: 'Pets', slug: 'pets', icon: 'paw' },
  { name: 'Clothing', slug: 'clothing', icon: 'shirt' },
  { name: 'Other', slug: 'other', icon: 'box' },
];

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    await queryInterface.bulkInsert(
      'categories',
      categories.map((c, i) => ({ ...c, sort_order: i + 1, is_active: true, created_at: now, updated_at: now })),
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('categories', {
      slug: { [Sequelize.Op.in]: categories.map((c) => c.slug) },
    });
  },
};
