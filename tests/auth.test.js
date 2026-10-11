const request = require('supertest');
const { Op } = require('sequelize');
const app = require('../src/app');
const { sequelize, User } = require('../src/models');

const EMAIL_DOMAIN = '@auth-test.example.com';
const PASSWORD = 'Secret123';
let counter = 0;

function newUser(overrides = {}) {
  counter += 1;
  return { name: 'Test User', email: `user${counter}${EMAIL_DOMAIN}`, password: PASSWORD, ...overrides };
}

async function registerUser(overrides) {
  const body = newUser(overrides);
  const res = await request(app).post('/api/v1/auth/register').send(body);
  expect(res.status).toBe(201);
  return { body, ...res.body.data };
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

async function cleanup() {
  await User.destroy({ where: { email: { [Op.like]: `%${EMAIL_DOMAIN}` } } });
  await User.destroy({ where: { phone: { [Op.like]: '+97798111%' } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await sequelize.close();
});

describe('POST /auth/register', () => {
  it('creates a user and returns tokens without the password hash', async () => {
    const { user, tokens } = await registerUser();
    expect(user.id).toBeDefined();
    expect(user.role).toBe('user');
    expect(user.password_hash).toBeUndefined();
    expect(tokens.accessToken).toBeDefined();
    expect(tokens.refreshToken).toBeDefined();
  });

  it('normalises phone numbers', async () => {
    const { user } = await registerUser({ email: undefined, phone: '+977 98-1110-0001' });
    expect(user.phone).toBe('+9779811100001');
  });

  it('requires email or phone', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ name: 'No Contact', password: PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'email|phone' })]));
  });

  it('rejects weak passwords', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(newUser({ password: 'abcdefgh' }));
    expect(res.status).toBe(400);
    expect(res.body.errors[0].message).toMatch(/number/);
  });

  it('rejects duplicate email with 409', async () => {
    const { body } = await registerUser();
    const res = await request(app).post('/api/v1/auth/register').send({ ...body, name: 'Someone Else' });
    expect(res.status).toBe(409);
    expect(res.body.errors[0].field).toBe('email');
  });
});

describe('POST /auth/login', () => {
  it('logs in with email (case-insensitive)', async () => {
    const { body } = await registerUser();
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: body.email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.tokens.accessToken).toBeDefined();
  });

  it('logs in with phone', async () => {
    await registerUser({ phone: '+9779811100002' });
    const res = await request(app).post('/api/v1/auth/login').send({ identifier: '+977 9811100002', password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it('returns the same error for wrong password and unknown user', async () => {
    const { body } = await registerUser();
    const wrong = await request(app).post('/api/v1/auth/login').send({ identifier: body.email, password: 'Wrong1234' });
    const unknown = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: `nobody${EMAIL_DOMAIN}`, password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it('blocks login for blocked users', async () => {
    const { body, user } = await registerUser();
    await User.update({ is_blocked: true }, { where: { id: user.id } });
    const res = await request(app).post('/api/v1/auth/login').send({ identifier: body.email, password: PASSWORD });
    expect(res.status).toBe(403);
  });
});

describe('Tokens', () => {
  it('protects /me', async () => {
    expect((await request(app).get('/api/v1/me')).status).toBe(401);
    expect((await request(app).get('/api/v1/me').set(bearer('garbage'))).status).toBe(401);
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const { tokens } = await registerUser();

    const first = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: tokens.refreshToken });
    expect(first.status).toBe(200);
    const rotated = first.body.data.tokens.refreshToken;
    expect(rotated).not.toBe(tokens.refreshToken);

    // Re-using the old token is treated as theft: every session is revoked.
    const reuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: tokens.refreshToken });
    expect(reuse.status).toBe(401);
    const afterReuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: rotated });
    expect(afterReuse.status).toBe(401);
  });

  it('logout revokes the refresh token', async () => {
    const { tokens } = await registerUser();
    const out = await request(app).post('/api/v1/auth/logout').send({ refreshToken: tokens.refreshToken });
    expect(out.status).toBe(200);
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: tokens.refreshToken });
    expect(res.status).toBe(401);
  });

  it('rejects access tokens of blocked users immediately', async () => {
    const { tokens, user } = await registerUser();
    await User.update({ is_blocked: true }, { where: { id: user.id } });
    const res = await request(app).get('/api/v1/me').set(bearer(tokens.accessToken));
    expect(res.status).toBe(403);
  });
});

describe('/me', () => {
  it('returns and updates the profile', async () => {
    const { tokens } = await registerUser();
    const me = await request(app).get('/api/v1/me').set(bearer(tokens.accessToken));
    expect(me.status).toBe(200);

    const res = await request(app)
      .patch('/api/v1/me')
      .set(bearer(tokens.accessToken))
      .send({ name: 'Renamed User', phone: '+9779811100003' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed User');
    expect(res.body.data.phone).toBe('+9779811100003');
  });

  it('does not allow removing both email and phone', async () => {
    const { tokens } = await registerUser();
    const res = await request(app).patch('/api/v1/me').set(bearer(tokens.accessToken)).send({ email: null });
    expect(res.status).toBe(400);
  });

  it('changes password and signs out other devices', async () => {
    const { body, tokens } = await registerUser();
    const res = await request(app)
      .put('/api/v1/me/password')
      .set(bearer(tokens.accessToken))
      .send({ currentPassword: PASSWORD, newPassword: 'NewSecret456' });
    expect(res.status).toBe(200);
    expect(res.body.data.tokens.refreshToken).toBeDefined();

    const oldRefresh = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: tokens.refreshToken });
    expect(oldRefresh.status).toBe(401);

    const login = await request(app).post('/api/v1/auth/login').send({ identifier: body.email, password: 'NewSecret456' });
    expect(login.status).toBe(200);
  });

  it('rejects password change with wrong current password', async () => {
    const { tokens } = await registerUser();
    const res = await request(app)
      .put('/api/v1/me/password')
      .set(bearer(tokens.accessToken))
      .send({ currentPassword: 'Wrong1234', newPassword: 'NewSecret456' });
    expect(res.status).toBe(400);
  });

  it('saves the FCM token', async () => {
    const { tokens, user } = await registerUser();
    const res = await request(app).put('/api/v1/me/fcm-token').set(bearer(tokens.accessToken)).send({ fcmToken: 'abc123' });
    expect(res.status).toBe(200);
    expect((await User.findByPk(user.id)).fcm_token).toBe('abc123');
  });

  it('deletes the account with the correct password', async () => {
    const { tokens, user } = await registerUser();
    const wrong = await request(app).delete('/api/v1/me').set(bearer(tokens.accessToken)).send({ password: 'Wrong1234' });
    expect(wrong.status).toBe(400);

    const res = await request(app).delete('/api/v1/me').set(bearer(tokens.accessToken)).send({ password: PASSWORD });
    expect(res.status).toBe(200);
    expect(await User.findByPk(user.id)).toBeNull();
  });
});
