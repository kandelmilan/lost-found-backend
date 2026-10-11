const { Op } = require('sequelize');
const { AdminLog, User } = require('../../models');
const { AREAS, ACTION_LABELS, actionLabel } = require('../../utils/adminLabels');
const { pageMeta } = require('../../utils/pagination');
const { parseListQuery, linkQuery } = require('../../utils/listQuery');
const { sendCsv } = require('../../utils/csv');

const listOptions = { sorts: { created: 'createdAt', action: 'action' }, defaultSort: 'created', defaultDir: 'desc', defaultLimit: 50 };
const AREA_KEYS = new Set(AREAS.map(([key]) => key));

function readList(query) {
  const list = parseListQuery(query, listOptions);
  const filters = {};
  if (AREA_KEYS.has(query.area)) filters.area = query.area;
  if (/^\d+$/.test(String(query.admin || ''))) filters.admin = Number(query.admin);
  return { list, filters };
}

// Search: a number finds actions on that item/user/claim id; words match the readable
// labels ("blocked") or the codes ("user.block").
function whereFor({ q }, { area, admin }) {
  const and = [];
  if (area) and.push({ action: { [Op.like]: `${area}.%` } });
  if (admin) and.push({ admin_id: admin });
  if (q && /^\d+$/.test(q)) {
    and.push({ target_id: Number(q) });
  } else if (q) {
    const needle = q.toLowerCase();
    const codes = Object.entries(ACTION_LABELS)
      .filter(([code, label]) => code.includes(needle) || label.toLowerCase().includes(needle))
      .map(([code]) => code);
    and.push({ action: { [Op.in]: codes.length ? codes : ['__none__'] } });
  }
  return and.length ? { [Op.and]: and } : {};
}

async function fetchLogs(list, filters, { page = list.page, limit = list.limit } = {}) {
  return AdminLog.findAndCountAll({
    where: whereFor(list, filters),
    include: [{ association: 'admin', attributes: ['id', 'name'] }],
    order: list.order,
    limit,
    offset: (page - 1) * limit,
  });
}

async function index(req, res) {
  const { list, filters } = readList(req.query);
  const [{ rows, count }, admins] = await Promise.all([
    fetchLogs(list, filters),
    User.findAll({ where: { role: 'admin' }, attributes: ['id', 'name'], order: [['name', 'ASC']] }),
  ]);

  const query = linkQuery({ q: list.q, limit: list.limit, ...filters });
  res.render('admin/pages/logs/index', {
    title: 'Activity Logs',
    active: 'logs',
    logs: rows,
    admins,
    areas: AREAS,
    list,
    filters,
    query,
    pageQuery: linkQuery({ ...query, sort: list.sort, dir: list.dir }),
    exportUrl: `/admin/logs/export?${new URLSearchParams(linkQuery({ ...query, sort: list.sort, dir: list.dir }))}`,
    pagination: pageMeta({ page: list.page, limit: list.limit, total: count }),
  });
}

async function exportCsv(req, res) {
  const { list, filters } = readList(req.query);
  const { rows } = await fetchLogs(list, filters, { page: 1, limit: 10000 });
  sendCsv(
    res,
    'activity-log',
    [
      { label: 'When', value: (l) => l.createdAt },
      { label: 'Admin', value: (l) => l.admin?.name || '(deleted)' },
      { label: 'Action', value: (l) => actionLabel(l.action) },
      { label: 'Action code', value: (l) => l.action },
      { label: 'Target', value: (l) => (l.target_type ? `${l.target_type} #${l.target_id}` : '') },
      { label: 'Details', value: (l) => (l.details ? JSON.stringify(l.details) : '') },
      { label: 'IP', value: (l) => l.ip },
    ],
    rows,
  );
}

module.exports = { index, exportCsv };
