// Tells the right person what happened to a claim. `claim` must be loaded with claimer + item.owner.
const { notify } = require('./notification.service');
const socket = require('../socket');

const quote = (title) => `“${title}”`;
const dataOf = (claim) => ({ claim_id: claim.id, item_id: claim.item.id });
const posterOf = (claim) => claim.item.owner;

function refresh(claim) {
  const payload = { claim_id: claim.id, status: claim.status, item_status: claim.item.status };
  socket.emitToUser(claim.claimer_id, 'claim:updated', payload);
  socket.emitToUser(claim.item.user_id, 'claim:updated', payload);
}

async function created(claim) {
  refresh(claim);
  const name = claim.claimer?.name || 'Someone';
  const ownership = claim.item.type === 'found';
  await notify(claim.item.user_id, {
    type: 'claim.received',
    title: ownership ? 'Someone says this is theirs' : 'Someone found your item!',
    body: ownership
      ? `${name} says ${quote(claim.item.title)} is theirs. Check their answer.`
      : `${name} says they found ${quote(claim.item.title)}.`,
    data: dataOf(claim),
  });
}

async function accepted(claim, autoRejectedClaimerIds = []) {
  refresh(claim);
  await notify(claim.claimer_id, {
    type: 'claim.accepted',
    title: 'Claim accepted 🎉',
    body: `${posterOf(claim)?.name || 'The poster'} accepted your claim on ${quote(claim.item.title)}. Arrange the handover in chat.`,
    data: dataOf(claim),
  });
  await Promise.all(
    autoRejectedClaimerIds.map((userId) =>
      notify(userId, {
        type: 'claim.rejected',
        title: 'Claim not accepted',
        body: `Another claim was accepted for ${quote(claim.item.title)}.`,
        data: { item_id: claim.item.id },
      }),
    ),
  );
}

async function rejected(claim) {
  refresh(claim);
  const reason = claim.rejection_reason ? ` Reason: ${claim.rejection_reason}` : '';
  await notify(claim.claimer_id, {
    type: 'claim.rejected',
    title: 'Claim not accepted',
    body: `${posterOf(claim)?.name || 'The poster'} declined your claim on ${quote(claim.item.title)}.${reason}`.slice(0, 500),
    data: dataOf(claim),
  });
}

// `exclude`: a user who must not be notified (e.g. the account being deleted).
async function cancelled(claim, by, wasAccepted, { exclude } = {}) {
  refresh(claim);
  const reason = claim.cancel_reason ? ` Reason: ${claim.cancel_reason}` : '';
  const title = wasAccepted ? 'Handover cancelled' : 'Claim withdrawn';

  // Who to tell: the other side, or both when an admin / the system did it.
  const recipients = [];
  if (by !== 'claimer') recipients.push(claim.claimer_id);
  if (by !== 'poster') recipients.push(claim.item.user_id);
  const targets = recipients.filter((id) => id !== exclude);

  const actor = { claimer: claim.claimer?.name, poster: posterOf(claim)?.name, admin: 'An admin', system: 'The app' }[by] || 'Someone';
  const body = `${actor} cancelled the claim on ${quote(claim.item.title)}.${reason}`.slice(0, 500);
  await Promise.all(targets.map((userId) => notify(userId, { type: 'claim.cancelled', title, body, data: dataOf(claim) })));
}

async function meetingUpdated(claim, byUser) {
  refresh(claim);
  const other = byUser.id === claim.claimer_id ? claim.item.user_id : claim.claimer_id;
  const place = claim.meeting_place ? ` at ${claim.meeting_place}` : '';
  await notify(other, {
    type: 'claim.meeting',
    title: 'Handover meeting updated',
    body: `${byUser.name} updated the meeting${place} for ${quote(claim.item.title)}.`,
    data: dataOf(claim),
  });
}

async function confirmed(claim, byUser) {
  refresh(claim);
  if (claim.status === 'completed') {
    const message = {
      type: 'claim.completed',
      title: 'Item returned 🎉',
      body: `${quote(claim.item.title)} is back with its owner. Thank you for using Lost & Found!`,
      data: dataOf(claim),
    };
    await Promise.all([notify(claim.claimer_id, message), notify(claim.item.user_id, message)]);
    return;
  }
  const other = byUser.id === claim.claimer_id ? claim.item.user_id : claim.claimer_id;
  await notify(other, {
    type: 'claim.confirmed',
    title: 'Please confirm the handover',
    body: `${byUser.name} confirmed the handover of ${quote(claim.item.title)}. Tap to confirm too.`,
    data: dataOf(claim),
  });
}

module.exports = { created, accepted, rejected, cancelled, meetingUpdated, confirmed };
