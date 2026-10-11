const request = require('supertest');
const { Op } = require('sequelize');
const { sequelize, User, Item, Report, Notification, AdminLog } = require('../src/models');
const { app, createUser, loginToken, ensureCategory, adminAgent, bearer } = require('./helpers');

const DOMAIN = '@admin-p5-test.example.com';
const ADMIN_EMAIL = `admin${DOMAIN}`;
let agent;
let csrf;
let posterToken;
let reporterToken;
let poster;
let category;

async function postItem(title) {
  return (
    await request(app)
      .post('/api/v1/items')
      .set(bearer(posterToken))
      .field('type', 'lost')
      .field('title', title)
      .field('category_id', String(category.id))
      .field('event_date', new Date().toISOString().slice(0, 10))
      .field('area_name', 'Kalanki')
      .field('latitude', '27.6935')
      .field('longitude', '85.2817')
  ).body.data;
}

const report = (body) => request(app).post('/api/v1/reports').set(bearer(reporterToken)).send(body);

beforeAll(async () => {
  await User.destroy({ where: { email: { [Op.like]: `%${DOMAIN}` } } });
  category = await ensureCategory('keys', 'Keys');
  poster = await createUser(`poster${DOMAIN}`, { name: 'P5 Poster' });
  await createUser(`reporter${DOMAIN}`, { name: 'P5 Reporter' });
  posterToken = await loginToken(`poster${DOMAIN}`);
  reporterToken = await loginToken(`reporter${DOMAIN}`);
  ({ agent, csrf } = await adminAgent(ADMIN_EMAIL));
});

afterAll(async () => {
  await User.destroy({ where: { email: { [Op.like]: `%${DOMAIN}` } } });
  await sequelize.close();
});

describe('Admin reports', () => {
  it('lists and shows reports', async () => {
    const item = await postItem('Reported keys one');
    const { id } = (await report({ target_type: 'item', target_id: item.id, reason: 'scam', details: 'Wants money first' })).body.data;

    const list = await agent.get('/admin/reports').query({ status: 'open', target_type: 'item' });
    expect(list.status).toBe(200);
    expect(list.text).toContain('Reported keys one');
    expect(list.text).toContain('Scam / asking for money');

    const detail = await agent.get(`/admin/reports/${id}`);
    expect(detail.text).toContain('Wants money first');
    expect(detail.text).toContain('Hide the post from the app');
  });

  it('resolves by hiding the item; the owner is told; related reports close too', async () => {
    const item = await postItem('Reported keys two');
    const first = (await report({ target_type: 'item', target_id: item.id, reason: 'fake' })).body.data;
    // A second, separate report on the same item from another account.
    await createUser(`second${DOMAIN}`);
    const secondToken = await loginToken(`second${DOMAIN}`);
    const second = (await request(app).post('/api/v1/reports').set(bearer(secondToken)).send({ target_type: 'item', target_id: item.id, reason: 'spam' })).body.data;

    const res = await agent
      .post(`/admin/reports/${first.id}/resolve`)
      .type('form')
      .send({ _csrf: csrf, action: 'hide_item', note: 'Fake listing' });
    expect(res.status).toBe(302);

    expect((await Item.findByPk(item.id)).is_hidden).toBe(true);
    expect((await Item.findByPk(item.id)).hidden_reason).toBe('Fake listing');
    expect((await Report.findByPk(first.id)).status).toBe('resolved');
    expect((await Report.findByPk(second.id)).status).toBe('resolved');

    const note = await Notification.findOne({ where: { user_id: poster.id, type: 'item.hidden' }, order: [['id', 'DESC']] });
    expect(note.body).toContain('Fake listing');
    expect(await AdminLog.count({ where: { action: 'report.resolve', target_id: first.id } })).toBe(1);
  });

  it('resolves by blocking the reported person', async () => {
    const victim = await createUser(`victim${DOMAIN}`, { name: 'P5 Victim' });
    const { id } = (await report({ target_type: 'user', target_id: victim.id, reason: 'offensive' })).body.data;
    await agent.post(`/admin/reports/${id}/resolve`).type('form').send({ _csrf: csrf, action: 'block_user' });
    expect((await User.findByPk(victim.id)).is_blocked).toBe(true);
  });

  it('dismisses, and refuses to close twice', async () => {
    const item = await postItem('Reported keys three');
    const { id } = (await report({ target_type: 'item', target_id: item.id, reason: 'other' })).body.data;
    await agent.post(`/admin/reports/${id}/dismiss`).type('form').send({ _csrf: csrf, note: 'Looks fine' });
    const after = await Report.findByPk(id);
    expect(after.status).toBe('dismissed');
    expect(after.admin_note).toBe('Looks fine');
    expect((await Item.findByPk(item.id)).is_hidden).toBe(false);

    const again = await agent.post(`/admin/reports/${id}/resolve`).type('form').send({ _csrf: csrf });
    expect(again.status).toBe(400);
  });

  it('exports reports as CSV', async () => {
    const res = await agent.get('/admin/reports/export');
    expect(res.status).toBe(200);
    expect(res.text).toContain('ID,About,Target ID');
  });
});

describe('Activity logs', () => {
  it('lists, filters by area and searches by label', async () => {
    const all = await agent.get('/admin/logs');
    expect(all.status).toBe(200);
    expect(all.text).toContain('Resolved a report');

    const blocked = await agent.get('/admin/logs').query({ q: 'blocked' });
    expect(blocked.text).toContain('Blocked a user');
    expect(blocked.text).not.toContain('Resolved a report');

    const reports = await agent.get('/admin/logs').query({ area: 'report' });
    expect(reports.text).toContain('Dismissed a report');
    expect(reports.text).not.toContain('Blocked a user');

    const csv = await agent.get('/admin/logs/export').query({ area: 'report' });
    expect(csv.text).toContain('report.dismiss');
  });
});

describe('Settings', () => {
  const change = (a, c, body) => a.post('/admin/settings/password').type('form').send({ _csrf: c, ...body });

  it('validates the password change', async () => {
    const wrong = await change(agent, csrf, { current_password: 'nope', new_password: 'NewPassw0rd!', confirm_password: 'NewPassw0rd!' });
    expect(wrong.status).toBe(400);
    expect(wrong.text).toContain('current password is incorrect');

    const mismatch = await change(agent, csrf, { current_password: 'Test@12345', new_password: 'NewPassw0rd!', confirm_password: 'Other' });
    expect(mismatch.text).toContain('do not match');

    const weak = await change(agent, csrf, { current_password: 'Test@12345', new_password: 'short1', confirm_password: 'short1' });
    expect(weak.text).toContain('at least 10');
  });

  it('changes the password and signs out other sessions', async () => {
    // A second signed-in browser for the same admin.
    const other = request.agent(app);
    const page = await other.get('/admin/login');
    const token = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
    await other.post('/admin/login').type('form').send({ _csrf: token, email: ADMIN_EMAIL, password: 'Test@12345' });
    expect((await other.get('/admin')).status).toBe(200);

    const res = await change(agent, csrf, { current_password: 'Test@12345', new_password: 'NewPassw0rd!', confirm_password: 'NewPassw0rd!' });
    expect(res.status).toBe(302);

    // This browser stays in; the other one is signed out.
    expect((await agent.get('/admin/settings')).text).toContain('Password changed');
    expect((await other.get('/admin')).headers.location).toBe('/admin/login');

    const admin = await User.findOne({ where: { email: ADMIN_EMAIL } });
    expect(await admin.checkPassword('NewPassw0rd!')).toBe(true);
  });
});
