// Human-readable names for admin activity log entries (dashboard + Activity Logs page).
const ACTION_LABELS = {
  'admin.login': 'Signed in',
  'admin.logout': 'Signed out',
  'admin.password_change': 'Changed password',
  'user.block': 'Blocked a user',
  'user.unblock': 'Unblocked a user',
  'item.create': 'Posted an item',
  'item.update': 'Edited an item',
  'item.hide': 'Hid an item',
  'item.unhide': 'Unhid an item',
  'item.delete': 'Deleted an item',
  'category.create': 'Added a category',
  'category.update': 'Edited a category',
  'category.delete': 'Deleted a category',
  'claim.cancel': 'Cancelled a claim',
  'claim.accept': 'Accepted a claim',
  'claim.reject': 'Declined a claim',
  'claim.meeting': 'Set a handover meeting',
  'claim.confirm': 'Confirmed a handover',
  'report.resolve': 'Resolved a report',
  'report.dismiss': 'Dismissed a report',
};

const AREAS = [
  ['admin', 'Sign-ins & account'],
  ['user', 'Users'],
  ['item', 'Items'],
  ['claim', 'Claims'],
  ['report', 'Reports'],
  ['category', 'Categories'],
];

const actionLabel = (action) => ACTION_LABELS[action] || action;

// Link to the thing an action was about, when it still makes sense to open it.
function targetLink(log) {
  if (!log.target_id || log.action.startsWith('admin.')) return null;
  if (log.target_type === 'user') return `/admin/users/${log.target_id}`;
  if (log.target_type === 'item' && log.action !== 'item.delete') return `/admin/items/${log.target_id}`;
  if (log.target_type === 'category' && log.action !== 'category.delete') return `/admin/categories/${log.target_id}/edit`;
  if (log.target_type === 'claim') return `/admin/claims/${log.target_id}`;
  if (log.target_type === 'report') return `/admin/reports/${log.target_id}`;
  return null;
}

module.exports = { ACTION_LABELS, AREAS, actionLabel, targetLink };
