const jwt = require('jsonwebtoken');
const { User } = require('../models');
const ApiError = require('../utils/ApiError');
const { verifyAccessToken } = require('../services/token.service');

// Protects mobile app API routes. Expects: Authorization: Bearer <accessToken>
async function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(ApiError.unauthorized('Missing access token'));

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    const message = err instanceof jwt.TokenExpiredError ? 'Access token has expired' : 'Invalid access token';
    return next(ApiError.unauthorized(message));
  }

  const user = await User.findByPk(payload.sub);
  if (!user) return next(ApiError.unauthorized('Account no longer exists'));
  if (user.is_blocked) return next(ApiError.forbidden('Your account has been blocked. Contact support.'));

  req.user = user;
  return next();
}

// For public endpoints that behave differently for logged-in users (e.g. "is_mine").
// No token → anonymous. A token that is sent must be valid, so the app knows to refresh it.
function optionalAuth(req, res, next) {
  if (!req.get('authorization')) return next();
  return requireAuth(req, res, next);
}

module.exports = { requireAuth, optionalAuth };
