const Joi = require('joi');

// Strip spaces / dashes / brackets so "+977 98-1234-5678" is stored as "+9779812345678".
const phone = Joi.string()
  .trim()
  .custom((value) => value.replace(/[\s\-()]/g, ''))
  .pattern(/^\+?[0-9]{7,15}$/)
  .messages({ 'string.pattern.base': 'phone must be a valid phone number' });

const email = Joi.string().trim().lowercase().email().max(191);

// At least 8 chars, one letter and one number.
const password = Joi.string()
  .min(8)
  .max(72) // bcrypt only uses the first 72 bytes
  .pattern(/[A-Za-z]/, 'letter')
  .pattern(/[0-9]/, 'number')
  .messages({ 'string.pattern.name': 'password must contain at least one {#name}' });

const name = Joi.string().trim().min(2).max(100);

const register = Joi.object({
  name: name.required(),
  email,
  phone,
  password: password.required(),
})
  .or('email', 'phone')
  .messages({ 'object.missing': 'email or phone is required' });

const login = Joi.object({
  identifier: Joi.string().trim().required().description('Email or phone number'),
  password: Joi.string().required(),
});

const refreshToken = Joi.object({
  refreshToken: Joi.string().trim().required(),
});

const updateProfile = Joi.object({
  name,
  email: email.allow(null),
  phone: phone.allow(null),
}).min(1);

const changePassword = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: password.required().invalid(Joi.ref('currentPassword')).messages({
    'any.invalid': 'newPassword must be different from currentPassword',
  }),
});

const fcmToken = Joi.object({
  fcmToken: Joi.string().trim().max(500).allow(null).required(),
});

const deleteAccount = Joi.object({
  password: Joi.string().required(),
});

module.exports = { register, login, refreshToken, updateProfile, changePassword, fcmToken, deleteAccount };
