const Joi = require('joi');
const reportService = require('../../services/report.service');
const itemService = require('../../services/item.service');
const userService = require('../../services/user.service');
const schemas = require('../../validators/admin.validator');
const { Report } = require('../../models');
const ApiError = require('../../utils/ApiError');
const { pageMeta } = require('../../utils/pagination');
const { parseListQuery, linkQuery } = require('../../utils/listQuery');
const { sendCsv } = require('../../utils/csv');

const filterSchema = Joi.object({
  status: Joi.string().valid('open', 'resolved', 'dismissed').empty(''),
  target_type: Joi.string().valid('item', 'user').empty(''),
  reason: Joi.string().valid(...Report.REASONS).empty(''),
});

const listOptions = { sorts: reportService.ADMIN_SORTS, defaultSort: 'created', defaultDir: 'desc' };

function readList(query) {
  return { list: parseListQuery(query, listOptions), filters: schemas.pickValid(filterSchema, query) };
}

async function index(req, res) {
  const { list, filters } = readList(req.query);
  const { reports, total } = await reportService.adminList({ ...filters, q: list.q, page: list.page, limit: list.limit, order: list.order });

  const query = linkQuery({ q: list.q, limit: list.limit, ...filters });
  res.render('admin/pages/reports/index', {
    title: 'Reports',
    active: 'reports',
    reports,
    reasonLabels: reportService.REASON_LABELS,
    list,
    filters,
    query,
    pageQuery: linkQuery({ ...query, sort: list.sort, dir: list.dir }),
    exportUrl: `/admin/reports/export?${new URLSearchParams(linkQuery({ ...query, sort: list.sort, dir: list.dir }))}`,
    pagination: pageMeta({ page: list.page, limit: list.limit, total }),
  });
}

async function exportCsv(req, res) {
  const { list, filters } = readList(req.query);
  const { reports } = await reportService.adminList({ ...filters, q: list.q, page: 1, limit: 5000, order: list.order });
  sendCsv(
    res,
    'reports',
    [
      { label: 'ID', value: (r) => r.id },
      { label: 'About', value: (r) => r.target_type },
      { label: 'Target ID', value: (r) => r.target_id },
      { label: 'Target', value: (r) => (r.target ? r.target.title || r.target.name : '(deleted)') },
      { label: 'Reason', value: (r) => reportService.REASON_LABELS[r.reason] },
      { label: 'Details', value: (r) => r.details },
      { label: 'Reporter', value: (r) => r.reporter?.name },
      { label: 'Status', value: (r) => r.status },
      { label: 'Admin note', value: (r) => r.admin_note },
      { label: 'Reported at', value: (r) => r.createdAt },
    ],
    reports,
  );
}

async function show(req, res) {
  const { report, related } = await reportService.adminGet(Number(req.params.id));
  res.render('admin/pages/reports/show', {
    title: `Report #${report.id}`,
    crumb: `Reports / #${report.id}`,
    active: 'reports',
    report,
    related,
    reasonLabels: reportService.REASON_LABELS,
  });
}

const closeSchema = Joi.object({
  note: Joi.string().trim().max(500).allow('').default(''),
  action: Joi.string().valid('none', 'hide_item', 'block_user').default('none'),
  _csrf: Joi.any().strip(),
});

// Resolve, optionally taking action on the reported item / user in the same step.
async function resolve(req, res) {
  const { value } = closeSchema.validate(req.body, { stripUnknown: true });
  const { report } = await reportService.adminGet(Number(req.params.id));
  if (report.status !== 'open') throw ApiError.badRequest(`This report is already ${report.status}`);

  const reasonText = value.note || reportService.REASON_LABELS[report.reason];
  let done = 'Report resolved.';
  if (value.action === 'hide_item') {
    if (report.target_type !== 'item' || !report.target) throw ApiError.badRequest('This report is not about an existing item');
    await itemService.adminSetHidden(req, report.target_id, true, reasonText);
    done = 'Report resolved and the item is hidden.';
  } else if (value.action === 'block_user') {
    const userId = report.target_type === 'user' ? report.target_id : report.target?.user_id;
    if (!userId) throw ApiError.badRequest('There is no user to block for this report');
    await userService.setBlocked(req, userId, true, reasonText);
    done = 'Report resolved and the user is blocked.';
  }

  await reportService.adminClose(req, report.id, 'resolved', value.note);
  req.flash('success', done);
  res.redirect(`/admin/reports/${report.id}`);
}

async function dismiss(req, res) {
  const { value } = closeSchema.validate(req.body, { stripUnknown: true });
  const report = await reportService.adminClose(req, Number(req.params.id), 'dismissed', value.note);
  req.flash('success', 'Report dismissed.');
  res.redirect(`/admin/reports/${report.id}`);
}

module.exports = { index, exportCsv, show, resolve, dismiss };
