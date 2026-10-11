const { rateLimit } = require('express-rate-limit');
const env = require('../config/env');

const jsonMessage = (message) => ({ success: false, message });

// General limit for all /api routes.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.isTest,
  message: jsonMessage('Too many requests, please try again later.'),
});

// Stricter limit for login / register / password endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.isTest,
  message: jsonMessage('Too many attempts, please try again in 15 minutes.'),
});

// Posting items: per user, to stop spam.
const createItemLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.isTest,
  keyGenerator: (req) => `user:${req.user.id}`,
  message: jsonMessage('You have posted too many items. Please try again in an hour.'),
});

// Making claims: per user, on top of the 3-attempts-per-item rule.
const claimLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.isTest,
  keyGenerator: (req) => `user:${req.user.id}`,
  message: jsonMessage('Too many claims. Please try again in an hour.'),
});

// Admin website login (form, so we render instead of returning JSON).
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skip: () => env.isTest,
  handler: (req, res) => {
    res.status(429).render('admin/pages/login', {
      layout: 'admin/layouts/auth',
      title: 'Admin Login',
      error: 'Too many login attempts. Please try again in 15 minutes.',
      email: req.body?.email || '',
    });
  },
});

module.exports = { apiLimiter, authLimiter, createItemLimiter, claimLimiter, adminLoginLimiter };
