const request = require('supertest');
const { Op } = require('sequelize');
const { sequelize, User, Item, Claim, Notification, AdminLog } = require('../src/models');
const { app, createUser, loginToken, ensureCategory, adminAgent, bearer } = require('./helpers');

const DOMAIN = '@inbox-test.example.com';
const ADMIN_EMAIL = `admin${DOMAIN}`;
let agent;
let csrf;
let admin;
let finder;
let finderToken;
let category;

async function adminLostItem(title) {
  return Item.create({
    user_id: admin.id,
    category_id: category.id,
    type: 'lost',
    title,
    event_date: new Date().toISOString().slice(0, 10),
    area_name: 'Office',
    latitude: 27.7,
    longitude: 85.3,
  });
}

const post = (path, body = {}) => agent.post(path).type('form').send({ _csrf: csrf, ...body });

beforeAll(async () => {
  await User.destroy({ where: { email: { [Op.like]: `%${DOMAIN}` } } });
  category = await ensureCategory('bag', 'Bag');
  ({ agent, csrf } = await adminAgent(ADMIN_EMAIL));
  admin = await User.findOne({ where: { email: ADMIN_EMAIL } });
  finder = await createUser(`finder${DOMAIN}`, { name: 'Inbox Finder' });
  finderToken = await loginToken(`finder${DOMAIN}`);
});

afterAll(async () => {
  await User.destroy({ where: { email: { [Op.like]: `%${DOMAIN}` } } });
  await sequelize.close();
});

describe('Admin inbox (items posted from the admin website)', () => {
  let item;
  let claimId;

  it('a user\'s "I found this" reaches the admin inbox', async () => {
    item = await adminLostItem('Office bag inbox test');
    const res = await request(app)
      .post(`/api/v1/items/${item.id}/claims`)
      .set(bearer(finderToken))
      .send({ message: 'Found it at the bus park' });
    claimId = res.body.data.id;

    const inbox = await agent.get('/admin/inbox');
    expect(inbox.status).toBe(200);
    expect(inbox.text).toContain('Office bag inbox test');
    expect(inbox.text).toContain('Inbox Finder');
  });

  it('the admin chats with the user', async () => {
    await request(app).post(`/api/v1/claims/${claimId}/messages`).set(bearer(finderToken)).send({ body: 'When can I bring it?' });

    const page = await agent.get(`/admin/claims/${claimId}`);
    expect(page.text).toContain('Respond as');
    expect(page.text).toContain('When can I bring it?');

    await post(`/admin/claims/${claimId}/messages`, { body: 'Tomorrow at 11 is fine' });
    const seen = await request(app).get(`/api/v1/claims/${claimId}/messages`).set(bearer(finderToken));
    const last = seen.body.data[seen.body.data.length - 1];
    expect(last.body).toBe('Tomorrow at 11 is fine');
    expect(last.is_mine).toBe(false);
    // Opening the page marked the user's message as read.
    expect(seen.body.data[0].read_at).not.toBeNull();
  });

  it('accepts, sets the meeting and completes the handover', async () => {
    await post(`/admin/claims/${claimId}/accept`);
    expect((await Claim.findByPk(claimId)).status).toBe('accepted');
    expect(await Notification.count({ where: { user_id: finder.id, type: 'claim.accepted' } })).toBe(1);

    const at = new Date(Date.now() + 86400000).toISOString();
    await post(`/admin/claims/${claimId}/meeting`, { place: 'Front desk', at, notes: 'Ask for Sita' });
    const withMeeting = await Claim.findByPk(claimId);
    expect(withMeeting.meeting_place).toBe('Front desk');
    expect(withMeeting.meeting_notes).toBe('Ask for Sita');

    await post(`/admin/claims/${claimId}/confirm`);
    await request(app).post(`/api/v1/claims/${claimId}/confirm-return`).set(bearer(finderToken));
    expect((await Claim.findByPk(claimId)).status).toBe('completed');
    expect((await Item.findByPk(item.id)).status).toBe('returned');
    expect((await User.findByPk(finder.id)).returned_count).toBe(1);

    const actions = (await AdminLog.findAll({ where: { target_type: 'claim', target_id: claimId } })).map((l) => l.action).sort();
    expect(actions).toEqual(['claim.accept', 'claim.confirm', 'claim.meeting']);
  });

  it('declines with a reason the user can see', async () => {
    const other = await adminLostItem('Office umbrella inbox test');
    const c = (await request(app).post(`/api/v1/items/${other.id}/claims`).set(bearer(finderToken)).send({ message: 'Found it' })).body.data;
    await post(`/admin/claims/${c.id}/reject`, { reason: 'Not the same umbrella' });
    const seen = await request(app).get(`/api/v1/claims/${c.id}`).set(bearer(finderToken));
    expect(seen.body.data.status).toBe('rejected');
    expect(seen.body.data.rejection_reason).toBe('Not the same umbrella');
  });

  it("can't act on claims of users' own items, and shows no chat there", async () => {
    const owner = await createUser(`owner${DOMAIN}`);
    const ownerToken = await loginToken(`owner${DOMAIN}`);
    const userItem = (
      await request(app)
        .post('/api/v1/items')
        .set(bearer(ownerToken))
        .field('type', 'lost')
        .field('title', 'Private user item')
        .field('category_id', String(category.id))
        .field('event_date', new Date().toISOString().slice(0, 10))
        .field('area_name', 'Thamel')
        .field('latitude', '27.71')
        .field('longitude', '85.31')
    ).body.data;
    const c = (await request(app).post(`/api/v1/items/${userItem.id}/claims`).set(bearer(finderToken)).send({ message: 'Found' })).body.data;

    await post(`/admin/claims/${c.id}/accept`);
    expect((await Claim.findByPk(c.id)).status).toBe('pending');

    const page = await agent.get(`/admin/claims/${c.id}`);
    expect(page.text).not.toContain('Respond as');
    expect(page.text).not.toContain('Chat with');
    expect(owner.id).toBeDefined();
  });
});

describe('Live chat on the admin claim page', () => {
  it('polls new messages, sends without reloading, and reports "seen"', async () => {
    const item = await adminLostItem('Live poll test item');
    const c = (await request(app).post(`/api/v1/items/${item.id}/claims`).set(bearer(finderToken)).send({ message: 'Found it' })).body.data;
    await request(app).post(`/api/v1/claims/${c.id}/messages`).set(bearer(finderToken)).send({ body: 'First from app' });

    const first = await agent.get(`/admin/claims/${c.id}/live`).query({ after: 0 }).set('Accept', 'application/json');
    expect(first.status).toBe(200);
    expect(first.body.messages.map((m) => m.body)).toEqual(['First from app']);
    expect(first.body.can_send).toBe(true);
    const lastId = first.body.messages[0].id;

    const sent = await agent
      .post(`/admin/claims/${c.id}/messages`)
      .set('Accept', 'application/json')
      .type('form')
      .send({ _csrf: csrf, body: 'Reply via fetch' });
    expect(sent.status).toBe(200);
    expect(sent.body.message.is_mine).toBe(true);

    // Polling marked the app user's message as read.
    const appView = await request(app).get(`/api/v1/claims/${c.id}/messages`).set(bearer(finderToken));
    expect(appView.body.data[0].read_at).not.toBeNull();

    // The app user reads the reply → the admin page sees it as "seen".
    await request(app).post(`/api/v1/claims/${c.id}/messages/read`).set(bearer(finderToken));
    const next = await agent.get(`/admin/claims/${c.id}/live`).query({ after: lastId }).set('Accept', 'application/json');
    expect(next.body.messages.map((m) => m.body)).toEqual(['Reply via fetch']);
    expect(next.body.last_seen_id).toBe(sent.body.message.id);

    const empty = await agent.post(`/admin/claims/${c.id}/messages`).set('Accept', 'application/json').type('form').send({ _csrf: csrf, body: '  ' });
    expect(empty.status).toBe(400);
  });

  it('gives the inbox count as JSON', async () => {
    const res = await agent.get('/admin/inbox/count').set('Accept', 'application/json');
    expect(res.status).toBe(200);
    expect(typeof res.body.count).toBe('number');
  });
});

describe('One phone, one account', () => {
  it('moves a device push token to the account that signs in on it', async () => {
    const a = await createUser(`phone-a${DOMAIN}`);
    await createUser(`phone-b${DOMAIN}`);
    const tokenA = await loginToken(`phone-a${DOMAIN}`);
    const tokenB = await loginToken(`phone-b${DOMAIN}`);

    await request(app).put('/api/v1/me/fcm-token').set(bearer(tokenA)).send({ fcmToken: 'same-phone-token' });
    await request(app).put('/api/v1/me/fcm-token').set(bearer(tokenB)).send({ fcmToken: 'same-phone-token' });

    expect((await User.findByPk(a.id)).fcm_token).toBeNull();
  });
});
