const Joi = require('joi');
const { Report } = require('../models');

const page = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
};

const messages = Joi.object({
  before: Joi.number().integer().positive(),
  limit: Joi.number().integer().min(1).max(100).default(30),
});

const sendMessage = Joi.object({
  body: Joi.string().trim().min(1).max(2000).required(),
});

const conversations = Joi.object(page);

const notifications = Joi.object({
  ...page,
  unread_only: Joi.boolean().default(false),
});

const report = Joi.object({
  target_type: Joi.string().valid('item', 'user').required(),
  target_id: Joi.number().integer().positive().required(),
  reason: Joi.string()
    .valid(...Report.REASONS)
    .required(),
  details: Joi.string().trim().max(1000).allow(''),
});

module.exports = { messages, sendMessage, conversations, notifications, report };
