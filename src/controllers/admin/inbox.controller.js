// Inbox: claims on items posted from the admin website, answered by admins "as the poster".
const Joi = require('joi');
const claimService = require('../../services/claim.service');
const chatService = require('../../services/chat.service');
const { Op } = require('sequelize');
const { AdminLog, Claim, Message } = require('../../models');
const ApiError = require('../../utils/ApiError');
const { pageMeta } = require('../../utils/pagination');

const PAGE_SIZE = 20;

async function index(req, res) {
  const status = ['open', 'pending', 'accepted', 'completed', 'rejected', 'cancelled'].includes(req.query.status)
    ? req.query.status
    : 'open';
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const { claims, total } = await claimService.adminInbox({ status, page, limit: PAGE_SIZE });

  res.render('admin/pages/inbox/index', {
    title: 'Inbox',
    active: 'inbox',
    claims,
    status,
    pagination: pageMeta({ page, limit: PAGE_SIZE, total }),
  });
}

/**
 * Runs an action as the admin account that posted the item, then goes back to the claim.
 * Problems the admin can fix (wrong state, bad input) come back as a message, not an error page.
 */
async function asPoster(req, res, action, { log, success }) {
  const id = Number(req.params.id);
  try {
    const poster = await claimService.adminPosterOf(id);
    await action(poster, id);
    if (log) await AdminLog.record(req, log, { targetType: 'claim', targetId: id });
    if (success) req.flash('success', success);
  } catch (err) {
    if (!(err instanceof ApiError) || err.statusCode >= 500 || err.statusCode === 404) throw err;
    req.flash('danger', err.errors?.[0]?.message || err.message);
  }
  res.redirect(`/admin/claims/${id}`);
}

const text = (max) => Joi.string().trim().max(max).allow('').default('');

async function accept(req, res) {
  await asPoster(req, res, (poster, id) => claimService.accept(poster, id), {
    log: 'claim.accept',
    success: 'Claim accepted. Arrange the handover in the chat below.',
  });
}

async function reject(req, res) {
  const { reason } = Joi.object({ reason: text(500) }).validate(req.body, { stripUnknown: true }).value;
  await asPoster(req, res, (poster, id) => claimService.reject(poster, id, reason), {
    log: 'claim.reject',
    success: 'Claim declined. The person has been told.',
  });
}

const meetingSchema = Joi.object({
  place: Joi.string().trim().min(2).max(255).required().messages({ 'any.required': 'Enter the meeting place', 'string.empty': 'Enter the meeting place' }),
  at: Joi.date().iso().allow('', null).empty(''),
  notes: text(500),
});

async function meeting(req, res) {
  const { value, error } = meetingSchema.validate(req.body, { stripUnknown: true });
  if (error) {
    req.flash('danger', error.details[0].message.replace(/"/g, ''));
    return res.redirect(`/admin/claims/${Number(req.params.id)}`);
  }
  return asPoster(req, res, (poster, id) => claimService.updateMeeting(poster, id, { place: value.place, at: value.at ?? null, notes: value.notes }), {
    log: 'claim.meeting',
    success: 'Meeting saved. The person has been told.',
  });
}

async function confirm(req, res) {
  await asPoster(req, res, (poster, id) => claimService.confirmReturn(poster, id), {
    log: 'claim.confirm',
    success: 'Handover confirmed.',
  });
}

const wantsJson = (req) => (req.get('accept') || '').includes('application/json');

// Shape used by the live chat script on the claim page.
const liveMessage = (m, posterName, claimerName) => ({
  id: m.id,
  body: m.body,
  is_mine: m.is_mine,
  sender: m.is_mine ? posterName : claimerName,
  created_at: m.createdAt,
  read: Boolean(m.read_at),
});

async function message(req, res) {
  const id = Number(req.params.id);
  const { value } = Joi.object({ body: text(2000) }).validate(req.body, { stripUnknown: true });

  if (wantsJson(req)) {
    // Sent from the page without reloading it.
    if (!value.body) return res.status(400).json({ ok: false, message: 'Write a message first' });
    try {
      const poster = await claimService.adminPosterOf(id);
      const sent = await chatService.sendMessage(poster, id, value.body);
      return res.json({ ok: true, message: liveMessage(sent, poster.name, '') });
    } catch (err) {
      if (!(err instanceof ApiError) || err.statusCode >= 500) throw err;
      return res.status(err.statusCode).json({ ok: false, message: err.message });
    }
  }

  if (!value.body) return res.redirect(`/admin/claims/${id}#chat`);
  // Messages aren't written to the activity log (it isn't a place for chat content).
  await asPoster(req, res, (poster, claimId) => chatService.sendMessage(poster, claimId, value.body), {});
  return undefined;
}

/**
 * Polled every few seconds by the claim page: new messages after `after`,
 * which of our messages have been seen, and whether the chat is still open.
 * Viewing counts as reading, so the person sees ✓✓ in the app.
 */
async function live(req, res) {
  const id = Number(req.params.id);
  const after = Math.max(0, Number.parseInt(req.query.after, 10) || 0);
  const poster = await claimService.adminPosterOf(id);
  const claim = await Claim.findByPk(id, { include: [{ association: 'claimer', attributes: ['name'] }] });

  const [fresh, lastSeen] = await Promise.all([
    Message.findAll({ where: { claim_id: id, id: { [Op.gt]: after } }, order: [['id', 'ASC']], limit: 100 }),
    Message.max('id', { where: { claim_id: id, sender_id: poster.id, read_at: { [Op.ne]: null } } }),
  ]);
  if (fresh.some((m) => m.sender_id !== poster.id)) await chatService.markRead(poster, id);

  const claimerName = claim.claimer?.name || '';
  res.json({
    ok: true,
    status: claim.status,
    can_send: claim.status === 'pending' || claim.status === 'accepted',
    last_seen_id: lastSeen || 0,
    messages: fresh.map((m) =>
      liveMessage({ ...m.get(), is_mine: m.sender_id === poster.id, createdAt: m.createdAt }, poster.name, claimerName),
    ),
  });
}

async function count(req, res) {
  res.json({ ok: true, count: await claimService.adminInboxCount() });
}

module.exports = { index, accept, reject, meeting, confirm, message, live, count };
