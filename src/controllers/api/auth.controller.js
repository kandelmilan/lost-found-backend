const authService = require('../../services/auth.service');
const { ok, created } = require('../../utils/response');

async function register(req, res) {
  const { user, tokens } = await authService.register(req.body, req.get('user-agent'));
  return created(res, { user, tokens }, 'Account created');
}

async function login(req, res) {
  const { user, tokens } = await authService.login(req.body, req.get('user-agent'));
  return ok(res, { user, tokens }, 'Logged in');
}

async function refresh(req, res) {
  const { user, tokens } = await authService.refresh(req.body.refreshToken, req.get('user-agent'));
  return ok(res, { user, tokens }, 'Token refreshed');
}

async function logout(req, res) {
  await authService.logout(req.body.refreshToken);
  return ok(res, null, 'Logged out');
}

async function logoutAll(req, res) {
  await authService.logoutAll(req.user);
  return ok(res, null, 'Logged out from all devices');
}

module.exports = { register, login, refresh, logout, logoutAll };
