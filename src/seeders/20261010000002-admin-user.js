'use strict';

require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');

const DEFAULT_PASSWORD = 'ChangeMe@123';

module.exports = {
  async up(queryInterface) {
    const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;

    if (!email || !password) {
      throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env to seed the admin user');
    }
    if (process.env.NODE_ENV === 'production' && password === DEFAULT_PASSWORD) {
      throw new Error('Set a strong ADMIN_PASSWORD before seeding in production');
    }

    const now = new Date();
    await queryInterface.bulkInsert('users', [
      {
        name: 'Super Admin',
        email,
        password_hash: await bcrypt.hash(password, 12),
        role: 'admin',
        is_verified: true,
        created_at: now,
        updated_at: now,
      },
    ]);
  },

  async down(queryInterface) {
    const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    await queryInterface.bulkDelete('users', { email, role: 'admin' });
  },
};
