const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const env = require('../config/env');
const { RefreshToken } = require('../models');
const ApiError = require('../utils/ApiError');

const JWT_OPTIONS = { issuer: 'lost-found-api', audience: 'lost-found-app' };

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

function signAccessToken(user) {
  return jwt.sign({ role: user.role }, env.jwt.accessSecret, {
    ...JWT_OPTIONS,
    subject: String(user.id),
    expiresIn: env.jwt.accessExpires,
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret, JWT_OPTIONS);
}

// Refresh tokens are random strings; only their SHA-256 hash is stored,
// so a database leak doesn't expose usable tokens.
async function createRefreshToken(user, userAgent, transaction) {
  const token = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + env.jwt.refreshExpiresDays * 24 * 60 * 60 * 1000);
  await RefreshToken.create(
    {
      user_id: user.id,
      token_hash: hash(token),
      expires_at: expiresAt,
      user_agent: userAgent ? String(userAgent).slice(0, 255) : null,
    },
    { transaction },
  );
  return { token, expiresAt };
}

async function issueTokens(user, userAgent, transaction) {
  const accessToken = signAccessToken(user);
  const { token: refreshToken, expiresAt } = await createRefreshToken(user, userAgent, transaction);
  const { exp } = jwt.decode(accessToken);
  return {
    accessToken,
    accessTokenExpiresAt: new Date(exp * 1000).toISOString(),
    refreshToken,
    refreshTokenExpiresAt: expiresAt.toISOString(),
    tokenType: 'Bearer',
  };
}

async function revokeAllForUser(userId, transaction) {
  await RefreshToken.update(
    { revoked_at: new Date() },
    { where: { user_id: userId, revoked_at: { [Op.is]: null } }, transaction },
  );
}

/**
 * Finds a refresh token and checks it can be used.
 * If an already-revoked token is presented again, someone may have stolen it,
 * so every session of that user is revoked (refresh token reuse detection).
 */
async function findUsableRefreshToken(token) {
  const record = await RefreshToken.findOne({ where: { token_hash: hash(token) }, include: ['user'] });
  if (!record) throw ApiError.unauthorized('Invalid refresh token');

  if (record.revoked_at) {
    await revokeAllForUser(record.user_id);
    throw ApiError.unauthorized('Refresh token has been revoked. Please log in again.');
  }
  if (record.expires_at <= new Date()) throw ApiError.unauthorized('Refresh token has expired. Please log in again.');

  return record;
}

async function revokeRefreshToken(token) {
  await RefreshToken.update(
    { revoked_at: new Date() },
    { where: { token_hash: hash(token), revoked_at: { [Op.is]: null } } },
  );
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  issueTokens,
  findUsableRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
};
