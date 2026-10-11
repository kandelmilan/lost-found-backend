const { User, AdminLog } = require('../../models');

const LOGIN_VIEW = 'admin/pages/login';
const AUTH_LAYOUT = 'admin/layouts/auth';

function showLogin(req, res) {
  res.render(LOGIN_VIEW, { layout: AUTH_LAYOUT, title: 'Admin Login', error: null, email: '' });
}

async function login(req, res, next) {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  const renderError = (status, error) =>
    res.status(status).render(LOGIN_VIEW, { layout: AUTH_LAYOUT, title: 'Admin Login', error, email });

  if (!email || !password) return renderError(400, 'Email and password are required.');

  const user = await User.findOne({ where: { email, role: 'admin' } });
  // Same message for "no such admin" and "wrong password" so attackers can't probe emails.
  if (!user || !(await user.checkPassword(password))) return renderError(401, 'Invalid email or password.');
  if (user.is_blocked) return renderError(403, 'This admin account is blocked.');

  // New session id on login prevents session fixation.
  return req.session.regenerate(async (err) => {
    if (err) return next(err);
    req.session.adminId = user.id;
    await user.update({ last_login_at: new Date() });
    await AdminLog.record(req, 'admin.login', { targetType: 'user', targetId: user.id });
    return req.session.save((saveErr) => (saveErr ? next(saveErr) : res.redirect('/admin')));
  });
}

async function logout(req, res, next) {
  if (req.admin) await AdminLog.record(req, 'admin.logout', { targetType: 'user', targetId: req.admin.id });
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('lf.admin.sid');
    return res.redirect('/admin/login');
  });
}

module.exports = { showLogin, login, logout };
