const fs = require('fs');
const path = require('path');
const request = require('supertest');
const sharp = require('sharp');
const env = require('../src/config/env');
const { sequelize, User, Item } = require('../src/models');
const { app, createUser, loginToken, ensureCategory, jpegWithGps, bearer } = require('./helpers');

const OWNER = 'owner@items-test.example.com';
const OTHER = 'other@items-test.example.com';
const BLOCKED = 'blocked@items-test.example.com';

// Ratnapark and New Road, Kathmandu (~800 m apart). Pokhara is ~140 km away.
const RATNAPARK = { latitude: 27.7056123, longitude: 85.3149456 };
const NEW_ROAD = { latitude: 27.7041, longitude: 85.3075 };
const POKHARA = { latitude: 28.2096, longitude: 83.9586 };

let ownerToken;
let otherToken;
let wallet;
let phone;
let blockedUser;

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

function postItem(token, fields, images = []) {
  const req = request(app).post('/api/v1/items').set(bearer(token));
  Object.entries(fields).forEach(([k, v]) => req.field(k, String(v)));
  images.forEach((buf, i) => req.attach('images', buf, { filename: `photo${i}.jpg`, contentType: 'image/jpeg' }));
  return req;
}

const foundWallet = (overrides = {}) => ({
  type: 'found',
  title: 'Black leather wallet',
  description: 'Has a citizenship card inside',
  category_id: wallet.id,
  event_date: daysAgo(1),
  area_name: 'Ratnapark, Kathmandu',
  ...RATNAPARK,
  secret_question: 'What name is on the card?',
  secret_answer: 'Ram Thapa',
  ...overrides,
});

const lostWallet = (overrides = {}) => ({
  type: 'lost',
  title: 'Lost my black wallet',
  category_id: wallet.id,
  event_date: daysAgo(2),
  area_name: 'New Road',
  ...NEW_ROAD,
  ...overrides,
});

async function cleanup() {
  await User.destroy({ where: { email: [OWNER, OTHER, BLOCKED] } });
}

beforeAll(async () => {
  await cleanup();
  // Safety: only ever clear the tests' own temporary folder, never real uploads.
  if (!env.storage.uploadDir.includes('lost-found-test-uploads')) throw new Error(`Refusing to clear ${env.storage.uploadDir}`);
  fs.rmSync(env.storage.uploadDir, { recursive: true, force: true });
  wallet = await ensureCategory('wallet', 'Wallet');
  phone = await ensureCategory('phone', 'Phone');
  await createUser(OWNER);
  await createUser(OTHER);
  blockedUser = await createUser(BLOCKED);
  ownerToken = await loginToken(OWNER);
  otherToken = await loginToken(OTHER);
});

afterAll(async () => {
  await cleanup();
  await sequelize.close();
});

describe('POST /items', () => {
  it('creates a found item with a processed photo', async () => {
    const res = await postItem(ownerToken, foundWallet(), [await jpegWithGps()]);
    expect(res.status).toBe(201);

    const item = res.body.data;
    expect(item.type).toBe('found');
    expect(item.status).toBe('open');
    expect(item.is_mine).toBe(true);
    expect(item.location).toEqual({ ...RATNAPARK, approximate: false });
    expect(item.secret_question).toBe('What name is on the card?');
    expect(JSON.stringify(res.body)).not.toMatch(/hash|Ram Thapa/);

    // Resized to max 1600px, converted to WebP, and GPS/EXIF removed.
    const [image] = item.images;
    expect(image.width).toBe(1600);
    const file = path.join(env.storage.uploadDir, new URL(image.url).pathname.replace('/uploads/', ''));
    const meta = await sharp(file).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();

    const served = await request(app).get(new URL(image.url).pathname);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
  });

  it('requires login', async () => {
    const res = await request(app).post('/api/v1/items').send(lostWallet());
    expect(res.status).toBe(401);
  });

  it('requires a secret question for found items only', async () => {
    const noSecret = await postItem(ownerToken, foundWallet({ secret_question: '', secret_answer: '' }));
    expect(noSecret.status).toBe(400);

    const lostWithSecret = await postItem(ownerToken, lostWallet({ secret_question: 'Colour?', secret_answer: 'red' }));
    expect(lostWithSecret.status).toBe(400);
  });

  it('rejects future dates, bad categories and bad coordinates', async () => {
    const future = await postItem(ownerToken, lostWallet({ event_date: '2099-01-01' }));
    expect(future.status).toBe(400);

    const badCategory = await postItem(ownerToken, lostWallet({ category_id: 999999 }));
    expect(badCategory.status).toBe(400);
    expect(badCategory.body.errors[0].field).toBe('category_id');

    const badLat = await postItem(ownerToken, lostWallet({ latitude: 200 }));
    expect(badLat.status).toBe(400);
  });

  it('rejects files that are not images, and more than 5 images', async () => {
    const fake = await request(app)
      .post('/api/v1/items')
      .set(bearer(ownerToken))
      .field('type', 'lost')
      .attach('images', Buffer.from('not an image'), { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(fake.status).toBe(400);

    const pdf = await request(app)
      .post('/api/v1/items')
      .set(bearer(ownerToken))
      .attach('images', Buffer.from('%PDF'), { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(pdf.status).toBe(400);

    const small = await jpegWithGps(100, 100);
    const tooMany = await postItem(ownerToken, lostWallet(), [small, small, small, small, small, small]);
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.message).toMatch(/up to 5/);
  });
});

describe('Browsing', () => {
  let foundId;
  let lostId;
  let pokharaId;

  beforeAll(async () => {
    await Item.destroy({ where: {} });
    foundId = (await postItem(ownerToken, foundWallet())).body.data.id;
    lostId = (await postItem(otherToken, lostWallet())).body.data.id;
    pokharaId = (await postItem(otherToken, lostWallet({ ...POKHARA, title: 'Wallet lost at Lakeside', area_name: 'Lakeside' })))
      .body.data.id;
  });

  it('lists items publicly with approximate locations', async () => {
    const res = await request(app).get('/api/v1/items');
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(3);

    const found = res.body.data.find((i) => i.id === foundId);
    expect(found.is_mine).toBe(false);
    expect(found.location).toEqual({ latitude: 27.71, longitude: 85.31, approximate: true });
    expect(found.is_hidden).toBeUndefined();
  });

  it('shows is_mine and exact location to the owner', async () => {
    const res = await request(app).get(`/api/v1/items/${foundId}`).set(bearer(ownerToken));
    expect(res.body.data.is_mine).toBe(true);
    expect(res.body.data.location.approximate).toBe(false);
  });

  it('filters by type, category slug and search text', async () => {
    const lost = await request(app).get('/api/v1/items').query({ type: 'lost' });
    expect(lost.body.data.every((i) => i.type === 'lost')).toBe(true);

    const bySlug = await request(app).get('/api/v1/items').query({ category: 'phone' });
    expect(bySlug.body.meta.total).toBe(0);

    const search = await request(app).get('/api/v1/items').query({ q: 'lakeside' });
    expect(search.body.data.map((i) => i.id)).toEqual([pokharaId]);
  });

  it('finds nearby items sorted by distance', async () => {
    const res = await request(app)
      .get('/api/v1/items')
      .query({ lat: RATNAPARK.latitude, lng: RATNAPARK.longitude, radius_km: 5, sort: 'nearest' });
    expect(res.status).toBe(200);
    expect(res.body.data.map((i) => i.id)).toEqual([foundId, lostId]); // Pokhara is excluded
    expect(res.body.data[0].distance_km).toBe(0.5); // rounded up for privacy
  });

  it('needs lat/lng for sort=nearest', async () => {
    const res = await request(app).get('/api/v1/items').query({ sort: 'nearest' });
    expect(res.status).toBe(400);
  });

  it('lists my items', async () => {
    const res = await request(app).get('/api/v1/items/mine').set(bearer(otherToken));
    expect(res.body.data.map((i) => i.id).sort()).toEqual([lostId, pokharaId].sort());
  });

  it('suggests matches for a lost item', async () => {
    const res = await request(app).get(`/api/v1/items/${lostId}/matches`).set(bearer(otherToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(foundId);
    expect(res.body.data[0].match_score).toBeGreaterThan(50);
  });

  it('only lets the owner see matches', async () => {
    const res = await request(app).get(`/api/v1/items/${lostId}/matches`).set(bearer(ownerToken));
    expect(res.status).toBe(403);
  });

  it("hides blocked users' items", async () => {
    await User.update({ is_blocked: false }, { where: { id: blockedUser.id } });
    const token = await loginToken(BLOCKED);
    const id = (await postItem(token, lostWallet({ title: 'Blocked user wallet' }))).body.data.id;
    await User.update({ is_blocked: true }, { where: { id: blockedUser.id } });

    expect((await request(app).get(`/api/v1/items/${id}`)).status).toBe(404);
    const list = await request(app).get('/api/v1/items').query({ q: 'Blocked user wallet' });
    expect(list.body.meta.total).toBe(0);
  });
});

describe('Editing', () => {
  let item;

  beforeEach(async () => {
    item = (await postItem(ownerToken, foundWallet(), [await jpegWithGps(400, 300)])).body.data;
  });

  it('lets the owner edit, but not others', async () => {
    const res = await request(app)
      .patch(`/api/v1/items/${item.id}`)
      .set(bearer(ownerToken))
      .send({ title: 'Brown leather wallet', category_id: phone.id });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Brown leather wallet');
    expect(res.body.data.category.slug).toBe('phone');

    const other = await request(app).patch(`/api/v1/items/${item.id}`).set(bearer(otherToken)).send({ title: 'Mine now' });
    expect(other.status).toBe(403);
  });

  it('changes the secret answer only with a question', async () => {
    const onlyAnswer = await request(app).patch(`/api/v1/items/${item.id}`).set(bearer(ownerToken)).send({ secret_answer: 'x' });
    expect(onlyAnswer.status).toBe(400);

    const both = await request(app)
      .patch(`/api/v1/items/${item.id}`)
      .set(bearer(ownerToken))
      .send({ secret_question: 'What colour is it?', secret_answer: '  BLACK ' });
    expect(both.status).toBe(200);
    const saved = await Item.findByPk(item.id);
    expect(await saved.checkAnswer('black')).toBe(true);
    expect(await saved.checkAnswer('brown')).toBe(false);
  });

  it('adds and removes images, deleting the file', async () => {
    const add = await request(app)
      .post(`/api/v1/items/${item.id}/images`)
      .set(bearer(ownerToken))
      .attach('images', await jpegWithGps(300, 300), { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(add.status).toBe(200);
    expect(add.body.data.images).toHaveLength(2);

    const image = add.body.data.images[0];
    const file = path.join(env.storage.uploadDir, new URL(image.url).pathname.replace('/uploads/', ''));
    expect(fs.existsSync(file)).toBe(true);

    const del = await request(app).delete(`/api/v1/items/${item.id}/images/${image.id}`).set(bearer(ownerToken));
    expect(del.status).toBe(200);
    expect(del.body.data.images).toHaveLength(1);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('closes an item, after which it cannot be edited or seen in the feed', async () => {
    const close = await request(app).post(`/api/v1/items/${item.id}/close`).set(bearer(ownerToken));
    expect(close.body.data.status).toBe('closed');

    const edit = await request(app).patch(`/api/v1/items/${item.id}`).set(bearer(ownerToken)).send({ title: 'Changed title' });
    expect(edit.status).toBe(400);

    const feed = await request(app).get('/api/v1/items');
    expect(feed.body.data.find((i) => i.id === item.id)).toBeUndefined();
  });

  it('deletes an item and its photo files', async () => {
    const file = path.join(env.storage.uploadDir, new URL(item.images[0].url).pathname.replace('/uploads/', ''));
    const res = await request(app).delete(`/api/v1/items/${item.id}`).set(bearer(ownerToken));
    expect(res.status).toBe(200);
    expect(await Item.findByPk(item.id)).toBeNull();
    expect(fs.existsSync(file)).toBe(false);
  });

  it('returns 404 for unknown or non-numeric ids', async () => {
    expect((await request(app).get('/api/v1/items/999999')).status).toBe(404);
    expect((await request(app).get('/api/v1/items/abc')).status).toBe(404);
  });
});

describe('Account deletion', () => {
  it("removes the user's items and photo files", async () => {
    const email = 'deleteme@items-test.example.com';
    await createUser(email);
    const token = await loginToken(email);
    const item = (await postItem(token, lostWallet(), [await jpegWithGps(200, 200)])).body.data;
    const file = path.join(env.storage.uploadDir, new URL(item.images[0].url).pathname.replace('/uploads/', ''));
    expect(fs.existsSync(file)).toBe(true);

    const res = await request(app).delete('/api/v1/me').set(bearer(token)).send({ password: 'Secret123' });
    expect(res.status).toBe(200);
    expect(await Item.findByPk(item.id)).toBeNull();
    expect(fs.existsSync(file)).toBe(false);
  });
});
