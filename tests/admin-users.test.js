const request = require('supertest');
const app = require('../src/app');
const { sequelize, User, AdminLog } = require('../src/models');
const tokenService = require('../src/services/token.service');

const ADMIN = { email: 'users-admin@lostfound.local', password: 'Test@12345' };
const csrfFrom = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];

let agent;
let csrf;
let target;

beforeAll(async () => {
  await User.destroy({ where: { email: [ADMIN.email, 'target@admin-users-test.local'] } });
  await User.create({
    name: 'Users Admin',
    email: ADMIN.email,
    password_hash: await User.hashPassword(ADMIN.password),
    role: 'admin',
  });
  target = await User.create({
    name: 'Target Person',
    email: 'target@admin-users-test.local',
    password_hash: await User.hashPassword('Secret123'),
  });

  agent = request.agent(app);
  const page = await agent.get('/admin/login');
  await agent.post('/admin/login').type('form').send({ _csrf: csrfFrom(page.text), ...ADMIN });
  csrf = csrfFrom((await agent.get('/admin/users')).text);
});

afterAll(async () => {
  await User.destroy({ where: { email: [ADMIN.email, 'target@admin-users-test.local'] } });
  await sequelize.close();
});

describe('Admin users page', () => {
  it('lists and searches users', async () => {
    const res = await agent.get('/admin/users').query({ q: 'Target Person' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Target Person');

    const none = await agent.get('/admin/users').query({ q: 'zzz-no-match-zzz' });
    expect(none.text).toContain('No users found.');
  });

  it('does not list admins', async () => {
    const res = await agent.get('/admin/users').query({ q: 'Users Admin' });
    expect(res.text).toContain('No users found.');
  });

  it('shows user detail, and 404 for admins / bad ids', async () => {
    expect((await agent.get(`/admin/users/${target.id}`)).text).toContain('Moderation history');

    const admin = await User.findOne({ where: { email: ADMIN.email } });
    expect((await agent.get(`/admin/users/${admin.id}`)).status).toBe(404);
    expect((await agent.get('/admin/users/abc')).status).toBe(404);
  });

  it('blocks a user, revokes their sessions, and logs the action', async () => {
    const tokens = await tokenService.issueTokens(target);

    const res = await agent
      .post(`/admin/users/${target.id}/block`)
      .type('form')
      .send({ _csrf: csrf, reason: 'Spam posts' });
    expect(res.status).toBe(302);

    await target.reload();
    expect(target.is_blocked).toBe(true);

    const refresh = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: tokens.refreshToken });
    expect(refresh.status).toBe(401);

    const log = await AdminLog.findOne({ where: { action: 'user.block', target_id: target.id } });
    expect(log.details).toEqual({ reason: 'Spam posts' });

    const page = await agent.get(`/admin/users/${target.id}`);
    expect(page.text).toContain('has been blocked');
    expect(page.text).toContain('Reason: Spam posts');
  });

  it('unblocks a user', async () => {
    const res = await agent.post(`/admin/users/${target.id}/unblock`).type('form').send({ _csrf: csrf });
    expect(res.status).toBe(302);
    await target.reload();
    expect(target.is_blocked).toBe(false);
  });

  it('requires CSRF token to block', async () => {
    const res = await agent.post(`/admin/users/${target.id}/block`).type('form').send({});
    expect(res.status).toBe(403);
  });

  it('cannot block an admin', async () => {
    const admin = await User.findOne({ where: { email: ADMIN.email } });
    const res = await agent.post(`/admin/users/${admin.id}/block`).type('form').send({ _csrf: csrf });
    expect(res.status).toBe(404);
  });
});
