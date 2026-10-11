const Joi = require('joi');
const { Op, fn, col, where } = require('sequelize');
const { User, Notification } = require('../../models');
const chatService = require('../../services/chat.service');
const claimService = require('../../services/claim.service');
const schemas = require('../../validators/admin.validator');
const { pageMeta } = require('../../utils/pagination');
const { parseListQuery, linkQuery } = require('../../utils/listQuery');
const { sendCsv } = require('../../utils/csv');

const filterSchema = Joi.object({
  status: Joi.string().valid(...claimService.STATUSES).empty(''),
  kind: Joi.string().valid('ownership', 'finder').empty(''),
});

const listOptions = { sorts: claimService.ADMIN_SORTS, defaultSort: 'updated', defaultDir: 'desc' };

function readList(query) {
  return { list: parseListQuery(query, listOptions), filters: schemas.pickValid(filterSchema, query) };
}

async function index(req, res) {
  const { list, filters } = readList(req.query);
  const { claims, total } = await claimService.adminList({
    ...filters,
    q: list.q,
    page: list.page,
    limit: list.limit,
    order: list.order,
  });

  const query = linkQuery({ q: list.q, limit: list.limit, ...filters });
  res.render('admin/pages/claims/index', {
    title: 'Claims',
    active: 'claims',
    claims,
    list,
    filters,
    query,
    pageQuery: linkQuery({ ...query, sort: list.sort, dir: list.dir }),
    exportUrl: `/admin/claims/export?${new URLSearchParams(linkQuery({ ...query, sort: list.sort, dir: list.dir }))}`,
    pagination: pageMeta({ page: list.page, limit: list.limit, total }),
  });
}

async function exportCsv(req, res) {
  const { list, filters } = readList(req.query);
  const { claims } = await claimService.adminList({ ...filters, q: list.q, page: 1, limit: 5000, order: list.order });

  sendCsv(
    res,
    'claims',
    [
      { label: 'ID', value: (c) => c.id },
      { label: 'Kind', value: (c) => (c.item.type === 'found' ? 'ownership' : 'finder') },
      { label: 'Status', value: (c) => c.status },
      { label: 'Item ID', value: (c) => c.item.id },
      { label: 'Item', value: (c) => c.item.title },
      { label: 'Claimer', value: (c) => c.claimer?.name },
      { label: 'Poster', value: (c) => c.item.owner?.name },
      { label: 'Answer matched', value: (c) => (c.answer_correct === null ? '' : c.answer_correct ? 'yes' : 'no') },
      { label: 'Created', value: (c) => c.createdAt },
      { label: 'Decided', value: (c) => c.decided_at },
      { label: 'Completed', value: (c) => c.completed_at },
      { label: 'Cancelled by', value: (c) => c.cancelled_by },
    ],
    claims,
  );
}

async function show(req, res) {
  const id = Number(req.params.id);
  const { claim, history } = await claimService.adminGet(id);

  // Items posted from the admin website: admins answer as the poster, so they see the chat.
  // Chats on users' own items stay private.
  let conversation = null;
  if (claim.item.owner?.role === 'admin') {
    const poster = await User.findByPk(claim.item.user_id);
    const { messages } = await chatService.listMessages(poster, id, { limit: 100 });
    await chatService.markRead(poster, id);
    await Notification.update(
      { read_at: new Date() },
      { where: { user_id: poster.id, read_at: null, [Op.and]: [where(fn('JSON_EXTRACT', col('data'), '$.claim_id'), id)] } },
    );
    conversation = { messages, canSend: claim.status === 'pending' || claim.status === 'accepted' };
    // The badge was counted before these messages were marked read.
    res.locals.inboxCount = await claimService.adminInboxCount();
  }

  res.render('admin/pages/claims/show', {
    title: `Claim #${claim.id}`,
    crumb: conversation ? `Inbox / #${claim.id}` : `Claims / #${claim.id}`,
    active: conversation ? 'inbox' : 'claims',
    claim,
    history,
    conversation,
  });
}

async function cancel(req, res) {
  const reason = schemas.reason.validate(req.body, { stripUnknown: true }).value?.reason || '';
  const claim = await claimService.adminCancel(req, Number(req.params.id), reason);
  req.flash('success', `Claim #${claim.id} was cancelled. The item is back in the feed.`);
  res.redirect(`/admin/claims/${claim.id}`);
}

module.exports = { index, exportCsv, show, cancel };
