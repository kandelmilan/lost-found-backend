const { Op } = require('sequelize');
const { Report, Item, User, AdminLog } = require('../models');
const ApiError = require('../utils/ApiError');

const REASON_LABELS = {
  spam: 'Spam',
  fake: 'Fake post or claim',
  scam: 'Scam / asking for money',
  offensive: 'Offensive content',
  personal_info: 'Shows personal information',
  other: 'Other',
};

async function createReport(user, { target_type: targetType, target_id: targetId, reason, details }) {
  if (targetType === 'item') {
    const item = await Item.findByPk(targetId, { attributes: ['id', 'user_id', 'is_hidden'] });
    if (!item || (item.is_hidden && item.user_id !== user.id)) throw ApiError.notFound('Item not found');
    if (item.user_id === user.id) throw ApiError.badRequest('You cannot report your own post');
  } else {
    const target = await User.findByPk(targetId, { attributes: ['id', 'role'] });
    if (!target || target.role !== 'user') throw ApiError.notFound('User not found');
    if (target.id === user.id) throw ApiError.badRequest('You cannot report yourself');
  }

  const existing = await Report.findOne({
    where: { reporter_id: user.id, target_type: targetType, target_id: targetId, status: 'open' },
  });
  if (existing) throw ApiError.conflict('You have already reported this. Our team will review it.');

  const report = await Report.create({
    reporter_id: user.id,
    target_type: targetType,
    target_id: targetId,
    reason,
    details: details || null,
  });
  return { id: report.id, status: report.status };
}

// ---------- Admin ----------

const ADMIN_SORTS = { id: 'id', reason: 'reason', status: 'status', created: 'createdAt' };

async function adminList({ q, status, target_type: targetType, reason, page, limit, order }) {
  const where = {};
  if (status) where.status = status;
  if (targetType) where.target_type = targetType;
  if (reason) where.reason = reason;
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    where[Op.or] = [
      { details: { [Op.like]: like } },
      { '$reporter.name$': { [Op.like]: like } },
      ...(/^\d+$/.test(q) ? [{ id: Number(q) }, { target_id: Number(q) }] : []),
    ];
  }

  const { rows, count } = await Report.findAndCountAll({
    where,
    include: [{ association: 'reporter', attributes: ['id', 'name'] }],
    order,
    limit,
    offset: (page - 1) * limit,
    subQuery: false,
  });
  return { reports: await withTargets(rows), total: count };
}

// Attaches the reported item / user (if it still exists) to each report.
async function withTargets(reports) {
  const itemIds = reports.filter((r) => r.target_type === 'item').map((r) => r.target_id);
  const userIds = reports.filter((r) => r.target_type === 'user').map((r) => r.target_id);
  const [items, users] = await Promise.all([
    itemIds.length
      ? Item.findAll({
        where: { id: itemIds },
        attributes: ['id', 'title', 'type', 'status', 'is_hidden', 'user_id'],
        include: [{ association: 'owner', attributes: ['id', 'name', 'is_blocked', 'role'] }],
      })
      : [],
    userIds.length ? User.findAll({ where: { id: userIds }, attributes: ['id', 'name', 'email', 'phone', 'is_blocked'] }) : [],
  ]);
  const itemMap = Object.fromEntries(items.map((i) => [i.id, i]));
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));
  return reports.map((r) => {
    r.target = r.target_type === 'item' ? itemMap[r.target_id] || null : userMap[r.target_id] || null;
    return r;
  });
}

async function adminGet(id) {
  const report = await Report.findByPk(id, {
    include: [
      { association: 'reporter', attributes: ['id', 'name', 'email', 'phone'] },
      { association: 'resolver', attributes: ['id', 'name'] },
    ],
  });
  if (!report) throw ApiError.notFound('Report not found');
  const [withTarget] = await withTargets([report]);

  // Other reports about the same thing help judge how serious it is.
  const related = await Report.count({
    where: { target_type: report.target_type, target_id: report.target_id, id: { [Op.ne]: report.id } },
  });
  return { report: withTarget, related };
}

async function adminClose(req, id, status, note) {
  const report = await Report.findByPk(id);
  if (!report) throw ApiError.notFound('Report not found');
  if (report.status !== 'open') throw ApiError.badRequest(`This report is already ${report.status}`);

  await report.update({ status, admin_note: note || null, resolved_by: req.session.adminId, resolved_at: new Date() });
  await closeRelated(report, status, null, req.session.adminId);
  await AdminLog.record(req, status === 'resolved' ? 'report.resolve' : 'report.dismiss', {
    targetType: 'report',
    targetId: report.id,
    details: note ? { note } : null,
  });
  return report;
}

// Closing one report also closes the other open reports about the same target.
async function closeRelated(report, status, note, adminId) {
  await Report.update(
    { status, admin_note: note || `Closed together with report #${report.id}`, resolved_by: adminId, resolved_at: new Date() },
    { where: { target_type: report.target_type, target_id: report.target_id, status: 'open' } },
  );
}

async function openCount() {
  return Report.count({ where: { status: 'open' } });
}

module.exports = { REASON_LABELS, ADMIN_SORTS, createReport, adminList, adminGet, adminClose, closeRelated, openCount };
