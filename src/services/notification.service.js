const { Op } = require('sequelize');
const { Notification } = require('../models');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');
const push = require('./push.service');
const socket = require('../socket');

/**
 * Saves an in-app notification, delivers it live to open apps (socket) and as a phone push.
 * Never throws: notifying must not break the action that caused it.
 */
async function notify(userId, { type, title, body, data = {} }) {
  if (!userId) return null;
  try {
    const notification = await Notification.create({ user_id: userId, type, title, body, data });
    socket.emitToUser(userId, 'notification:new', notification.toJSON());
    await push.sendPush(userId, { title, body, data: { type, notification_id: notification.id, ...data } });
    return notification;
  } catch (err) {
    logger.error(`Notification to user ${userId} failed: ${err.message}`);
    return null;
  }
}

async function list(user, { page, limit, unread_only: unreadOnly }) {
  const where = { user_id: user.id };
  if (unreadOnly) where.read_at = { [Op.is]: null };
  const { rows, count } = await Notification.findAndCountAll({
    where,
    order: [['id', 'DESC']],
    limit,
    offset: (page - 1) * limit,
  });
  return { notifications: rows.map((n) => n.toJSON()), total: count };
}

function unreadCount(user) {
  return Notification.count({ where: { user_id: user.id, read_at: { [Op.is]: null } } });
}

async function markRead(user, id) {
  const notification = await Notification.findOne({ where: { id, user_id: user.id } });
  if (!notification) throw ApiError.notFound('Notification not found');
  if (!notification.read_at) await notification.update({ read_at: new Date() });
  return notification.toJSON();
}

async function markAllRead(user) {
  const [updated] = await Notification.update(
    { read_at: new Date() },
    { where: { user_id: user.id, read_at: { [Op.is]: null } } },
  );
  return updated;
}

module.exports = { notify, list, unreadCount, markRead, markAllRead };
