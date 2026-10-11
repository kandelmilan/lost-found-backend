const request = require('supertest');
const { sequelize, User, Item, Category, AdminLog } = require('../src/models');
const { app, createUser, loginToken, ensureCategory, adminAgent, bearer, jpegWithGps } = require('./helpers');

const ADMIN_EMAIL = 'items-admin@lostfound.local';
const OWNER = 'owner@admin-items-test.example.com';

let agent;
let csrf;
let ownerToken;
let category;

async function createItem(title) {
  const res = await request(app)
    .post('/api/v1/items')
    .set(bearer(ownerToken))
    .field('type', 'lost')
    .field('title', title)
    .field('category_id', String(category.id))
    .field('event_date', new Date().toISOString().slice(0, 10))
    .field('area_name', 'Thamel')
    .field('latitude', '27.7154')
    .field('longitude', '85.3123');
  return res.body.data;
}

beforeAll(async () => {
  await User.destroy({ where: { email: OWNER } });
  await Category.destroy({ where: { slug: ['test-umbrella', 'test-renamed'] } });
  category = await ensureCategory('keys', 'Keys');
  await createUser(OWNER);
  ownerToken = await loginToken(OWNER);
  ({ agent, csrf } = await adminAgent(ADMIN_EMAIL));
});

afterAll(async () => {
  await User.destroy({ where: { email: [OWNER, ADMIN_EMAIL] } });
  await Category.destroy({ where: { slug: ['test-umbrella'] } });
  await sequelize.close();
});

describe('Admin items', () => {
  it('lists, filters and shows items', async () => {
    const item = await createItem('Admin test keys');

    const list = await agent.get('/admin/items').query({ q: 'Admin test keys', type: 'lost' });
    expect(list.status).toBe(200);
    expect(list.text).toContain('Admin test keys');

    const ignored = await agent.get('/admin/items').query({ type: 'nonsense', category: 'abc' });
    expect(ignored.status).toBe(200);

    const detail = await agent.get(`/admin/items/${item.id}`);
    expect(detail.status).toBe(200);
    expect(detail.text).toContain('Exact location');
  });

  it('hides an item from the app with a reason the owner can see', async () => {
    const item = await createItem('Item to hide');

    const res = await agent.post(`/admin/items/${item.id}/hide`).type('form').send({ _csrf: csrf, reason: 'Shows ID number' });
    expect(res.status).toBe(302);

    expect((await request(app).get(`/api/v1/items/${item.id}`)).status).toBe(404);
    const own = await request(app).get(`/api/v1/items/${item.id}`).set(bearer(ownerToken));
    expect(own.body.data.is_hidden).toBe(true);
    expect(own.body.data.hidden_reason).toBe('Shows ID number');

    await agent.post(`/admin/items/${item.id}/unhide`).type('form').send({ _csrf: csrf });
    expect((await request(app).get(`/api/v1/items/${item.id}`)).status).toBe(200);

    const actions = (await AdminLog.findAll({ where: { target_type: 'item', target_id: item.id } })).map((l) => l.action);
    expect(actions.sort()).toEqual(['item.hide', 'item.unhide']);
  });

  it('deletes an item', async () => {
    const item = await createItem('Item to delete');
    const res = await agent.post(`/admin/items/${item.id}/delete`).type('form').send({ _csrf: csrf, reason: 'Spam' });
    expect(res.status).toBe(302);
    expect(await Item.findByPk(item.id)).toBeNull();
  });

  it('needs CSRF for item actions', async () => {
    const item = await createItem('CSRF item');
    const res = await agent.post(`/admin/items/${item.id}/hide`).type('form').send({});
    expect(res.status).toBe(403);
  });
});

describe('Admin post item', () => {
  const postForm = (fields, files = []) => {
    const req = agent.post('/admin/items').field('_csrf', csrf);
    Object.entries(fields).forEach(([k, v]) => req.field(k, String(v)));
    files.forEach((buf, i) => req.attach('images', buf, { filename: `p${i}.jpg`, contentType: 'image/jpeg' }));
    return req;
  };

  const valid = () => ({
    type: 'found',
    title: 'Keys handed in at office',
    description: 'Left at reception',
    category_id: category.id,
    event_date: new Date().toISOString().slice(0, 10),
    area_name: 'Thamel',
    latitude: '27.7154',
    longitude: '85.3123',
    secret_question: 'What is on the keychain?',
    secret_answer: 'Elephant',
  });

  it('shows the form', async () => {
    const res = await agent.get('/admin/items/new');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Owner verification');
    expect(res.text).toContain('leaflet');
  });

  it('posts an item with photos as the admin and logs it', async () => {
    const res = await postForm(valid(), [await jpegWithGps(500, 400)]);
    expect(res.status).toBe(302);
    const id = Number(res.headers.location.split('/').pop());

    const item = await Item.findByPk(id, { include: ['images', 'owner'] });
    expect(item.owner.email).toBe(ADMIN_EMAIL);
    expect(item.images).toHaveLength(1);
    expect(await item.checkAnswer('elephant')).toBe(true);
    expect(await AdminLog.count({ where: { action: 'item.create', target_id: id } })).toBe(1);

    const api = await request(app).get(`/api/v1/items/${id}`);
    expect(api.status).toBe(200);
  });

  it('shows field errors and keeps values, but never the secret answer', async () => {
    const res = await postForm({ ...valid(), title: 'x', secret_question: '' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Please fix the highlighted fields');
    expect(res.text).toContain('Left at reception');
    expect(res.text).not.toContain('Elephant');
  });

  it('rejects unreadable photos with a message', async () => {
    const res = await postForm(valid(), [Buffer.from('not an image')]);
    expect(res.status).toBe(400);
    expect(res.text).toContain('could not be read');
  });

  it('requires CSRF and a signed-in admin', async () => {
    const noCsrf = await agent.post('/admin/items').field('title', 'x');
    expect(noCsrf.status).toBe(403);

    const anon = await request(app).post('/admin/items').field('title', 'x');
    expect(anon.status).toBe(403);
  });
});

describe('Admin edit item', () => {
  const editForm = (id, fields, files = []) => {
    const req = agent.post(`/admin/items/${id}/edit`).field('_csrf', csrf);
    Object.entries(fields).forEach(([k, v]) => [].concat(v).forEach((x) => req.field(k, String(x))));
    files.forEach((buf, i) => req.attach('images', buf, { filename: `e${i}.jpg`, contentType: 'image/jpeg' }));
    return req;
  };
  const base = (item) => ({
    title: item.title,
    description: item.description || '',
    category_id: item.category.id,
    event_date: item.event_date,
    area_name: item.area_name,
    latitude: '27.7154',
    longitude: '85.3123',
  });

  it('shows the form pre-filled, with lost/found locked', async () => {
    const item = await createItem('Editable keys');
    const res = await agent.get(`/admin/items/${item.id}/edit`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Edit Item');
    expect(res.text).toContain('value="Editable keys"');
    expect(res.text).toMatch(/id="type-lost"[^>]*checked[^>]*disabled/);
  });

  it("saves changes, tells the owner, and logs it", async () => {
    const item = await createItem('Keys before edit');
    const res = await editForm(item.id, { ...base(item), title: 'Keys after edit', area_name: 'New Road' });
    expect(res.status).toBe(302);
    const saved = await Item.findByPk(item.id);
    expect(saved.title).toBe('Keys after edit');
    expect(saved.area_name).toBe('New Road');
    expect(saved.type).toBe('lost');

    const owner = await User.findOne({ where: { email: OWNER } });
    const { Notification } = require('../src/models');
    expect(await Notification.count({ where: { user_id: owner.id, type: 'item.edited' } })).toBeGreaterThan(0);
    expect(await AdminLog.count({ where: { action: 'item.update', target_id: item.id } })).toBe(1);
  });

  it('removes and adds photos, keeping the 5-photo limit', async () => {
    const item = await createItem('Photo edit item');
    await editForm(item.id, base(item), [await jpegWithGps(300, 300), await jpegWithGps(300, 300)]);
    const withTwo = await Item.findByPk(item.id, { include: ['images'] });
    expect(withTwo.images).toHaveLength(2);

    await editForm(item.id, { ...base(item), remove_images: [withTwo.images[0].id] });
    expect(await ItemImageCount(item.id)).toBe(1);

    const small = await jpegWithGps(100, 100);
    const tooMany = await editForm(item.id, base(item), [small, small, small, small, small]);
    expect(tooMany.status).toBe(400);
    expect(tooMany.text).toContain('up to 5 photos');
  });

  it('keeps the secret answer unless a new one is typed', async () => {
    const found = (await adminPost({
      type: 'found', title: 'Found phone to edit', category_id: category.id, event_date: new Date().toISOString().slice(0, 10),
      area_name: 'Thamel', latitude: '27.71', longitude: '85.31', secret_question: 'Cover colour?', secret_answer: 'Red',
    })).headers.location.split('/').pop();
    const item = await Item.findByPk(found, { include: ['category'] });
    const fields = { ...base({ ...item.get(), category: item.category }), secret_question: 'Changed question?' };

    await editForm(item.id, { ...fields, secret_answer: '' });
    await item.reload();
    expect(item.secret_question).toBe('Cover colour?');
    expect(await item.checkAnswer('red')).toBe(true);

    await editForm(item.id, { ...fields, secret_answer: 'Blue' });
    await item.reload();
    expect(item.secret_question).toBe('Changed question?');
    expect(await item.checkAnswer('blue')).toBe(true);
  });

  it('shows field errors instead of saving bad data', async () => {
    const item = await createItem('Validation edit item');
    const res = await editForm(item.id, { ...base(item), title: 'x' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Please fix the highlighted fields');
    expect((await Item.findByPk(item.id)).title).toBe('Validation edit item');
  });
});

// Posts the admin "Post Item" form (multipart).
function adminPost(fields) {
  const req = agent.post('/admin/items').field('_csrf', csrf);
  Object.entries(fields).forEach(([k, v]) => req.field(k, String(v)));
  return req;
}

async function ItemImageCount(itemId) {
  const { ItemImage } = require('../src/models');
  return ItemImage.count({ where: { item_id: itemId } });
}

describe('Admin tables', () => {
  it('sorts and limits rows', async () => {
    await createItem('AAA sorted first');
    await createItem('ZZZ sorted last');
    const asc = await agent.get('/admin/items').query({ sort: 'title', dir: 'asc', limit: 100 });
    expect(asc.text.indexOf('AAA sorted first')).toBeLessThan(asc.text.indexOf('ZZZ sorted last'));

    const desc = await agent.get('/admin/items').query({ sort: 'title', dir: 'desc', limit: 100 });
    expect(desc.text.indexOf('ZZZ sorted last')).toBeLessThan(desc.text.indexOf('AAA sorted first'));

    const bad = await agent.get('/admin/items').query({ sort: 'nope', dir: 'sideways', limit: 7 });
    expect(bad.status).toBe(200);
  });

  it('exports items as CSV with the current filters, safe against formulas', async () => {
    await createItem('=HYPERLINK("http://evil")');
    const res = await agent.get('/admin/items/export').query({ type: 'lost' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="items-/);
    expect(res.text).toContain('ID,Type,Title');
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(res.text).not.toMatch(/,found,/);
  });

  it('exports users as CSV', async () => {
    const res = await agent.get('/admin/users/export').query({ q: 'admin-items-test' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('owner@admin-items-test.example.com');
  });

  it('requires login for exports', async () => {
    const res = await request(app).get('/admin/items/export');
    expect(res.status).toBe(302);
  });
});

describe('Admin categories', () => {
  it('creates a category with a generated slug', async () => {
    const res = await agent.post('/admin/categories').type('form').send({ _csrf: csrf, name: 'Test Umbrella', icon: 'umbrella', sort_order: '50' });
    expect(res.status).toBe(302);
    const created = await Category.findOne({ where: { slug: 'test-umbrella' } });
    expect(created).not.toBeNull();
    expect(created.is_active).toBe(true);

    const api = await request(app).get('/api/v1/categories');
    expect(api.body.data.map((c) => c.slug)).toContain('test-umbrella');
  });

  it('rejects duplicates with a message instead of an error page', async () => {
    await agent.post('/admin/categories').type('form').send({ _csrf: csrf, name: 'Test Umbrella' });
    const page = await agent.get('/admin/categories');
    expect(page.text).toContain('already exists');
  });

  it('renames and deactivates, keeping the slug', async () => {
    const cat = await Category.findOne({ where: { slug: 'test-umbrella' } });
    // Unchecked checkbox → field missing → inactive.
    const res = await agent.post(`/admin/categories/${cat.id}`).type('form').send({ _csrf: csrf, name: 'Test Umbrellas', sort_order: '51' });
    expect(res.status).toBe(302);
    await cat.reload();
    expect(cat.name).toBe('Test Umbrellas');
    expect(cat.slug).toBe('test-umbrella');
    expect(cat.is_active).toBe(false);

    const api = await request(app).get('/api/v1/categories');
    expect(api.body.data.map((c) => c.slug)).not.toContain('test-umbrella');
  });

  it('refuses to delete a category that has items', async () => {
    await createItem('Keeps category in use');
    await agent.post(`/admin/categories/${category.id}/delete`).type('form').send({ _csrf: csrf });
    expect(await Category.findByPk(category.id)).not.toBeNull();
    expect((await agent.get('/admin/categories')).text).toContain('Deactivate it instead');
  });

  it('deletes an unused category', async () => {
    const cat = await Category.findOne({ where: { slug: 'test-umbrella' } });
    await agent.post(`/admin/categories/${cat.id}/delete`).type('form').send({ _csrf: csrf });
    expect(await Category.findByPk(cat.id)).toBeNull();
  });
});

describe('Dashboard', () => {
  it('shows item counts', async () => {
    const res = await agent.get('/admin');
    expect(res.status).toBe(200);
    expect(res.text).toContain('lost · ');
    expect(res.text).toContain('found open');
  });
});
