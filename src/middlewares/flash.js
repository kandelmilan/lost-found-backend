// One-time messages shown after a redirect, e.g. "User blocked".
// Set with req.flash('success', 'Done'); shown by views/admin/partials/flash.ejs.
function flash(req, res, next) {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  req.flash = (type, message) => {
    req.session.flash = { type, message };
  };
  next();
}

module.exports = flash;
