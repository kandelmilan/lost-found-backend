const { Op, literal } = require('sequelize');
const { sequelize, Claim, Message } = require('../models');
const ApiError = require('../utils/ApiError');
const socket = require('../socket');
const push = require('./push.service');

const MAX_LENGTH = 2000;
// Chat is open while the claim is being decided or handed over; afterwards it is read-only.
const OPEN_STATUSES = new Set(['pending', 'accepted']);

function serializeMessage(message, viewerId) {
  return {
    id: message.id,
    claim_id: message.claim_id,
    sender_id: message.sender_id,
    is_mine: message.sender_id === viewerId,
    body: message.body,
    read_at: message.read_at,
    createdAt: message.createdAt,
  };
}

async function loadConversation(user, claimId) {
  const claim = await Claim.findByPk(claimId, {
    include: [
      { association: 'claimer', attributes: ['id', 'name', 'avatar_url'] },
      { association: 'item', attributes: ['id', 'title', 'user_id'], include: [{ association: 'owner', attributes: ['id', 'name', 'avatar_url'] }] },
    ],
  });
  const isClaimer = claim && claim.claimer_id === user.id;
  const isPoster = claim && claim.item.user_id === user.id;
  if (!isClaimer && !isPoster) throw ApiError.notFound('Conversation not found');
  return { claim, other: isClaimer ? claim.item.owner : claim.claimer };
}

async function assertParticipant(user, claimId) {
  if (!Number.isInteger(claimId) || claimId <= 0) throw ApiError.notFound('Conversation not found');
  await loadConversation(user, claimId);
}

/**
 * Newest page first. Pass `before` (a message id) to load older messages.
 * Messages in `data` are oldest → newest so the app can append them directly.
 */
async function listMessages(user, claimId, { before, limit }) {
  await loadConversation(user, claimId);
  const where = { claim_id: claimId };
  if (before) where.id = { [Op.lt]: before };

  const rows = await Message.findAll({ where, order: [['id', 'DESC']], limit: limit + 1 });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  return {
    messages: page.map((m) => serializeMessage(m, user.id)),
    has_more: hasMore,
    next_before: hasMore ? page[0].id : null,
  };
}

async function sendMessage(user, claimId, rawBody) {
  const body = typeof rawBody === 'string' ? rawBody.trim() : '';
  if (!body) throw ApiError.badRequest('Validation failed', [{ field: 'body', message: 'Message cannot be empty' }]);
  if (body.length > MAX_LENGTH) {
    throw ApiError.badRequest('Validation failed', [{ field: 'body', message: `Message must be ${MAX_LENGTH} characters or fewer` }]);
  }

  const { claim, other } = await loadConversation(user, claimId);
  if (!OPEN_STATUSES.has(claim.status)) throw ApiError.badRequest(`This conversation is closed (claim ${claim.status})`);
  if (!other) throw ApiError.badRequest('The other person is no longer available');

  const message = await Message.create({ claim_id: claim.id, sender_id: user.id, body });
  // Touch the claim so conversation lists sort by latest activity.
  // (Sequelize skips updates that only touch the timestamp, so this is plain SQL.)
  await sequelize.query('UPDATE claims SET updated_at = NOW() WHERE id = :id', { replacements: { id: claim.id } });

  // Live: to the other person, and to the sender's other devices.
  socket.emitToUser(other.id, 'message:new', serializeMessage(message, other.id));
  socket.emitToUser(user.id, 'message:new', serializeMessage(message, user.id));

  // Phone push only when the other person has no app open. Not saved as a notification
  // (unread chats are counted from messages instead), and collapsed per conversation.
  if (!socket.isOnline(other.id)) {
    await push.sendPush(other.id, {
      title: `${user.name} · ${claim.item.title}`.slice(0, 150),
      body: body.length > 120 ? `${body.slice(0, 117)}...` : body,
      data: { type: 'message.new', claim_id: claim.id, item_id: claim.item.id },
      collapseKey: `claim-${claim.id}`,
    });
  }

  return serializeMessage(message, user.id);
}

async function markRead(user, claimId) {
  const { claim, other } = await loadConversation(user, claimId);
  const now = new Date();
  const [updated] = await Message.update(
    { read_at: now },
    { where: { claim_id: claim.id, sender_id: { [Op.ne]: user.id }, read_at: { [Op.is]: null } } },
  );
  if (updated && other) {
    socket.emitToUser(other.id, 'message:read', { claim_id: claim.id, reader_id: user.id, read_at: now });
  }
  return updated;
}

/**
 * The chat list: every claim I'm part of, with its last message and my unread count,
 * most recent activity first.
 */
async function listConversations(user, { page, limit }) {
  const uid = Number(user.id);
  const unreadSql = `(SELECT COUNT(*) FROM messages m WHERE m.claim_id = \`Claim\`.\`id\` AND m.sender_id <> ${uid} AND m.read_at IS NULL)`;
  const lastIdSql = '(SELECT MAX(m.id) FROM messages m WHERE m.claim_id = `Claim`.`id`)';
  const lastAtSql = 'COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.claim_id = `Claim`.`id`), `Claim`.`created_at`)';

  const where = { [Op.or]: [{ claimer_id: uid }, { '$item.user_id$': uid }] };
  const include = [
    { association: 'claimer', attributes: ['id', 'name', 'avatar_url'] },
    {
      association: 'item',
      attributes: ['id', 'title', 'type', 'status', 'user_id'],
      include: [
        { association: 'owner', attributes: ['id', 'name', 'avatar_url'] },
        { association: 'images', attributes: ['url'], separate: true, order: [['sort_order', 'ASC']], limit: 1 },
      ],
    },
  ];

  const [count, rows] = await Promise.all([
    Claim.count({ where, include: [{ association: 'item', attributes: [] }], distinct: true, col: 'id' }),
    Claim.findAll({
      where,
      include,
      attributes: { include: [[literal(unreadSql), 'unread_count'], [literal(lastIdSql), 'last_message_id'], [literal(lastAtSql), 'last_activity_at']] },
      order: [[literal('last_activity_at'), 'DESC'], ['id', 'DESC']],
      limit,
      offset: (page - 1) * limit,
      subQuery: false,
    }),
  ]);

  const lastIds = rows.map((c) => c.get('last_message_id')).filter(Boolean);
  const lastMessages = lastIds.length ? await Message.findAll({ where: { id: lastIds } }) : [];
  const byId = Object.fromEntries(lastMessages.map((m) => [m.id, m]));

  const conversations = rows.map((claim) => {
    const isClaimer = claim.claimer_id === uid;
    const other = isClaimer ? claim.item.owner : claim.claimer;
    const last = byId[claim.get('last_message_id')];
    return {
      claim_id: claim.id,
      claim_status: claim.status,
      my_role: isClaimer ? 'claimer' : 'poster',
      can_send: OPEN_STATUSES.has(claim.status),
      item: { id: claim.item.id, title: claim.item.title, type: claim.item.type, image_url: claim.item.images?.[0]?.url || null },
      other_person: other ? { id: other.id, name: other.name, avatar_url: other.avatar_url } : null,
      last_message: last ? serializeMessage(last, uid) : null,
      unread_count: Number(claim.get('unread_count')),
      last_activity_at: claim.get('last_activity_at'),
    };
  });
  return { conversations, total: count };
}

async function unreadTotal(user) {
  const uid = Number(user.id);
  const [rows] = await sequelize.query(
    `SELECT COUNT(*) AS total FROM messages m
       JOIN claims c ON c.id = m.claim_id
       JOIN items i ON i.id = c.item_id
      WHERE m.sender_id <> :uid AND m.read_at IS NULL AND (c.claimer_id = :uid OR i.user_id = :uid)`,
    { replacements: { uid } },
  );
  return Number(rows[0].total);
}

module.exports = { assertParticipant, listMessages, sendMessage, markRead, listConversations, unreadTotal, MAX_LENGTH };
