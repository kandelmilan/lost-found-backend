const http = require('http');
const request = require('supertest');
const { io: connect } = require('socket.io-client');
const { Op } = require('sequelize');
const { sequelize, User, Notification, Report } = require('../src/models');
const { initSocket, closeSocket } = require('../src/socket');
const { app, createUser, loginToken, ensureCategory, bearer } = require('./helpers');

const DOMAIN = '@chat-test.example.com';
const tokens = {};
const users = {};
let server;
let baseUrl;
let category;
const sockets = [];

function socketFor(who) {
  const s = connect(baseUrl, { auth: { token: tokens[who] }, transports: ['websocket'], forceNew: true });
  sockets.push(s);
  return s;
}

const once = (s, event) => new Promise((resolve) => s.once(event, resolve));
const emitAck = (s, event, payload) => new Promise((resolve) => s.emit(event, payload, resolve));
const connected = (s) => new Promise((resolve, reject) => {
  s.once('connect', resolve);
  s.once('connect_error', reject);
});

async function claimOnFoundItem() {
  const item = (
    await request(app)
      .post('/api/v1/items')
      .set(bearer(tokens.finder))
      .field('type', 'found')
      .field('title', 'Chat test phone')
      .field('category_id', String(category.id))
      .field('event_date', new Date().toISOString().slice(0, 10))
      .field('area_name', 'Baneshwor')
      .field('latitude', '27.6915')
      .field('longitude', '85.342')
      .field('secret_question', 'Phone cover colour?')
      .field('secret_answer', 'blue')
  ).body.data;
  const claim = (await request(app).post(`/api/v1/items/${item.id}/claims`).set(bearer(tokens.owner)).send({ answer: 'blue' })).body.data;
  return { item, claim };
}

beforeAll(async () => {
  await User.destroy({ where: { email: { [Op.like]: `%${DOMAIN}` } } });
  category = await ensureCategory('phone', 'Phone');
  for (const who of ['finder', 'owner', 'stranger']) {
    // eslint-disable-next-line no-await-in-loop
    users[who] = await createUser(`${who}${DOMAIN}`, { name: who });
    // eslint-disable-next-line no-await-in-loop
    tokens[who] = await loginToken(`${who}${DOMAIN}`);
  }

  server = http.createServer(app);
  initSocket(server);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await closeSocket();
  await new Promise((resolve) => server.close(resolve));
  await User.destroy({ where: { email: { [Op.like]: `%${DOMAIN}` } } });
  await sequelize.close();
});

describe('Socket connection', () => {
  it('rejects missing or bad tokens', async () => {
    const noToken = connect(baseUrl, { transports: ['websocket'], forceNew: true });
    sockets.push(noToken);
    await expect(connected(noToken)).rejects.toThrow('Missing access token');

    tokens.bad = 'garbage';
    await expect(connected(socketFor('bad'))).rejects.toThrow('Invalid access token');
  });
});

describe('Chat', () => {
  let claim;
  let finderSocket;
  let ownerSocket;

  beforeAll(async () => {
    ({ claim } = await claimOnFoundItem());
    finderSocket = socketFor('finder');
    ownerSocket = socketFor('owner');
    await Promise.all([connected(finderSocket), connected(ownerSocket)]);
  });

  it('only participants can join a conversation', async () => {
    expect(await emitAck(ownerSocket, 'claim:join', { claimId: claim.id })).toEqual({ ok: true });
    const stranger = socketFor('stranger');
    await connected(stranger);
    const res = await emitAck(stranger, 'claim:join', { claimId: claim.id });
    expect(res.ok).toBe(false);
  });

  it('delivers a REST message live to the other person', async () => {
    const incoming = once(finderSocket, 'message:new');
    const res = await request(app)
      .post(`/api/v1/claims/${claim.id}/messages`)
      .set(bearer(tokens.owner))
      .send({ body: '  Hi, the cover is blue with a sticker  ' });
    expect(res.status).toBe(201);
    expect(res.body.data.body).toBe('Hi, the cover is blue with a sticker');
    expect(res.body.data.is_mine).toBe(true);

    const live = await incoming;
    expect(live.body).toBe('Hi, the cover is blue with a sticker');
    expect(live.is_mine).toBe(false);
  });

  it('sends over the socket with an ack', async () => {
    const incoming = once(ownerSocket, 'message:new');
    const ack = await emitAck(finderSocket, 'message:send', { claimId: claim.id, body: 'Yes, that matches!' });
    expect(ack.ok).toBe(true);
    expect((await incoming).body).toBe('Yes, that matches!');

    const empty = await emitAck(finderSocket, 'message:send', { claimId: claim.id, body: '   ' });
    expect(empty.ok).toBe(false);
  });

  it('relays typing only inside the conversation room', async () => {
    await emitAck(finderSocket, 'claim:join', { claimId: claim.id });
    const typing = once(ownerSocket, 'typing');
    finderSocket.emit('typing', { claimId: claim.id, isTyping: true });
    expect(await typing).toEqual({ claim_id: claim.id, user_id: users.finder.id, is_typing: true });
  });

  it('lists messages with paging, unread counts and read receipts', async () => {
    for (let i = 1; i <= 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await request(app).post(`/api/v1/claims/${claim.id}/messages`).set(bearer(tokens.owner)).send({ body: `extra ${i}` });
    }

    const page1 = await request(app).get(`/api/v1/claims/${claim.id}/messages`).query({ limit: 2 }).set(bearer(tokens.finder));
    expect(page1.body.data.map((m) => m.body)).toEqual(['extra 2', 'extra 3']);
    expect(page1.body.meta.has_more).toBe(true);
    const page2 = await request(app)
      .get(`/api/v1/claims/${claim.id}/messages`)
      .query({ limit: 50, before: page1.body.meta.next_before })
      .set(bearer(tokens.finder));
    expect(page2.body.data[0].body).toBe('Hi, the cover is blue with a sticker');
    expect(page2.body.meta.has_more).toBe(false);

    const unread = await request(app).get('/api/v1/conversations/unread-count').set(bearer(tokens.finder));
    expect(unread.body.data.unread).toBe(4);

    const list = await request(app).get('/api/v1/conversations').set(bearer(tokens.finder));
    const conv = list.body.data.find((c) => c.claim_id === claim.id);
    expect(conv.unread_count).toBe(4);
    expect(conv.last_message.body).toBe('extra 3');
    expect(conv.other_person.name).toBe('owner');
    expect(conv.can_send).toBe(true);

    const receipt = once(ownerSocket, 'message:read');
    const read = await request(app).post(`/api/v1/claims/${claim.id}/messages/read`).set(bearer(tokens.finder));
    expect(read.body.data.updated).toBe(4);
    expect((await receipt).reader_id).toBe(users.finder.id);
    expect((await request(app).get('/api/v1/conversations/unread-count').set(bearer(tokens.finder))).body.data.unread).toBe(0);
  });

  it('keeps strangers out', async () => {
    const res = await request(app).get(`/api/v1/claims/${claim.id}/messages`).set(bearer(tokens.stranger));
    expect(res.status).toBe(404);
    const send = await request(app).post(`/api/v1/claims/${claim.id}/messages`).set(bearer(tokens.stranger)).send({ body: 'hi' });
    expect(send.status).toBe(404);
  });

  it('becomes read-only when the claim ends', async () => {
    await request(app).post(`/api/v1/claims/${claim.id}/reject`).set(bearer(tokens.finder));
    const res = await request(app).post(`/api/v1/claims/${claim.id}/messages`).set(bearer(tokens.owner)).send({ body: 'please?' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/closed/);
    const history = await request(app).get(`/api/v1/claims/${claim.id}/messages`).set(bearer(tokens.owner));
    expect(history.status).toBe(200);
  });
});

describe('Notifications', () => {
  it('notifies at each claim step, live and in the list', async () => {
    const finderSocket = socketFor('finder');
    await connected(finderSocket);
    await Notification.destroy({ where: { user_id: [users.finder.id, users.owner.id] } });

    const live = once(finderSocket, 'notification:new');
    const { claim } = await claimOnFoundItem();
    const received = await live;
    expect(received.type).toBe('claim.received');
    expect(received.data.claim_id).toBe(claim.id);

    await request(app).post(`/api/v1/claims/${claim.id}/accept`).set(bearer(tokens.finder));
    await request(app).post(`/api/v1/claims/${claim.id}/confirm-return`).set(bearer(tokens.owner));
    await request(app).post(`/api/v1/claims/${claim.id}/confirm-return`).set(bearer(tokens.finder));

    const ownerList = await request(app).get('/api/v1/notifications').set(bearer(tokens.owner));
    expect(ownerList.body.data.map((n) => n.type)).toEqual(['claim.completed', 'claim.accepted']);

    const finderTypes = (await request(app).get('/api/v1/notifications').set(bearer(tokens.finder))).body.data.map((n) => n.type);
    expect(finderTypes).toEqual(['claim.completed', 'claim.confirmed', 'claim.received']);
  });

  it('counts unread and marks read', async () => {
    const count = await request(app).get('/api/v1/notifications/unread-count').set(bearer(tokens.finder));
    expect(count.body.data.unread).toBe(3);

    const [first] = (await request(app).get('/api/v1/notifications').set(bearer(tokens.finder))).body.data;
    const one = await request(app).post(`/api/v1/notifications/${first.id}/read`).set(bearer(tokens.finder));
    expect(one.body.data.is_read).toBe(true);

    const unreadOnly = await request(app).get('/api/v1/notifications').query({ unread_only: true }).set(bearer(tokens.finder));
    expect(unreadOnly.body.meta.total).toBe(2);

    await request(app).post('/api/v1/notifications/read-all').set(bearer(tokens.finder));
    expect((await request(app).get('/api/v1/notifications/unread-count').set(bearer(tokens.finder))).body.data.unread).toBe(0);

    // Can't read someone else's.
    expect((await request(app).post(`/api/v1/notifications/${first.id}/read`).set(bearer(tokens.owner))).status).toBe(404);
  });
});

describe('Reports', () => {
  it('reports an item once, but not your own', async () => {
    const { item } = await claimOnFoundItem();
    const own = await request(app).post('/api/v1/reports').set(bearer(tokens.finder)).send({ target_type: 'item', target_id: item.id, reason: 'spam' });
    expect(own.status).toBe(400);

    const res = await request(app)
      .post('/api/v1/reports')
      .set(bearer(tokens.stranger))
      .send({ target_type: 'item', target_id: item.id, reason: 'scam', details: 'Asked for money' });
    expect(res.status).toBe(201);

    const again = await request(app).post('/api/v1/reports').set(bearer(tokens.stranger)).send({ target_type: 'item', target_id: item.id, reason: 'spam' });
    expect(again.status).toBe(409);
  });

  it('reports a user; validates input', async () => {
    const res = await request(app).post('/api/v1/reports').set(bearer(tokens.stranger)).send({ target_type: 'user', target_id: users.owner.id, reason: 'fake' });
    expect(res.status).toBe(201);
    expect((await request(app).post('/api/v1/reports').set(bearer(tokens.stranger)).send({ target_type: 'user', target_id: users.stranger.id, reason: 'fake' })).status).toBe(400);
    expect((await request(app).post('/api/v1/reports').set(bearer(tokens.stranger)).send({ target_type: 'user', target_id: 999999, reason: 'fake' })).status).toBe(404);
    expect((await request(app).post('/api/v1/reports').set(bearer(tokens.stranger)).send({ target_type: 'x', target_id: 1, reason: 'nope' })).status).toBe(400);
    expect(await Report.count({ where: { reporter_id: users.stranger.id } })).toBe(2);
  });
});
