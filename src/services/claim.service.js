const { Op } = require('sequelize');
const { sequelize, Claim, Item, User, AdminLog } = require('../models');
const ApiError = require('../utils/ApiError');
const events = require('./claimNotifications');

// Wrong answers to a secret question: after this many tries on one item, no more claims.
const MAX_ATTEMPTS = 3;

const kindOf = (item) => (item.type === 'found' ? 'ownership' : 'finder');

function roleOf(claim, user) {
  if (!user) return null;
  if (claim.claimer_id === user.id) return 'claimer';
  if (claim.item && claim.item.user_id === user.id) return 'poster';
  return null;
}

const person = (u) => (u ? { id: u.id, name: u.name, avatar_url: u.avatar_url } : null);

/**
 * What each side may see:
 *  - Both: the message, meeting details, confirmations, rejection/cancel reasons.
 *  - Poster only: whether the secret answer matched (the claimer is never told,
 *    so they can't use it to guess).
 */
function serialize(claim, viewer) {
  const role = roleOf(claim, viewer);
  const { item } = claim;
  return {
    id: claim.id,
    kind: kindOf(item),
    status: claim.status,
    my_role: role,
    message: claim.message || '',
    answer: claim.answer,
    ...(role === 'poster' && { answer_correct: claim.answer_correct }),
    rejection_reason: claim.rejection_reason,
    item: {
      id: item.id,
      type: item.type,
      title: item.title,
      status: item.status,
      area_name: item.area_name,
      secret_question: item.type === 'found' ? item.secret_question : null,
      image_url: item.images?.[0]?.url || null,
    },
    claimer: person(claim.claimer),
    poster: person(item.owner),
    meeting: { place: claim.meeting_place, at: claim.meeting_at, notes: claim.meeting_notes },
    confirmations: { claimer: Boolean(claim.claimer_confirmed_at), poster: Boolean(claim.poster_confirmed_at) },
    cancelled_by: claim.cancelled_by,
    cancel_reason: claim.cancel_reason,
    createdAt: claim.createdAt,
    decided_at: claim.decided_at,
    completed_at: claim.completed_at,
    cancelled_at: claim.cancelled_at,
  };
}

const personAttrs = ['id', 'name', 'avatar_url'];
const fullInclude = () => [
  { association: 'claimer', attributes: personAttrs },
  {
    association: 'item',
    include: [
      { association: 'owner', attributes: personAttrs },
      { association: 'images', separate: true, order: [['sort_order', 'ASC'], ['id', 'ASC']], limit: 1 },
    ],
  },
];

async function load(id, options = {}) {
  return Claim.findByPk(id, { include: fullInclude(), ...options });
}

// Loads a claim the user takes part in; others get 404 so claim ids can't be probed.
async function loadForParticipant(user, id) {
  const claim = await load(id);
  if (!claim || !roleOf(claim, user)) throw ApiError.notFound('Claim not found');
  return claim;
}

// Locks the claim and its item rows for the rest of the transaction, so two people
// can't, for example, accept two different claims on the same item at the same moment.
async function lockForUpdate(id, transaction) {
  const claim = await Claim.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
  if (!claim) throw ApiError.notFound('Claim not found');
  const item = await Item.findByPk(claim.item_id, { transaction, lock: transaction.LOCK.UPDATE });
  claim.item = item;
  return claim;
}

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

async function createClaim(user, itemId, { answer, message }) {
  const claimId = await sequelize.transaction(async (transaction) => {
    const item = await Item.findByPk(itemId, { transaction, lock: transaction.LOCK.UPDATE });
    const poster = item && (await User.findByPk(item.user_id, { attributes: ['id', 'is_blocked'], transaction }));
    if (!item || item.is_hidden || !poster || poster.is_blocked) throw ApiError.notFound('Item not found');

    if (item.user_id === user.id) throw ApiError.badRequest('You cannot claim your own post');
    if (item.status !== 'open') throw ApiError.badRequest('This item is no longer available');

    if (item.type === 'found' && !answer) {
      throw ApiError.badRequest('Validation failed', [{ field: 'answer', message: 'Answer the secret question to claim this item' }]);
    }
    if (item.type === 'lost' && answer) {
      throw ApiError.badRequest('Validation failed', [{ field: 'answer', message: 'Lost items have no secret question' }]);
    }
    if (item.type === 'lost' && !message) {
      throw ApiError.badRequest('Validation failed', [
        { field: 'message', message: 'Tell the owner where and when you found it' },
      ]);
    }

    const previous = await Claim.findAll({ where: { item_id: item.id, claimer_id: user.id }, transaction });
    if (previous.some((c) => c.isActive())) throw ApiError.conflict('You already have an active claim on this item');
    if (previous.length >= MAX_ATTEMPTS) {
      throw new ApiError(429, `You have used all ${MAX_ATTEMPTS} attempts for this item`);
    }

    const claim = await Claim.create(
      {
        item_id: item.id,
        claimer_id: user.id,
        message: message || null,
        answer: answer || null,
        answer_correct: item.type === 'found' ? await item.checkAnswer(answer) : null,
      },
      { transaction },
    );
    return claim.id;
  });

  const full = await load(claimId);
  await events.created(full);
  return serialize(full, user);
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

async function listSent(user, { status, page, limit }) {
  const where = { claimer_id: user.id };
  if (status) where.status = status;
  const { rows, count } = await Claim.findAndCountAll({
    where,
    include: fullInclude(),
    order: [['updatedAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset: (page - 1) * limit,
    distinct: true,
  });
  return { claims: rows.map((c) => serialize(c, user)), total: count };
}

async function listReceived(user, { status, item_id: itemId, page, limit }) {
  const where = {};
  if (status) where.status = status;
  if (itemId) where.item_id = itemId;

  const include = fullInclude();
  include[1] = { ...include[1], where: { user_id: user.id }, required: true };

  const { rows, count } = await Claim.findAndCountAll({
    where,
    include,
    // Pending first, then most recent.
    order: [[sequelize.literal("`Claim`.`status` = 'pending'"), 'DESC'], ['updatedAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset: (page - 1) * limit,
    distinct: true,
  });
  return { claims: rows.map((c) => serialize(c, user)), total: count };
}

async function getClaim(user, id) {
  return serialize(await loadForParticipant(user, id), user);
}

// ---------------------------------------------------------------------------
// Poster decisions
// ---------------------------------------------------------------------------

async function accept(user, id) {
  const autoRejected = await sequelize.transaction(async (transaction) => {
    const claim = await lockForUpdate(id, transaction);
    if (claim.item.user_id !== user.id) throw ApiError.notFound('Claim not found');
    if (claim.status !== 'pending') throw ApiError.badRequest(`This claim is already ${claim.status}`);
    if (claim.item.status !== 'open') throw ApiError.badRequest('This item already has an accepted claim');

    const now = new Date();
    await claim.update({ status: 'accepted', decided_at: now }, { transaction });
    await claim.item.update({ status: 'claimed' }, { transaction });
    // Everyone else waiting on this item gets a clear answer.
    const others = await Claim.findAll({
      where: { item_id: claim.item_id, status: 'pending', id: { [Op.ne]: claim.id } },
      attributes: ['id', 'claimer_id'],
      transaction,
    });
    if (others.length) {
      await Claim.update(
        { status: 'rejected', rejection_reason: 'Another claim was accepted for this item', decided_at: now },
        { where: { id: others.map((c) => c.id) }, transaction },
      );
    }
    return others.map((c) => c.claimer_id);
  });

  const full = await load(id);
  await events.accepted(full, autoRejected);
  return serialize(full, user);
}

async function reject(user, id, reason) {
  await sequelize.transaction(async (transaction) => {
    const claim = await lockForUpdate(id, transaction);
    if (claim.item.user_id !== user.id) throw ApiError.notFound('Claim not found');
    if (claim.status !== 'pending') throw ApiError.badRequest(`This claim is already ${claim.status}`);
    await claim.update({ status: 'rejected', rejection_reason: reason || null, decided_at: new Date() }, { transaction });
  });

  const full = await load(id);
  await events.rejected(full);
  return serialize(full, user);
}

// ---------------------------------------------------------------------------
// Cancelling — claimer withdraws a pending claim, or either side calls off an accepted handover
// ---------------------------------------------------------------------------

async function cancelInTransaction(claim, by, reason, transaction) {
  await claim.update(
    { status: 'cancelled', cancelled_by: by, cancel_reason: reason || null, cancelled_at: new Date() },
    { transaction },
  );
  // An accepted claim held the item; give it back to the feed.
  if (claim.item.status === 'claimed') await claim.item.update({ status: 'open' }, { transaction });
}

async function cancel(user, id, reason) {
  const { role, wasAccepted } = await sequelize.transaction(async (transaction) => {
    const claim = await lockForUpdate(id, transaction);
    const role = roleOf(claim, user);
    if (!role) throw ApiError.notFound('Claim not found');

    if (claim.status === 'pending' && role !== 'claimer') {
      throw ApiError.badRequest('Use reject to decline a pending claim');
    }
    if (claim.status !== 'pending' && claim.status !== 'accepted') {
      throw ApiError.badRequest(`This claim is already ${claim.status}`);
    }
    const accepted = claim.status === 'accepted';
    await cancelInTransaction(claim, role, reason, transaction);
    return { role, wasAccepted: accepted };
  });

  const full = await load(id);
  await events.cancelled(full, role, wasAccepted);
  return serialize(full, user);
}

// ---------------------------------------------------------------------------
// Handover
// ---------------------------------------------------------------------------

async function updateMeeting(user, id, { place, at, notes }) {
  await sequelize.transaction(async (transaction) => {
    const claim = await lockForUpdate(id, transaction);
    if (!roleOf(claim, user)) throw ApiError.notFound('Claim not found');
    if (claim.status !== 'accepted') throw ApiError.badRequest('Meeting details can be set only after the claim is accepted');

    await claim.update(
      {
        ...(place !== undefined && { meeting_place: place || null }),
        ...(at !== undefined && { meeting_at: at }),
        ...(notes !== undefined && { meeting_notes: notes || null }),
      },
      { transaction },
    );
  });

  const full = await load(id);
  await events.meetingUpdated(full, user);
  return serialize(full, user);
}

/**
 * Each side confirms the item changed hands. When both have confirmed:
 * claim → completed, item → returned, and the finder's "returned" count goes up.
 */
async function confirmReturn(user, id) {
  const changed = await sequelize.transaction(async (transaction) => {
    const claim = await lockForUpdate(id, transaction);
    const role = roleOf(claim, user);
    if (!role) throw ApiError.notFound('Claim not found');
    if (claim.status !== 'accepted') throw ApiError.badRequest('Only an accepted claim can be confirmed');

    const now = new Date();
    const field = role === 'claimer' ? 'claimer_confirmed_at' : 'poster_confirmed_at';
    if (claim[field]) return false; // already confirmed — nothing new to tell anyone
    claim[field] = now;

    if (claim.claimer_confirmed_at && claim.poster_confirmed_at) {
      claim.status = 'completed';
      claim.completed_at = now;
      await claim.item.update({ status: 'returned' }, { transaction });
      const finderId = claim.item.type === 'found' ? claim.item.user_id : claim.claimer_id;
      await User.increment('returned_count', { where: { id: finderId }, transaction });
    }
    await claim.save({ transaction });
    return true;
  });

  const full = await load(id);
  if (changed) await events.confirmed(full, user);
  return serialize(full, user);
}

// ---------------------------------------------------------------------------
// Used by other services
// ---------------------------------------------------------------------------

// Poster closed the item: pending claims are declined.
async function rejectPendingForItem(itemId, reason, transaction) {
  await Claim.update(
    { status: 'rejected', rejection_reason: reason, decided_at: new Date() },
    { where: { item_id: itemId, status: 'pending' }, transaction },
  );
}

// A user is blocked or deleted: their active claims are cancelled and held items reopen.
async function releaseActiveClaimsOf(userId, reason, transaction) {
  const asClaimer = await Claim.findAll({
    where: { claimer_id: userId, status: { [Op.in]: ['pending', 'accepted'] } },
    attributes: ['id'],
    transaction,
  });
  // Accepted claims on THEIR items (others waiting to collect) are called off too.
  const onTheirItems = await Claim.findAll({
    where: { status: 'accepted' },
    attributes: ['id'],
    include: [{ association: 'item', attributes: [], where: { user_id: userId }, required: true }],
    transaction,
  });

  const released = [];
  for (const { id } of [...asClaimer, ...onTheirItems]) {
    // Loaded with names now: when the account is being deleted these rows are gone after commit.
    // eslint-disable-next-line no-await-in-loop
    const full = await load(id, { transaction, lock: transaction.LOCK.UPDATE });
    released.push({ full, wasAccepted: full.status === 'accepted' });
    // eslint-disable-next-line no-await-in-loop
    await cancelInTransaction(full, 'system', reason, transaction);
  }

  // Tell the other person once the change is saved.
  transaction.afterCommit(async () => {
    for (const { full, wasAccepted } of released) {
      // eslint-disable-next-line no-await-in-loop
      await events.cancelled(full, 'system', wasAccepted, { exclude: userId });
    }
  });
}

// Summary for the item detail screen.
async function claimStateForItem(item, viewer) {
  if (!viewer) return {};
  if (item.user_id === viewer.id) {
    const pending = await Claim.count({ where: { item_id: item.id, status: 'pending' } });
    return { pending_claims: pending };
  }
  const mine = await Claim.findAll({
    where: { item_id: item.id, claimer_id: viewer.id },
    order: [['id', 'DESC']],
    attributes: ['id', 'status'],
  });
  return {
    my_claim: mine[0] ? { id: mine[0].id, status: mine[0].status } : null,
    claim_attempts_left: Math.max(0, MAX_ATTEMPTS - mine.length),
  };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

const ADMIN_SORTS = { id: 'id', status: 'status', created: 'createdAt', updated: 'updatedAt' };
const STATUSES = ['pending', 'accepted', 'rejected', 'cancelled', 'completed'];

async function adminList({ q, status, kind, page, limit, order }) {
  const where = {};
  if (status) where.status = status;
  const itemWhere = {};
  if (kind) itemWhere.type = kind === 'ownership' ? 'found' : 'lost';

  if (q) {
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    where[Op.or] = [
      { '$item.title$': { [Op.like]: like } },
      { '$claimer.name$': { [Op.like]: like } },
      ...(/^\d+$/.test(q) ? [{ id: Number(q) }, { item_id: Number(q) }] : []),
    ];
  }

  const { rows, count } = await Claim.findAndCountAll({
    where,
    include: [
      { association: 'claimer', attributes: ['id', 'name'] },
      {
        association: 'item',
        attributes: ['id', 'title', 'type', 'status', 'user_id'],
        where: itemWhere,
        include: [{ association: 'owner', attributes: ['id', 'name'] }],
      },
    ],
    order,
    limit,
    offset: (page - 1) * limit,
    distinct: true,
    subQuery: false,
  });
  return { claims: rows, total: count };
}

async function adminGet(id) {
  const claim = await Claim.findByPk(id, {
    include: [
      { association: 'claimer', attributes: ['id', 'name', 'email', 'phone', 'is_blocked'] },
      {
        association: 'item',
        include: [
          { association: 'owner', attributes: ['id', 'name', 'email', 'phone', 'is_blocked', 'role'] },
          { association: 'images', separate: true, order: [['sort_order', 'ASC']], limit: 1 },
        ],
      },
    ],
  });
  if (!claim) throw ApiError.notFound('Claim not found');

  const history = await AdminLog.findAll({
    where: { target_type: 'claim', target_id: id },
    include: [{ association: 'admin', attributes: ['name'] }],
    order: [['createdAt', 'DESC']],
  });
  return { claim, history };
}

async function adminCancel(req, id, reason) {
  const wasAccepted = await sequelize.transaction(async (transaction) => {
    const locked = await lockForUpdate(id, transaction);
    if (!locked.isActive()) throw ApiError.badRequest(`This claim is already ${locked.status}`);
    const accepted = locked.status === 'accepted';
    await cancelInTransaction(locked, 'admin', reason, transaction);
    return accepted;
  });
  await AdminLog.record(req, 'claim.cancel', { targetType: 'claim', targetId: id, details: reason ? { reason } : null });

  const full = await load(id);
  await events.cancelled(full, 'admin', wasAccepted);
  return full;
}

// ---------------------------------------------------------------------------
// Admin inbox: claims on items that were posted from the admin website.
// Those items belong to the organisation, so any admin can answer them.
// ---------------------------------------------------------------------------

// Messages from the claimer that no admin has read yet.
const unreadFromClaimerSql =
  '(SELECT COUNT(*) FROM messages m WHERE m.claim_id = `Claim`.`id` AND m.sender_id = `Claim`.`claimer_id` AND m.read_at IS NULL)';

async function adminInbox({ status, page, limit }) {
  const where = {};
  if (status === 'open') where.status = { [Op.in]: ['pending', 'accepted'] };
  else if (status) where.status = status;

  const { rows, count } = await Claim.findAndCountAll({
    where,
    attributes: { include: [[sequelize.literal(unreadFromClaimerSql), 'unread_count']] },
    include: [
      { association: 'claimer', attributes: ['id', 'name'] },
      {
        association: 'item',
        attributes: ['id', 'title', 'type', 'status', 'user_id'],
        required: true,
        include: [
          { association: 'owner', attributes: ['id', 'name'], where: { role: 'admin' }, required: true },
          { association: 'images', attributes: ['url'], separate: true, order: [['sort_order', 'ASC']], limit: 1 },
        ],
      },
    ],
    order: [
      [sequelize.literal("FIELD(`Claim`.`status`, 'pending', 'accepted') = 0"), 'ASC'],
      ['updatedAt', 'DESC'],
    ],
    limit,
    offset: (page - 1) * limit,
    distinct: true,
    subQuery: false,
  });
  return { claims: rows, total: count };
}

// Number shown on the Inbox menu: claims waiting for a decision + unread messages.
async function adminInboxCount() {
  const [rows] = await sequelize.query(
    `SELECT
       (SELECT COUNT(*) FROM claims c JOIN items i ON i.id = c.item_id JOIN users u ON u.id = i.user_id
         WHERE u.role = 'admin' AND c.status = 'pending') AS pending,
       (SELECT COUNT(*) FROM messages m JOIN claims c ON c.id = m.claim_id JOIN items i ON i.id = c.item_id JOIN users u ON u.id = i.user_id
         WHERE u.role = 'admin' AND m.sender_id = c.claimer_id AND m.read_at IS NULL) AS unread`,
  );
  return Number(rows[0].pending) + Number(rows[0].unread);
}

/** The admin account that posted the item, for acting "as the poster". */
async function adminPosterOf(id) {
  const claim = await Claim.findByPk(id, { include: [{ association: 'item', attributes: ['id', 'user_id'] }] });
  if (!claim) throw ApiError.notFound('Claim not found');
  const poster = await User.findByPk(claim.item.user_id);
  if (!poster || poster.role !== 'admin') {
    throw ApiError.forbidden('Only claims on items posted from the admin website can be answered here');
  }
  return poster;
}

async function stats() {
  const [pending, inHandover] = await Promise.all([
    Claim.count({ where: { status: 'pending' } }),
    Claim.count({ where: { status: 'accepted' } }),
  ]);
  return { pendingClaims: pending, inHandover };
}

module.exports = {
  MAX_ATTEMPTS,
  load,
  roleOf,
  STATUSES,
  ADMIN_SORTS,
  createClaim,
  listSent,
  listReceived,
  getClaim,
  accept,
  reject,
  cancel,
  updateMeeting,
  confirmReturn,
  rejectPendingForItem,
  releaseActiveClaimsOf,
  claimStateForItem,
  adminList,
  adminGet,
  adminCancel,
  adminInbox,
  adminInboxCount,
  adminPosterOf,
  stats,
};
