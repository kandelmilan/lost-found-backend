const request = require('supertest');
const sharp = require('sharp');
const app = require('../src/app');
const { User, Category } = require('../src/models');

const PASSWORD = 'Secret123';

async function createUser(email, extra = {}) {
  await User.destroy({ where: { email } });
  return User.create({ name: 'Test User', email, password_hash: await User.hashPassword(PASSWORD), ...extra });
}

async function loginToken(email) {
  const res = await request(app).post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD });
  return res.body.data.tokens.accessToken;
}

async function ensureCategory(slug, name = slug) {
  const [category] = await Category.findOrCreate({ where: { slug }, defaults: { name, slug, is_active: true } });
  return category;
}

// A real JPEG with EXIF GPS data, to prove it gets stripped.
function jpegWithGps(width = 2400, height = 1600) {
  return sharp({ create: { width, height, channels: 3, background: '#336699' } })
    .jpeg()
    .withExif({ IFD0: { Make: 'TestPhone' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '27/1 42/1 0/1' } })
    .toBuffer();
}

async function adminAgent(email, password = 'Test@12345') {
  await User.destroy({ where: { email } });
  await User.create({ name: 'Test Admin', email, password_hash: await User.hashPassword(password), role: 'admin' });
  const agent = request.agent(app);
  const page = await agent.get('/admin/login');
  const csrfFrom = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];
  await agent.post('/admin/login').type('form').send({ _csrf: csrfFrom(page.text), email, password });
  // Login starts a new session (and a new CSRF token), so read it again.
  const csrf = csrfFrom((await agent.get('/admin')).text);
  return { agent, csrf };
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

module.exports = { app, PASSWORD, createUser, loginToken, ensureCategory, jpegWithGps, adminAgent, bearer };
