const crypto = require('crypto');
const ApiError = require('../utils/ApiError');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Synchronizer-token CSRF protection for the admin website forms.
// Every form must include: <input type="hidden" name="_csrf" value="<%= csrfToken %>">
function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (SAFE_METHODS.has(req.method)) return next();

  const sent = Buffer.from(String(req.body?._csrf || ''));
  const expected = Buffer.from(req.session.csrfToken);
  if (sent.length !== expected.length || !crypto.timingSafeEqual(sent, expected)) {
    return next(ApiError.forbidden('Invalid or expired form. Please refresh the page and try again.'));
  }
  return next();
}

module.exports = csrfProtection;
