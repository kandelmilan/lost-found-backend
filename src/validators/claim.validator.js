const Joi = require('joi');

const STATUSES = ['pending', 'accepted', 'rejected', 'cancelled', 'completed'];

const create = Joi.object({
  answer: Joi.string().trim().max(100).allow(''),
  message: Joi.string().trim().max(1000).allow(''),
});

const reason = Joi.object({
  reason: Joi.string().trim().max(500).allow(''),
});

// A meeting time a little in the past is allowed (clocks differ), but not days ago.
const notLongAgo = (value, helpers) =>
  value.getTime() < Date.now() - 60 * 60 * 1000 ? helpers.message('at must be in the future') : value;

const meeting = Joi.object({
  place: Joi.string().trim().min(2).max(255).allow(''),
  at: Joi.date().iso().custom(notLongAgo).allow(null),
  notes: Joi.string().trim().max(500).allow(''),
}).min(1);

const list = Joi.object({
  status: Joi.string().valid(...STATUSES),
  item_id: Joi.number().integer().positive(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
});

module.exports = { create, reason, meeting, list };
