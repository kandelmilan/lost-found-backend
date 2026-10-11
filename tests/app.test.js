const request = require('supertest');
const app = require('../src/app');
const { sequelize, User } = require('../src/models');

const ADMIN = { email: 'test-admin@lostfound.local', password: 'Test@12345' };

beforeAll(async () => {
  await User.destroy({ where: { email: ADMIN.email } });
  await User.create({
    name: 'Test Admin',
    email: ADMIN.email,
    password_hash: await User.hashPassword(ADMIN.password),
    role: 'admin',
  });
});

afterAll(async () => {
  await User.destroy({ where: { email: ADMIN.email } });
  await sequelize.close();
});

describe('API', () => {
  it('GET /api/v1/health returns ok with database up', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.database).toBe('up');
  });

  it('GET /api/v1/categories returns a list', async () => {
    const res = await request(app).get('/api/v1/categories');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('unknown route returns JSON 404', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('invalid JSON body returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{bad json');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid JSON body');
  });
});

describe('Admin website', () => {
  const csrfFrom = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];

  it('redirects to login when not signed in', async () => {
    const res = await request(app).get('/admin');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/login');
  });

  it('rejects login without CSRF token', async () => {
    const agent = request.agent(app);
    await agent.get('/admin/login');
    const res = await agent.post('/admin/login').type('form').send(ADMIN);
    expect(res.status).toBe(403);
  });

  it('rejects wrong password', async () => {
    const agent = request.agent(app);
    const page = await agent.get('/admin/login');
    const res = await agent
      .post('/admin/login')
      .type('form')
      .send({ _csrf: csrfFrom(page.text), email: ADMIN.email, password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.text).toContain('Invalid email or password');
  });

  it('logs in, shows dashboard, and logs out', async () => {
    const agent = request.agent(app);
    const page = await agent.get('/admin/login');
    const login = await agent
      .post('/admin/login')
      .type('form')
      .send({ _csrf: csrfFrom(page.text), ...ADMIN });
    expect(login.status).toBe(302);
    expect(login.headers.location).toBe('/admin');

    const dash = await agent.get('/admin');
    expect(dash.status).toBe(200);
    expect(dash.text).toContain('Recent admin activity');

    const logout = await agent.post('/admin/logout').type('form').send({ _csrf: csrfFrom(dash.text) });
    expect(logout.status).toBe(302);
    expect((await agent.get('/admin')).headers.location).toBe('/admin/login');
  });
});
