const request = require('supertest');
const { Op } = require('sequelize');
const { sequelize, User, Item, Claim } = require('../src/models');
const { app, createUser, loginToken, ensureCategory, bearer } = require('./helpers');

const DOMAIN = '@claims-test.example.com';
const emails = { finder: `finder${DOMAIN}`, owner: `owner${DOMAIN}`, other: `other${DOMAIN}`, third: `third${DOMAIN}` };
const tokens = {};
const users = {};
let category;

const today = () => new Date().toISOString().slice(0, 10);

async function postItem(who, type, extra = {}) {
  const req = request(app)
    .post('/api/v1/items')
    .set(bearer(tokens[who]))
    .field('type', type)
    .field('title', type === 'found' ? 'Found black wallet' : 'Lost red umbrella')
    .field('category_id', String(category.id))
    .field('event_date', today())
    .field('area_name', 'Thamel')
    .field('latitude', '27.7154')
    .field('longitude', '85.3123');
  if (type === 'found') req.field('secret_question', 'What name is on the card?').field('secret_answer', 'Ram Thapa');
  Object.entries(extra).forEach(([k, v]) => req.field(k, v));
  const res = await req;
  expect(res.status).toBe(201);
  return res.body.data;
}

const claim = (who, itemId, body) => request(app).post(`/api/v1/items/${itemId}/claims`).set(bearer(tokens[who])).send(body);
const act = (who, claimId, action, body = {}) =>
  request(app).post(`/api/v1/claims/${claimId}/${action}`).set(bearer(tokens[who])).send(body);
const get = (who, path) => request(app).get(`/api/v1${path}`).set(bearer(tokens[who]));

async function cleanup() {
  await User.destroy({ where: { email: { [Op.like]: `%${DOMAIN}` } } });
}

beforeAll(async () => {
  await cleanup();
  category = await ensureCategory('wallet', 'Wallet');
  for (const [key, email] of Object.entries(emails)) {
    // eslint-disable-next-line no-await-in-loop
    users[key] = await createUser(email, { name: key });
    // eslint-disable-next-line no-await-in-loop
    tokens[key] = await loginToken(email);
  }
});

afterAll(async () => {
  await cleanup();
  await sequelize.close();
});

describe('Ownership claim on a found item — full happy path', () => {
  let item;
  let claimId;

  it('owner claims with the right answer', async () => {
    item = await postItem('finder', 'found');
    const res = await claim('owner', item.id, { answer: '  ram THAPA ', message: 'Lost it on Friday' });
    expect(res.status).toBe(201);
    expect(res.body.data.kind).toBe('ownership');
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.my_role).toBe('claimer');
    // The claimer is never told whether the answer was right.
    expect(res.body.data.answer_correct).toBeUndefined();
    claimId = res.body.data.id;
  });

  it('finder sees the claim with answer_correct', async () => {
    const res = await get('finder', '/claims/received');
    const mine = res.body.data.find((c) => c.id === claimId);
    expect(mine.my_role).toBe('poster');
    expect(mine.answer_correct).toBe(true);
    expect(mine.claimer.name).toBe('owner');

    const detail = await get('finder', `/items/${item.id}`);
    expect(detail.body.data.pending_claims).toBe(1);
  });

  it('item detail shows my claim to the claimer', async () => {
    const res = await get('owner', `/items/${item.id}`);
    expect(res.body.data.my_claim).toEqual({ id: claimId, status: 'pending' });
    expect(res.body.data.claim_attempts_left).toBe(2);
  });

  it('strangers cannot see or act on the claim', async () => {
    expect((await get('other', `/claims/${claimId}`)).status).toBe(404);
    expect((await act('other', claimId, 'accept')).status).toBe(404);
    // The claimer can't accept their own claim either.
    expect((await act('owner', claimId, 'accept')).status).toBe(404);
  });

  it('finder accepts; item becomes claimed and leaves the feed', async () => {
    const res = await act('finder', claimId, 'accept');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('accepted');
    expect(res.body.data.item.status).toBe('claimed');

    const feed = await request(app).get('/api/v1/items');
    expect(feed.body.data.find((i) => i.id === item.id)).toBeUndefined();
  });

  it('either side sets meeting details', async () => {
    // MySQL keeps whole seconds.
    const at = new Date(Math.floor((Date.now() + 86400000) / 1000) * 1000).toISOString();
    const res = await request(app)
      .patch(`/api/v1/claims/${claimId}/meeting`)
      .set(bearer(tokens.owner))
      .send({ place: 'Thamel police post', at, notes: 'Red jacket' });
    expect(res.status).toBe(200);
    expect(res.body.data.meeting).toEqual({ place: 'Thamel police post', at, notes: 'Red jacket' });

    const past = await request(app)
      .patch(`/api/v1/claims/${claimId}/meeting`)
      .set(bearer(tokens.finder))
      .send({ at: '2020-01-01T00:00:00.000Z' });
    expect(past.status).toBe(400);
  });

  it('both confirm; claim completes, item returned, finder gets credit', async () => {
    const first = await act('owner', claimId, 'confirm-return');
    expect(first.body.data.status).toBe('accepted');
    expect(first.body.data.confirmations).toEqual({ claimer: true, poster: false });
    expect(first.body.message).toMatch(/Waiting/);

    // Confirming twice is harmless.
    await act('owner', claimId, 'confirm-return');

    const before = (await User.findByPk(users.finder.id)).returned_count;
    const second = await act('finder', claimId, 'confirm-return');
    expect(second.body.data.status).toBe('completed');
    expect(second.body.data.item.status).toBe('returned');
    expect((await User.findByPk(users.finder.id)).returned_count).toBe(before + 1);

    expect((await act('finder', claimId, 'cancel')).status).toBe(400);
  });
});

describe('Finder report on a lost item', () => {
  it('needs a message, forbids an answer, and credits the finder on completion', async () => {
    const item = await postItem('owner', 'lost');

    expect((await claim('finder', item.id, {})).status).toBe(400);
    expect((await claim('finder', item.id, { answer: 'x', message: 'Found it' })).status).toBe(400);

    const res = await claim('finder', item.id, { message: 'Found it at the bus park, it is with me.' });
    expect(res.status).toBe(201);
    expect(res.body.data.kind).toBe('finder');
    const id = res.body.data.id;

    await act('owner', id, 'accept');
    await act('owner', id, 'confirm-return');
    const before = (await User.findByPk(users.finder.id)).returned_count;
    const done = await act('finder', id, 'confirm-return');
    expect(done.body.data.status).toBe('completed');
    // On a lost item the claimer is the finder.
    expect((await User.findByPk(users.finder.id)).returned_count).toBe(before + 1);
  });
});

describe('Rules', () => {
  it('cannot claim own item, hidden item, or closed item', async () => {
    const item = await postItem('finder', 'found');
    expect((await claim('finder', item.id, { answer: 'x' })).status).toBe(400);

    await Item.update({ is_hidden: true }, { where: { id: item.id } });
    expect((await claim('owner', item.id, { answer: 'x' })).status).toBe(404);
    await Item.update({ is_hidden: false, status: 'closed' }, { where: { id: item.id } });
    expect((await claim('owner', item.id, { answer: 'x' })).status).toBe(400);
  });

  it('requires an answer on found items', async () => {
    const item = await postItem('finder', 'found');
    const res = await claim('owner', item.id, { message: 'mine' });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('answer');
  });

  it('allows only one active claim, and 3 attempts per item', async () => {
    const item = await postItem('finder', 'found');
    const first = await claim('other', item.id, { answer: 'wrong 1' });
    expect(first.body.data.status).toBe('pending');
    expect((await claim('other', item.id, { answer: 'again' })).status).toBe(409);

    await act('finder', first.body.data.id, 'reject', { reason: 'Wrong name' });
    const second = await claim('other', item.id, { answer: 'wrong 2' });
    await act('other', second.body.data.id, 'cancel');
    const third = await claim('other', item.id, { answer: 'wrong 3' });
    expect(third.status).toBe(201);
    await act('finder', third.body.data.id, 'reject');

    const fourth = await claim('other', item.id, { answer: 'Ram Thapa' });
    expect(fourth.status).toBe(429);

    const sent = await get('other', '/claims/sent');
    const rejected = sent.body.data.find((c) => c.id === first.body.data.id);
    expect(rejected.status).toBe('rejected');
    expect(rejected.rejection_reason).toBe('Wrong name');
  });

  it('accepting one claim rejects the other pending ones', async () => {
    const item = await postItem('finder', 'found');
    const a = (await claim('owner', item.id, { answer: 'Ram Thapa' })).body.data;
    const b = (await claim('other', item.id, { answer: 'Hari' })).body.data;
    const c = (await claim('third', item.id, { answer: 'Sita' })).body.data;

    // Received list puts pending first.
    const received = await get('finder', `/items/${item.id}/claims`);
    expect(received.body.meta.total).toBe(3);

    await act('finder', a.id, 'accept');
    expect((await Claim.findByPk(b.id)).status).toBe('rejected');
    expect((await Claim.findByPk(c.id)).rejection_reason).toMatch(/Another claim/);
    expect((await act('finder', b.id, 'accept')).status).toBe(400);
  });

  it('cancelling an accepted handover reopens the item', async () => {
    const item = await postItem('finder', 'found');
    const c = (await claim('owner', item.id, { answer: 'Ram Thapa' })).body.data;
    await act('finder', c.id, 'accept');

    const res = await act('finder', c.id, 'cancel', { reason: 'Could not meet' });
    expect(res.body.data.status).toBe('cancelled');
    expect(res.body.data.cancelled_by).toBe('poster');
    expect((await Item.findByPk(item.id)).status).toBe('open');
  });

  it('reject and cancel work without a request body', async () => {
    const item = await postItem('finder', 'found');
    const c = (await claim('owner', item.id, { answer: 'x' })).body.data;
    const res = await request(app).post(`/api/v1/claims/${c.id}/reject`).set(bearer(tokens.finder));
    expect(res.status).toBe(200);
    expect(res.body.data.rejection_reason).toBeNull();
  });

  it('the poster rejects (not cancels) a pending claim', async () => {
    const item = await postItem('finder', 'found');
    const c = (await claim('owner', item.id, { answer: 'x' })).body.data;
    expect((await act('finder', c.id, 'cancel')).status).toBe(400);
    expect((await act('finder', c.id, 'reject')).status).toBe(200);
  });

  it('meeting and confirmation need an accepted claim', async () => {
    const item = await postItem('finder', 'found');
    const c = (await claim('owner', item.id, { answer: 'x' })).body.data;
    const meet = await request(app).patch(`/api/v1/claims/${c.id}/meeting`).set(bearer(tokens.owner)).send({ place: 'Somewhere' });
    expect(meet.status).toBe(400);
    expect((await act('owner', c.id, 'confirm-return')).status).toBe(400);
  });

  it('closing an item rejects its pending claims', async () => {
    const item = await postItem('finder', 'found');
    const c = (await claim('owner', item.id, { answer: 'x' })).body.data;
    await request(app).post(`/api/v1/items/${item.id}/close`).set(bearer(tokens.finder));
    const after = await Claim.findByPk(c.id);
    expect(after.status).toBe('rejected');
    expect(after.rejection_reason).toMatch(/closed/);
  });

  it('a claimed item cannot be edited or deleted by the poster', async () => {
    const item = await postItem('finder', 'found');
    const c = (await claim('owner', item.id, { answer: 'Ram Thapa' })).body.data;
    await act('finder', c.id, 'accept');
    expect((await request(app).delete(`/api/v1/items/${item.id}`).set(bearer(tokens.finder))).status).toBe(400);
    expect((await request(app).patch(`/api/v1/items/${item.id}`).set(bearer(tokens.finder)).send({ title: 'New' })).status).toBe(400);
  });
});

describe('Account changes', () => {
  it("deleting the claimer's account reopens the item they were collecting", async () => {
    const email = `leaver${DOMAIN}`;
    await createUser(email);
    const token = await loginToken(email);
    const item = await postItem('finder', 'found');
    const c = await request(app).post(`/api/v1/items/${item.id}/claims`).set(bearer(token)).send({ answer: 'Ram Thapa' });
    await act('finder', c.body.data.id, 'accept');
    expect((await Item.findByPk(item.id)).status).toBe('claimed');

    await request(app).delete('/api/v1/me').set(bearer(token)).send({ password: 'Secret123' });
    expect((await Item.findByPk(item.id)).status).toBe('open');
  });

  it("blocking a user cancels their active claims and reopens items", async () => {
    const email = `blocked${DOMAIN}`;
    const blocked = await createUser(email);
    const token = await loginToken(email);
    const item = await postItem('finder', 'found');
    const c = (await request(app).post(`/api/v1/items/${item.id}/claims`).set(bearer(token)).send({ answer: 'Ram Thapa' })).body.data;
    await act('finder', c.id, 'accept');

    const userService = require('../src/services/user.service');
    await userService.setBlocked({ session: {}, ip: '127.0.0.1' }, blocked.id, true, 'test');

    const after = await Claim.findByPk(c.id);
    expect(after.status).toBe('cancelled');
    expect(after.cancelled_by).toBe('system');
    expect((await Item.findByPk(item.id)).status).toBe('open');
  });
});
