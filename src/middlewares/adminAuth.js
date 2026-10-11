const { User } = require('../models');

// Loads the logged-in admin (if any) and exposes it to views as `admin`.
async function loadAdmin(req, res, next) {
  res.locals.admin = null;
  if (!req.session.adminId) return next();

  const admin = await User.findByPk(req.session.adminId);
  if (!admin || !admin.isAdmin() || admin.is_blocked) {
    delete req.session.adminId;
    return next();
  }

  req.admin = admin;
  res.locals.admin = admin;
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.admin) return res.redirect('/admin/login');
  return next();
}

function redirectIfLoggedIn(req, res, next) {
  if (req.admin) return res.redirect('/admin');
  return next();
}

module.exports = { loadAdmin, requireAdmin, redirectIfLoggedIn };
