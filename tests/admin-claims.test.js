const request = require('supertest');
const { Op } = require('sequelize');
const { sequelize, User, Item, Claim, AdminLog } = require('../src/models');
const { app, createUser, loginToken, ensureCategory, adminAgent, bearer } = require('./helpers');

const DOMAIN = '@admin-claims-test.example.com';
let agent;
let csrf;
let finderToken;
let ownerToken;
let category;

async function foundItemWithAcceptedClaim(title) {
  const item = (
    await request(app)
      .post('/api/v1/items')
      .set(bearer(finderToken))
      .field('type', 'found')
      .field('title', title)
      .field('category_id', String(category.id))
      .field('event_date', new Date().toISOString().slice(0, 10))
      .field('area_name', 'Patan')
      .field('latitude', '27.6727')
      .field('longitude', '85.3253')
      .field('secret_question', 'Colour of the strap?')
      .field('secret_answer', 'brown')
  ).body.data;
  const claim = (await request(app).post(`/api/v1/items/${item.id}/claims`).set(bearer(ownerToken)).send({ answer: 'Brown' })).body.data;
  await request(app).post(`/api/v1/claims/${claim.id}/accept`).set(bearer(finderToken));
  return { item, claim };
}

beforeAll(async () => {
  await User.destroy({ where: { email: { [Op.like]: `%${DOMAIN}` } } });
  category = await ensureCategory('wallet', 'Wallet');
  await createUser(`finder${DOMAIN}`, { name: 'Claims Finder' });
  await createUser(`owner${DOMAIN}`, { name: 'Claims Owner' });
  finderToken = await loginToken(`finder${DOMAIN}`);
  ownerToken = await loginToken(`owner${DOMAIN}`);
  ({ agent, csrf } = await adminAgent(`admin${DOMAIN}`));
});

afterAll(async () => {
  await User.destroy({ where: { email: { [Op.like]: `%${DOMAIN}` } } });
  await sequelize.close();
});

describe('Admin claims', () => {
  it('lists, filters and shows claims', async () => {
    const { item, claim } = await foundItemWithAcceptedClaim('Admin claims watch');

    const list = await agent.get('/admin/claims').query({ q: 'Admin claims watch', status: 'accepted' });
    expect(list.status).toBe(200);
    expect(list.text).toContain('Admin claims watch');

    const detail = await agent.get(`/admin/claims/${claim.id}`);
    expect(detail.status).toBe(200);
    expect(detail.text).toContain('Colour of the strap?');
    expect(detail.text).toContain('matches');

    const itemPage = await agent.get(`/admin/items/${item.id}`);
    expect(itemPage.text).toContain(`CL-${String(claim.id).padStart(3, '0')}`);
  });

  it('cancels an accepted claim, reopening the item and logging it', async () => {
    const { item, claim } = await foundItemWithAcceptedClaim('Admin cancel watch');

    const res = await agent.post(`/admin/claims/${claim.id}/cancel`).type('form').send({ _csrf: csrf, reason: 'Disputed' });
    expect(res.status).toBe(302);

    const after = await Claim.findByPk(claim.id);
    expect(after.status).toBe('cancelled');
    expect(after.cancelled_by).toBe('admin');
    expect(after.cancel_reason).toBe('Disputed');
    expect((await Item.findByPk(item.id)).status).toBe('open');
    expect(await AdminLog.count({ where: { action: 'claim.cancel', target_id: claim.id } })).toBe(1);

    // The claimer sees why.
    const seen = await request(app).get(`/api/v1/claims/${claim.id}`).set(bearer(ownerToken));
    expect(seen.body.data.cancelled_by).toBe('admin');
    expect(seen.body.data.cancel_reason).toBe('Disputed');

    // Already cancelled → friendly error page, no change.
    const again = await agent.post(`/admin/claims/${claim.id}/cancel`).type('form').send({ _csrf: csrf });
    expect(again.status).toBe(400);
  });

  it('exports claims as CSV', async () => {
    const res = await agent.get('/admin/claims/export').query({ kind: 'ownership' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('ID,Kind,Status');
    expect(res.text).toContain('Admin claims watch');
  });

  it('shows claim counts on the dashboard', async () => {
    const res = await agent.get('/admin');
    expect(res.text).toMatch(/\d+ pending · \d+ in handover/);
  });
});
