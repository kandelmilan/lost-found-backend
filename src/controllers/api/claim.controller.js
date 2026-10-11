const claimService = require('../../services/claim.service');
const { ok, created } = require('../../utils/response');
const { pageMeta } = require('../../utils/pagination');

const claimId = (req) => Number(req.params.id);

async function create(req, res) {
  const claim = await claimService.createClaim(req.user, Number(req.params.id), req.body);
  const message = claim.kind === 'ownership' ? 'Claim sent to the finder' : 'The owner has been told you found it';
  return created(res, claim, message);
}

async function listForItem(req, res) {
  const filters = { ...req.validated.query, item_id: Number(req.params.id) };
  const { claims, total } = await claimService.listReceived(req.user, filters);
  return ok(res, claims, 'OK', pageMeta({ page: filters.page, limit: filters.limit, total }));
}

async function sent(req, res) {
  const filters = req.validated.query;
  const { claims, total } = await claimService.listSent(req.user, filters);
  return ok(res, claims, 'OK', pageMeta({ page: filters.page, limit: filters.limit, total }));
}

async function received(req, res) {
  const filters = req.validated.query;
  const { claims, total } = await claimService.listReceived(req.user, filters);
  return ok(res, claims, 'OK', pageMeta({ page: filters.page, limit: filters.limit, total }));
}

async function show(req, res) {
  return ok(res, await claimService.getClaim(req.user, claimId(req)));
}

async function accept(req, res) {
  return ok(res, await claimService.accept(req.user, claimId(req)), 'Claim accepted. Arrange the handover.');
}

async function reject(req, res) {
  return ok(res, await claimService.reject(req.user, claimId(req), req.body.reason), 'Claim rejected');
}

async function cancel(req, res) {
  return ok(res, await claimService.cancel(req.user, claimId(req), req.body.reason), 'Claim cancelled');
}

async function meeting(req, res) {
  return ok(res, await claimService.updateMeeting(req.user, claimId(req), req.body), 'Meeting details saved');
}

async function confirmReturn(req, res) {
  const claim = await claimService.confirmReturn(req.user, claimId(req));
  const message =
    claim.status === 'completed' ? 'Item returned. Thank you for helping! 🎉' : 'Confirmed. Waiting for the other person.';
  return ok(res, claim, message);
}

module.exports = { create, listForItem, sent, received, show, accept, reject, cancel, meeting, confirmReturn };
