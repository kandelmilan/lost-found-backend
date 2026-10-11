const authService = require('../../services/auth.service');
const { ok } = require('../../utils/response');

async function show(req, res) {
  return ok(res, req.user);
}

async function update(req, res) {
  const user = await authService.updateProfile(req.user, req.body);
  return ok(res, user, 'Profile updated');
}

async function changePassword(req, res) {
  const tokens = await authService.changePassword(req.user, req.body, req.get('user-agent'));
  return ok(res, { tokens }, 'Password changed. Other devices have been logged out.');
}

async function updateFcmToken(req, res) {
  await authService.updateFcmToken(req.user, req.body.fcmToken);
  return ok(res, null, 'Notification token saved');
}

async function destroy(req, res) {
  await authService.deleteAccount(req.user, req.body.password);
  return ok(res, null, 'Account deleted');
}

module.exports = { show, update, changePassword, updateFcmToken, destroy };
