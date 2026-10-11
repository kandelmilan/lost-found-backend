const { Op } = require('sequelize');
const { sequelize, User, RefreshToken, AdminLog } = require('../models');
const ApiError = require('../utils/ApiError');
const tokenService = require('./token.service');
const claimService = require('./claim.service');
const socket = require('../socket');

const STATUSES = ['active', 'blocked'];
const SORTS = { id: 'id', name: 'name', status: 'is_blocked', returned: 'returned_count', joined: 'createdAt', last_login: 'last_login_at' };
const EXPORT_LIMIT = 5000;

function listWhere({ q, status }) {
  const where = { role: 'user' };
  if (status === 'active') where.is_blocked = false;
  if (status === 'blocked') where.is_blocked = true;

  if (q) {
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    where[Op.or] = [{ name: { [Op.like]: like } }, { email: { [Op.like]: like } }, { phone: { [Op.like]: like } }];
    if (/^\d+$/.test(q)) where[Op.or].push({ id: Number(q) });
  }
  return where;
}

async function listUsers({ q, status, page, limit, order = [['createdAt', 'DESC'], ['id', 'DESC']] }) {
  const { rows, count } = await User.findAndCountAll({
    where: listWhere({ q, status }),
    order,
    limit,
    offset: (page - 1) * limit,
  });
  return { users: rows, total: count };
}

// Same filters and order as the table, without paging.
async function exportUsers({ q, status, order }) {
  return User.findAll({ where: listWhere({ q, status }), order, limit: EXPORT_LIMIT });
}

async function getUserDetail(id) {
  const user = await User.findOne({ where: { id, role: 'user' } });
  if (!user) throw ApiError.notFound('User not found');

  const [activeSessions, history] = await Promise.all([
    RefreshToken.count({
      where: { user_id: id, revoked_at: { [Op.is]: null }, expires_at: { [Op.gt]: new Date() } },
    }),
    AdminLog.findAll({
      where: { target_type: 'user', target_id: id },
      include: [{ association: 'admin', attributes: ['name'] }],
      order: [['createdAt', 'DESC']],
      limit: 20,
    }),
  ]);

  return { user, activeSessions, history };
}

// Blocking also revokes every refresh token, so the user is signed out of the app
// within one access-token lifetime (max 15 min) — and immediately on any API call,
// because requireAuth checks is_blocked on every request.
async function setBlocked(req, id, blocked, reason) {
  const user = await User.findByPk(id);
  if (!user || user.role !== 'user') throw ApiError.notFound('User not found');
  if (user.is_blocked === blocked) return user;

  await sequelize.transaction(async (transaction) => {
    await user.update({ is_blocked: blocked }, { transaction });
    if (blocked) {
      await tokenService.revokeAllForUser(user.id, transaction);
      await claimService.releaseActiveClaimsOf(user.id, 'The other person is no longer available', transaction);
    }
  });

  if (blocked) socket.disconnectUser(user.id);
  await AdminLog.record(req, blocked ? 'user.block' : 'user.unblock', {
    targetType: 'user',
    targetId: user.id,
    details: reason ? { reason } : null,
  });
  return user;
}

module.exports = { STATUSES, SORTS, listUsers, exportUsers, getUserDetail, setBlocked };
