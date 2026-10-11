const userService = require('../../services/user.service');
const schemas = require('../../validators/admin.validator');
const { pageMeta } = require('../../utils/pagination');
const { parseListQuery, linkQuery } = require('../../utils/listQuery');
const { sendCsv } = require('../../utils/csv');

const listOptions = { sorts: userService.SORTS, defaultSort: 'joined', defaultDir: 'desc' };

function readList(query) {
  return {
    list: parseListQuery(query, listOptions),
    filters: schemas.pickValid(schemas.userFilters, query),
  };
}

async function index(req, res) {
  const { list, filters } = readList(req.query);
  const { users, total } = await userService.listUsers({
    ...filters,
    q: list.q,
    page: list.page,
    limit: list.limit,
    order: list.order,
  });

  const query = linkQuery({ q: list.q, limit: list.limit, ...filters });
  res.render('admin/pages/users/index', {
    title: 'Users',
    active: 'users',
    users,
    list,
    filters,
    query,
    pageQuery: linkQuery({ ...query, sort: list.sort, dir: list.dir }),
    exportUrl: `/admin/users/export?${new URLSearchParams(linkQuery({ ...query, sort: list.sort, dir: list.dir }))}`,
    pagination: pageMeta({ page: list.page, limit: list.limit, total }),
  });
}

async function exportCsv(req, res) {
  const { list, filters } = readList(req.query);
  const users = await userService.exportUsers({ ...filters, q: list.q, order: list.order });

  sendCsv(
    res,
    'users',
    [
      { label: 'ID', value: (u) => u.id },
      { label: 'Name', value: (u) => u.name },
      { label: 'Email', value: (u) => u.email },
      { label: 'Phone', value: (u) => u.phone },
      { label: 'Status', value: (u) => (u.is_blocked ? 'blocked' : 'active') },
      { label: 'Verified', value: (u) => (u.is_verified ? 'yes' : 'no') },
      { label: 'Items returned', value: (u) => u.returned_count },
      { label: 'Joined', value: (u) => u.createdAt },
      { label: 'Last login', value: (u) => u.last_login_at },
    ],
    users,
  );
}

async function show(req, res) {
  const { user, activeSessions, history } = await userService.getUserDetail(Number(req.params.id));
  res.render('admin/pages/users/show', {
    title: user.name,
    crumb: `Users / #${user.id}`,
    active: 'users',
    user,
    activeSessions,
    history,
  });
}

async function block(req, res) {
  const reason = String(req.body.reason || '').trim().slice(0, 500);
  const user = await userService.setBlocked(req, Number(req.params.id), true, reason);
  req.flash('success', `${user.name} has been blocked and signed out of all devices.`);
  res.redirect(`/admin/users/${user.id}`);
}

async function unblock(req, res) {
  const user = await userService.setBlocked(req, Number(req.params.id), false);
  req.flash('success', `${user.name} has been unblocked.`);
  res.redirect(`/admin/users/${user.id}`);
}

module.exports = { index, exportCsv, show, block, unblock };
