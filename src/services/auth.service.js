const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { sequelize, User } = require('../models');
const ApiError = require('../utils/ApiError');
const tokenService = require('./token.service');
const itemService = require('./item.service');
const storage = require('./storage.service');
const claimService = require('./claim.service');
const socket = require('../socket');

// Compared against when the user doesn't exist, so a failed login takes the same
// time either way and can't be used to discover which emails/phones are registered.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

async function ensureUnique({ email, phone }, excludeId) {
  const or = [];
  if (email) or.push({ email });
  if (phone) or.push({ phone });
  if (!or.length) return;

  const where = { [Op.or]: or };
  if (excludeId) where.id = { [Op.ne]: excludeId };
  const existing = await User.findOne({ where, attributes: ['email', 'phone'] });
  if (!existing) return;

  const field = email && existing.email === email ? 'email' : 'phone';
  throw ApiError.conflict(`This ${field} is already registered`, [
    { field, message: `${field} is already registered` },
  ]);
}

async function register({ name, email, phone, password }, userAgent) {
  await ensureUnique({ email, phone });

  return sequelize.transaction(async (transaction) => {
    const user = await User.create(
      {
        name,
        email: email || null,
        phone: phone || null,
        password_hash: await User.hashPassword(password),
        last_login_at: new Date(),
      },
      { transaction },
    );
    await user.reload({ transaction });
    const tokens = await tokenService.issueTokens(user, userAgent, transaction);
    return { user, tokens };
  });
}

async function login({ identifier, password }, userAgent) {
  const value = identifier.trim();
  const where = value.includes('@')
    ? { email: value.toLowerCase() }
    : { phone: value.replace(/[\s\-()]/g, '') };

  const user = await User.findOne({ where });
  const valid = user ? await user.checkPassword(password) : await bcrypt.compare(password, DUMMY_HASH);
  if (!user || !valid) throw ApiError.unauthorized('Invalid credentials');
  if (user.is_blocked) throw ApiError.forbidden('Your account has been blocked. Contact support.');

  await user.update({ last_login_at: new Date() });
  const tokens = await tokenService.issueTokens(user, userAgent);
  return { user, tokens };
}

// Rotation: each refresh token works once and is replaced by a new one.
async function refresh(refreshToken, userAgent) {
  const record = await tokenService.findUsableRefreshToken(refreshToken);
  const { user } = record;
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  if (user.is_blocked) throw ApiError.forbidden('Your account has been blocked. Contact support.');

  return sequelize.transaction(async (transaction) => {
    await record.update({ revoked_at: new Date() }, { transaction });
    const tokens = await tokenService.issueTokens(user, userAgent, transaction);
    return { user, tokens };
  });
}

async function logout(refreshToken) {
  await tokenService.revokeRefreshToken(refreshToken);
}

async function logoutAll(user) {
  await tokenService.revokeAllForUser(user.id);
}

async function updateProfile(user, changes) {
  const next = {
    email: changes.email !== undefined ? changes.email : user.email,
    phone: changes.phone !== undefined ? changes.phone : user.phone,
  };
  if (!next.email && !next.phone) {
    throw ApiError.badRequest('Validation failed', [{ field: 'email', message: 'email or phone is required' }]);
  }

  await ensureUnique(
    {
      email: changes.email && changes.email !== user.email ? changes.email : null,
      phone: changes.phone && changes.phone !== user.phone ? changes.phone : null,
    },
    user.id,
  );

  // A changed email/phone hasn't been verified yet.
  const contactChanged = next.email !== user.email || next.phone !== user.phone;
  await user.update({ ...changes, ...(contactChanged && { is_verified: false }) });
  return user;
}

async function changePassword(user, { currentPassword, newPassword }, userAgent) {
  if (!(await user.checkPassword(currentPassword))) {
    throw ApiError.badRequest('Validation failed', [{ field: 'currentPassword', message: 'currentPassword is incorrect' }]);
  }

  // Changing password signs out every other device.
  return sequelize.transaction(async (transaction) => {
    await user.update({ password_hash: await User.hashPassword(newPassword) }, { transaction });
    await tokenService.revokeAllForUser(user.id, transaction);
    return tokenService.issueTokens(user, userAgent, transaction);
  });
}

// One phone = one account: if this device's token was saved for someone else
// (they signed out by switching accounts), take it away from them so their
// notifications don't arrive on this phone.
async function updateFcmToken(user, fcmToken) {
  if (fcmToken) {
    await User.update({ fcm_token: null }, { where: { fcm_token: fcmToken, id: { [Op.ne]: user.id } } });
  }
  await user.update({ fcm_token: fcmToken });
}

async function deleteAccount(user, password) {
  if (!(await user.checkPassword(password))) {
    throw ApiError.badRequest('Validation failed', [{ field: 'password', message: 'password is incorrect' }]);
  }
  if (user.isAdmin()) throw ApiError.forbidden('Admin accounts cannot be deleted from the app');

  // Rows (items, images, refresh tokens) go via ON DELETE CASCADE; photo files must be removed separately.
  const imageKeys = await itemService.imageKeysForUser(user.id);
  await sequelize.transaction(async (transaction) => {
    // Items held by this user's accepted claims go back to the feed before the claims are deleted.
    await claimService.releaseActiveClaimsOf(user.id, 'The other person deleted their account', transaction);
    await user.destroy({ transaction });
  });
  socket.disconnectUser(user.id);
  await storage.removeFiles(imageKeys);
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  updateProfile,
  changePassword,
  updateFcmToken,
  deleteAccount,
};
