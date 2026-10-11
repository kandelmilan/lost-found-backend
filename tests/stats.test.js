const request = require('supertest');
const { sequelize, Item } = require('../src/models');
const { app, createUser, ensureCategory } = require('./helpers');

describe('GET /api/v1/stats', () => {
  let user;
  let category;

  beforeAll(async () => {
    user = await createUser('stats@stats-test.example.com');
    category = await ensureCategory('stats-test', 'Stats test');
  });

  afterAll(async () => {
    await Item.destroy({ where: { user_id: user.id }, force: true });
    await sequelize.close();
  });

  const make = (type, extra = {}) =>
    Item.create({
      user_id: user.id,
      category_id: category.id,
      type,
      title: `Stats ${type}`,
      event_date: new Date(),
      area_name: 'Ratnapark',
      latitude: 27.7,
      longitude: 85.3,
      ...extra,
    });

  it('counts today\'s visible lost and found posts', async () => {
    const before = (await request(app).get('/api/v1/stats')).body.data;
    await make('lost');
    await make('found');
    await make('found', { is_hidden: true });

    const res = await request(app).get('/api/v1/stats');
    expect(res.status).toBe(200);
    expect(res.body.data.lost_today).toBe(before.lost_today + 1);
    expect(res.body.data.found_today).toBe(before.found_today + 1);
    expect(typeof res.body.data.returned_week).toBe('number');
  });
});
